# 会记 dsh-note-taker

DSH 插件：**录音 → 本机转写 → 会议纪要**。录音与转写全程在本机；纪要由你在 DSH 里已配置的模型生成。

> 当前进度：spec `specs/20261110_project-skeleton` v1.0.0，**10/11 任务完成**。
> 录音、转写、纪要三条链路均已实测（录音 16k/单声道、转写 rtf≈0.1、单测 75 全绿）；
> T-11 端到端演练因本机麦克风无语音输入、且插件未在可用的 DSH profile 中挂载而延期，详见
> `specs/20261110_project-skeleton/completion.md`。
> 未落地的东西本文档不会写成「已支持」。

## 目录结构

```
package.json          插件元数据：dsh.bundle.patch 指向 cordis.patch.yml
cordis.patch.yml      把会记插入 profile 的插件名册
lib/                  宿主侧编排（Node ESM）
  index.js            插件入口：name / inject / apply，启动与配置日志
py/                   Python sidecar（录音、转写）——重活都在这边
scripts/              仓库脚本
  verify.mjs          结构清单 + 单测的校验入口
tests/                单测（node --test）
docs/                 方案与设计文档
specs/                需求/方案/任务/台账（spec 机制）
releases/             里程碑台账
```

## 分层职责

| 层 | 职责 | 不做什么 |
|---|---|---|
| `lib/` | 工具注册、状态机、持久化、提示组装、调用已配置模型 | 不解码音频、不做 ASR |
| `py/` | 采集麦克风、跑 faster-whisper 转写 | 不碰会议索引、不调模型 |
| 两侧契约 | **文件路径 + 一行 JSON** | 不共享内存、不互相 import |

## 安装

1. Node.js ≥ 20（开发机实测 24.16）。
2. Python 3.10+（开发机实测 3.14.5），转写依赖 `faster-whisper`（若尚未安装，见下）。
3. 把本仓库加入某个 DSH profile 的 `bundles`（或按你的 profile 管理方式安装）。

### Python 依赖的安装方式（重要）

本机工作区带 ACL 限制，`pip install` 会在原子替换阶段失败（见 `specs/_project/lessons.md` L-02）。
因此**一律走离线安装**：

```
node scripts/install-py.mjs
```

该脚本下载 wheel 并解包到 `pylibs/`，再用 `PYTHONPATH` 注入，不做 pip 安装。
README 与代码里都不应出现 `pip install` 作为安装路径。

### 转写模型（首次必须做一次）

转写模型不随仓库分发。HF 直连在国内常连不上（lessons L-08），仓库自带的下载脚本走镜像、
按文件落到本地目录，转写时优先读本地目录：

```
python py/fetch_model.py --model small --out-dir "%LOCALAPPDATA%\note-taker-models"
```

- 档位：`tiny` 75MB / `base` 145MB / `small` 480MB / `medium` 1.5GB（本机可用内存 3 GB 出头，建议 `small`）
- **中文简体是提示词管出来的，不是模型大小管出来的**：Whisper 默认倾向输出繁体，代码里已内置
  `以下是普通话会议记录，请用简体中文输出。`（`py/transcribe.py` 的 `DEFAULT_ZH_PROMPT`）。
  实测加提示后 `tiny`/`small` 都输出简体、术语正确，仅剩同音错字（决议→绝议），
  正式使用建议在 `--prompt` 里塞参会人姓名与项目术语
- 镜像可用 `NOTE_TAKER_HF_ENDPOINT` 覆盖（默认 `https://hf-mirror.com`，要直连官方就设成 `https://huggingface.co`）
- 下载速度实测约 1.4 MB/s，`small` 约六分钟；先用 `tiny` 跑通链路也行

## 云端 ASR（可选）

除本机 faster-whisper 外，还可以用阿里云百炼的**非实时语音识别 HTTP 接口**
（`qwen-audio-3.0-asr-flash`）。两条路径产出的 `transcripts/<id>.md|json` 完全同构，
下游解析与纪要生成不区分引擎。

### 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `NOTE_TAKER_ASR_ENGINE` | `local` | 缺省引擎，可设 `cloud` |
| `DASHSCOPE_API_KEY` | 无 | 必填；缺失时返回 `E_DEP`，**不会静默回退本地** |
| `NOTE_TAKER_CLOUD_ASR_URL` | DashScope 公共 HTTP 地址 | 换成 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` 即走业务空间专属域名 |
| `NOTE_TAKER_CLOUD_ASR_MODEL` | `qwen-audio-3.0-asr-flash` | 可换 `qwen-audio-3.1-asr-flash`（支持润色与说话人分离） |
| `NOTE_TAKER_ASR_TERMS` | 无 | 逗号分隔的领域词表，作为上下文提升专有名词识别 |
| `NOTE_TAKER_ASR_CHUNK_SECONDS` | `300` | 长音频分片时长，超长会议按此切片串行识别 |

单次调用也可覆盖：`meeting_transcribe` 的 `engine` 参数（`local` / `cloud`）。

### 实测性能（本机，2026-11-10）

| 样本 | 引擎 | 结果 |
|---|---|---|
| 2 分钟现场录音 | local `small` | 15 段 / 26s / 术语大量错字（灰度→歸度、决议→绝议） |
| 2 分钟现场录音 | cloud | 19 段 / 12s / 术语正确（FDE、智慧食堂、XXX） |
| **47 分钟现场录音** | cloud（10 片） | **553 段 / 15647 字 / 351s（rtf 0.124）** |
| 47 分钟现场录音 | local `small` | 903 段 / 8141 字 / 540s（rtf 0.19），术语错误多 |

结论：**云端又快又准**，但会把音频上传到阿里云；本地引擎不联网、可离线，质量取决于模型档位与录音条件。

### 隐私

使用 `engine=cloud` 时音频会上传至阿里云百炼（DashScope）。首次云端调用会在返回值与日志各留一次明确提示；
本地引擎保持零外发。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run verify` | 结构清单 + 全部单测（当前 26 项结构 + 127 单测） |
| `npm run verify -- --structure-only` | 只做结构检查 |
| `npm test` | 只跑单测 |
| `node scripts/smoke-record.mjs 3` | 真录 3 秒并核对 wav 参数（需要麦克风） |
| `node scripts/smoke-transcribe.mjs --audio <wav> tiny` | 拿真实语音跑本地转写并核对产物 |
| `node scripts/e2e.mjs 5 tiny` | 录音→转写→纪要整链演练（纪要那步用桩模型） |

Windows 控制台注意：脚本输出含中文与符号，执行前建议 `set PYTHONUTF8=1`（PowerShell: `$env:PYTHONUTF8='1'`），
否则可能在 GBK 代码页下报编码错误（lessons L-07）。

## 数据目录

默认 `~/.dsh/note-taker`：

```
meetings.json          会议索引
recordings/<id>.wav    录音（16kHz 单声道）
transcripts/<id>.md    转录
transcripts/<id>.json  分段明细
minutes/<id>.md        纪要
models/                本地转写模型（faster-whisper-<档位>/）
```

**覆盖方式**：设置环境变量 `NOTE_TAKER_DATA` 指向任意可写目录。开发期务必这么做——
会话工作区对 `~/.dsh` 只读（lessons L-06）。

其他可选环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `NOTE_TAKER_MODEL` | `small` | faster-whisper 模型档位 |
| `NOTE_TAKER_MODEL_DIR` | `%LOCALAPPDATA%\note-taker-models` | 本地模型目录（smoke 脚本用） |
| `NOTE_TAKER_THREADS` | `6` | 转写线程数（本机 4P+8E，别用满） |
| `NOTE_TAKER_HF_ENDPOINT` | `https://hf-mirror.com` | 模型下载镜像 |
| `NOTE_TAKER_LLM_PROVIDER` / `NOTE_TAKER_LLM_MODEL` | 空（用宿主当前配置） | 生成纪要时指定的模型路由 |

## 隐私边界

- 音频与转写文本只在本机处理与存储，不外发。
- **生成纪要时**，转写文本会发送给**你在 DSH 中已配置的模型服务**；首次生成前会明确提示。

## 已知问题

1. **headless profile 下插件不挂载**：用 `dsh plugin add` 装进新建 profile 后，
   `--dump-config` 能看到插件条目、模块也能 `import`，但 `apply()` 不执行、工具不出现（无报错）。
   复现物在 `~/.dsh/profiles/notetaker-verify`，细节见 `specs/_project/lessons.md` L-10。
   日常使用请装在 `desktop`/`web` 这类图形 profile 里，装完开一个会话确认能看到 `meeting_*` 工具。
2. **模型首次使用要手工下载**：见上文「转写模型」，转写侧不做运行时自动下载。

## 相关文档

- 实施方案：[docs/dsh-note-taker-方案.md](docs/dsh-note-taker-方案.md)
- 需求/方案/任务：[specs/20261110_project-skeleton/](specs/20261110_project-skeleton/)
- 项目台账：[specs/_project/profile.md](specs/_project/profile.md)
