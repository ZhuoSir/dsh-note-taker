# 会记 dsh-note-taker

DSH 插件：**录音 → 本机转写 → 会议纪要**。录音与转写全程在本机；纪要由你在 DSH 里已配置的模型生成。

> 当前进度：spec `specs/20261110_project-skeleton` v1.0.0，**10/11 任务完成**。
> 录音、转写、纪要三条链路均已实测（录音 16k/单声道、转写 rtf≈0.1、单测 63 全绿）；
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
- 镜像可用 `NOTE_TAKER_HF_ENDPOINT` 覆盖（默认 `https://hf-mirror.com`，要直连官方就设成 `https://huggingface.co`）
- 下载慢是常态（实测 ~90 KB/s），`small` 大约要一个多小时，可以先拿 `tiny` 跑通链路

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run verify` | 结构清单 + 全部单测（当前 20 项结构 + 63 单测） |
| `npm run verify -- --structure-only` | 只做结构检查 |
| `npm test` | 只跑单测 |
| `node scripts/smoke-record.mjs 3` | 真录 3 秒并核对 wav 参数（需要麦克风） |
| `node scripts/smoke-transcribe.mjs --audio <wav> tiny` | 拿真实语音跑转写并核对产物 |
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

## 相关文档

- 实施方案：[docs/dsh-note-taker-方案.md](docs/dsh-note-taker-方案.md)
- 需求/方案/任务：[specs/20261110_project-skeleton/](specs/20261110_project-skeleton/)
- 项目台账：[specs/_project/profile.md](specs/_project/profile.md)
