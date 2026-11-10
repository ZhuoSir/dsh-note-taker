> 版本: v0.2.0 | 状态: 草稿 | 更新: 2026-11-10

# 技术方案：project-skeleton（会记 · 基础链路）

## 坑核对（必读，确认②审这一节）

已核对 `specs/_project/lessons.md` 中 **7 条 active 坑**（L-01~L-07），相交 5 条：

| 坑 | 是否相交 | 本方案如何避开 |
|---|---|---|
| L-01 sherpa-onnx 在 3.14 不可用 | 不相交 | 本版不做分人（BL-02）；将来接入时按该条规则走独立 3.12 进程 |
| L-02 工作区 ACL 让 pip 装包失败 | **相交** | 录音采集库一律走离线安装：`urllib` 下 wheel → `zipfile` 解到 `pylibs/` → 以 `NODE_OPTIONS` 外的 `PYTHONPATH` 注入；写进 README 的安装步骤，不尝试 pip |
| L-03 工作区权限导致命令起不来 | 相交 | 已在本仓库 init 时修复（恢复件在 `dsh-note-taker-acl-logs/`）；verify 脚本首次执行即验证命令层可用 |
| L-04 造不出测试音频 | **相交** | 验收不用 TTS 合成音频：录音链路自身就是音源，T-11 端到端演练用真人说话录音，指标全部来自实测 |
| L-05 起名不查注册表 | 不相交 | 包名已定 `dsh-note-taker`（npm 空号，2026-11-10 核实） |
| L-06 开发期写 `~/.dsh` 被拒 | **相交** | 数据根第一版就做成可覆盖（`NOTE_TAKER_DATA`），开发期指向工作区；禁止硬编码 homedir |
| L-07 表检脚本在 GBK 控制台崩 | **相交** | verify 与所有 Python sidecar 统一 UTF-8：脚本内 `sys.stdout.reconfigure(encoding='utf-8')`，verify 执行前设 `PYTHONUTF8=1` |

## 方案概述

三件事，全部在**宿主侧**完成，本版没有浏览器代码、没有 HTTP 路由（那属于 BL-01 的页面）。

1. **录音**：宿主侧 spawn 一个 Python 采集 sidecar，按 16k/单声道写 wav，`stdin` 收 `stop` 收尾
2. **转写**：宿主侧 spawn Python 转写 sidecar（faster-whisper，已装），产出 md + json
3. **纪要**：宿主侧读转写 → 组装结构化提示 → `ctx.llm.stream()` 用用户已配置模型生成 →
   结构校验 → 落盘

编排与状态在 Node 侧（`lib/`），重活在 Python 侧（`py/`），两侧只通过「文件路径 + JSON 行」通信。

对应 R：R-01/R-07（工具与加载）、R-02（存储）、R-03（录音）、R-04（转写）、R-05（解析）、
R-06（纪要）、R-08（隐私）、R-09/R-10（骨架与单测）。

## 涉及模块与数据流

```
lib/index.js          插件入口：inject ['tools','llm']，注册 6 个工具，启动日志
lib/meetings.js      会议存储：meetings.json 读写、原子写、去重、排序
lib/parse.js         转写解析与统计（纯函数，零依赖，单测主战场）
lib/minutes.js       纪要提示组装 + ctx.llm.stream 调用 + 结构校验 + 落盘
lib/jobs.js          状态机与串行队列（录音/转写/纪要互斥，防并发）
lib/py.js            spawn Python sidecar、UTF-8、超时、stderr 捕获
py/record.py         采集 sidecar：默认输入设备 → 16k 单声道 wav，stdin 收 stop
py/transcribe.py     faster-whisper sidecar：wav → {segments,md,json}
scripts/verify.mjs   结构清单校验 + 单测
tests/*.test.js      node --test：parse / minutes 校验 / meetings 存储
```

数据流：

```
工具 meeting_record_start
   └→ meetings.create(status.record=recording) → spawn py/record.py → 写 recordings/<id>.wav
工具 meeting_record_stop
   └→ stdin "stop" → sidecar 收尾 → 读 wav 头得到时长 → meetings.patch(record=done)
工具 meeting_transcribe
   └→ jobs.run(transcribe) → spawn py/transcribe.py → transcripts/<id>.{md,json}
   └→ parse.js 解析统计 → meetings.patch(transcribe=done, stats)
工具 meeting_minutes
   └→ 读 transcripts/<id>.md → parse → 组装提示 → ctx.llm.stream → 校验 → minutes/<id>.md
```

## 接口设计

工具契约（`ctx.tools.register`，错误以结构化对象返回，不抛裸异常）：

| 工具 | 参数 | 返回 | 错误 |
|---|---|---|---|
| `meeting_record_start` | `label?` | `{ meetingId, startedAt, status }` | `E_DEP` 采集库缺失 / `E_DEVICE` 无设备 / `E_STATE` 正在录音 |
| `meeting_record_stop` | — | `{ meetingId, durationSec, audioPath }` | `E_STATE` 未在录音 / `E_AUDIO` 文件不可读 |
| `meeting_transcribe` | `meetingId?`（缺省取最近一次）、`model?` | `{ meetingId, segments, durationSec, rtf, transcriptPath, stats }` | `E_MODEL` / `E_AUDIO` / `E_DEP` / `E_STATE` |
| `meeting_minutes` | `meetingId?`、`force?` | `{ meetingId, minutesPath, markdown, notice }` | `E_LLM` / `E_STATE` 未转写 / `E_STATE` 校验不通过（附缺失项） |
| `meeting_list` | `limit?` | `{ meetings: [...] }` | — |
| `meeting_status` | `meetingId` | `{ meetingId, status, errors }` | `E_STATE` 不存在 |

错误信封（统一）：

```
{ ok: false, code: 'E_DEVICE', message: '默认输入设备不可用', detail: { device: '...' } }
```

成功信封：`{ ok: true, ...结果字段 }`。工具 `output.type = 'text'`，内容为上述 JSON 的字符串形式。

## 数据模型

文件布局（根为 `NOTE_TAKER_DATA` || `~/.dsh/note-taker`）：

```
meetings.json                 索引（原子写：<file>.tmp → rename）
recordings/<id>.wav           16kHz 单声道 16bit
transcripts/<id>.md           人类可读转录
transcripts/<id>.json         { meetingId, model, language, segments:[{start,end,text}], stats }
minutes/<id>.md               纪要
```

会议条目：

```json
{
  "id": "20261110-1145-a1b2",
  "label": "周会",
  "startedAt": "2026-11-10T11:45:00+08:00",
  "endedAt": "2026-11-10T11:48:10+08:00",
  "durationSec": 190,
  "audio": { "path": "recordings/20261110-1145-a1b2.wav", "sha256": "…", "sampleRate": 16000, "channels": 1 },
  "status": { "record": "done", "transcribe": "pending", "minutes": "pending" },
  "errors": { "transcribe": null, "minutes": null }
}
```

状态取值：`pending | running | done | failed`。写入串行化（`lib/jobs.js` 单队列），
坏文件 SHALL 在读取时报错而不是静默重置。

## 共享面评估

按判据「还有谁依赖这个路径 / 列 / 配置？」逐项自检：

| 对象 | 既有消费者 | 结论 |
|---|---|---|
| 新增数据目录 `~/.dsh/note-taker` | 无（旧脚手架未安装进任何 profile，该目录当前不存在） | 非共享面 |
| 新增工具名 `meeting_*` | 无（旧插件未加载） | 非共享面 |
| 新增文件布局 `recordings/ transcripts/ minutes/` | 无 | 非共享面 |
| 依赖版本（faster-whisper 1.2.1 / 新增采集库） | 仅本插件 | 非共享面；但**新增依赖是本版最大外部风险**，见风险节 |

结论：**本 spec 不触碰共享面**，故不设身份矩阵；BL-01 引入 HTTP 路由与页面时才需要补。

## 关键日志点清单

| 场景 | 级别 | 触发点 | 必带字段 | runId |
|---|---|---|---|---|
| 插件启动 | INFO | `lib/index.js` apply | 插件名、版本、工具数、数据根 | — |
| 数据根不可写 | ERROR | apply 前的自检 | 路径、错误码 | — |
| 录音开始 | INFO | `meeting_record_start` | meetingId、设备名、采样率、目标路径 | meetingId |
| 录音结束 | INFO | `meeting_record_stop` | meetingId、时长、字节数、退出码 | meetingId |
| 录音失败 | ERROR | 录音 job | meetingId、错误码、stderr 尾部 500 字 | meetingId |
| 转写开始 | INFO | 转写 job | meetingId、模型、音频时长 | jobId |
| 转写结束 | INFO | 转写 job | meetingId、段数、rtf、耗时 | jobId |
| 转写失败 | ERROR | 转写 job | meetingId、错误码、stderr 尾部 | jobId |
| 纪要生成开始 | INFO | `meeting_minutes` | meetingId、provider、model、输入字符数 | runId |
| 纪要生成结束 | INFO | `meeting_minutes` | meetingId、耗时、输出字符数、校验结果 | runId |
| 纪要校验不通过 | WARN | `lib/minutes.js` | meetingId、缺失章节列表 | runId |
| 模型调用失败 | ERROR | `lib/minutes.js` | meetingId、provider、错误码、耗时 | runId |
| 会议去重命中 | INFO | `lib/meetings.js` | 新 meetingId、命中既有 id | — |

敏感纪律：日志只记路径与时长，不记转写正文、不记音频内容；模型提示词与返回正文不进日志。

## 关键决策

### 决策 1：录音走宿主侧 Python sidecar

- 采用：spawn `py/record.py`，默认输入设备 → 16k 单声道 wav；首选 `sounddevice`
  （wheel 自带 PortAudio 二进制，Windows 上 WASAPI 可用），备选 `soundcard`。
- 理由：无浏览器依赖、无客户端构建链，Agent 可直接驱动，录制期间宿主退出也能收尾。
- 被拒绝：浏览器 `getUserMedia` + `MediaRecorder`。理由：需要 React/esbuild 构建链并新增
  `dsh.client` 入口，Electron 下麦克风权限未验证；把「先跑通基本路径」的成本抬高一倍。
  重新评估条件：BL-01 做页面时顺带接入，作为设备选择与免安装的备选。
- 被拒绝：`ffmpeg` 命令行录制。理由：本机无 ffmpeg 二进制，需另装；faster-whisper 已有 PyAV 解码。

### 决策 2：纪要由宿主侧调用已配置模型生成

- 采用：`lib/minutes.js` 组装固定结构提示 → `ctx.llm.stream({ provider, model, messages })`
  → 收敛完整文本 → 结构校验 → 落盘。
- 理由：纪要的核心价值是语义提炼，代码无法产出摘要与决议；宿主侧调用使结果可复现、可校验、可落盘。
- 被拒绝：本地模板拼装（把转写切段填进固定小标题）。理由：那是假功能，产出不可读，等于骗验收。
- 被拒绝：把转写丢回对话让 Agent 现写。理由：不落盘、不可复现、无法校验结构；但保留为降级路径
  （模型服务不可用时提示用户「可让 Agent 在对话里整理」）。
- 被接受的前提：`ctx.llm.stream` 的既有用法已在 `dsh-vision-router`（`inject=['tools','llm']`）
  确认存在；具体参数形状在 T-06 先做最小调用验证，再写正式实现。

### 决策 3：单 JSON 索引 + 每会议独立文件

- 采用：`meetings.json` 存索引，音频/转写/纪要按 id 命名分目录。
- 理由：零依赖、可人读、可 grep、可手工修复；会议量在本场景是「每周几条」量级。
- 被拒绝：SQLite。理由：多一个原生依赖，且会引入迁移问题；本项目无库表需求（`.specrc.yml`
  的 `database: none`）。
- 被拒绝：每会议一个目录、靠扫描目录列表。理由：排序与去重需要索引，扫描实现更脆。
- 重新评估条件：会议数 > 5000 或需要按内容检索时。

### 决策 4：重建而非迁移旧代码

- 采用：本仓库从零写，旧脚手架只作参考。
- 理由：旧代码无版本控制、无可执行测试、录音链路依赖未装库；直接复制会把既有缺陷一起继承。
- 被拒绝：先复制旧代码再改。理由：`record.py` 的全量内存缓存、`latest` 未实现、`DATA_ROOT`
  硬编码 homedir 三处都需要重写，重建反而更快。

## 风险与规避

- **采集库装不上（最可能失败的一环）** → 离线 wheel 解包；仍失败则降级为「导入已有音频文件」
  路径（转写与纪要照常可用），并在 README 写明；此降级不改变 R-04/R-06 的验收。
- **`ctx.llm.stream` 参数形状与预期不符** → T-06 先写 15 行最小调用验证（成功即继续，
  失败即在实现前暴露，按实际形状改 `lib/minutes.js`，不带着猜测继续写）。
- **内存 3.1–3.3 GB** → 默认 `small`、录音边录边写（不缓存全量）、转写与纪要串行。
- **长会议** → 本版按 ≤30 分钟验证；1 小时以上的分块与内存上限记 BL-04，不在本版范围。
- **模型输出结构不稳定** → 以校验器兜住：不合格不落盘、明确列出缺失项，允许 `force` 重试一次。

## 依赖与前置

- 已就绪：Node 24.16、Python 3.14.5、faster-whisper 1.2.1、ctranslate2 4.8.1、PyAV、numpy
- 需新增：录音采集库（`sounddevice` 或 `soundcard`）与其依赖，按 L-02 离线安装
- 需确认的宿主能力：`ctx.llm`（已在 `dsh-vision-router` 的 `inject` 中确认存在）
- 不需要：数据库、浏览器构建链、HTTP 路由、任何第三方服务
