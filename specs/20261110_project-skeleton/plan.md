> 版本: v1.0.0 | 状态: 已确认 | 更新: 2026-11-10 | 确认人: 陈卓 | 确认日期: 2026-11-10

# 技术方案：project-skeleton（会记 · 基础链路）

## 坑核对（门控节，确认②先审这一节）

已核对 `specs/_project/lessons.md` 中 **7 条 active 坑**，相交 5 条：

| 坑 | 相交 | 本方案如何避开 |
|---|---|---|
| L-01 sherpa-onnx 在 Python 3.14 不可用 | 否 | 本版不做分人（BL-02）。将来接入按该条规则走独立 3.12 进程，不在此版埋雷 |
| L-02 工作区 ACL 让 pip 装包失败 | **是** | 采集库一律离线安装：`urllib` 下 wheel → `zipfile` 解到 `pylibs/` → `PYTHONPATH` 注入。README 的安装段只写这条路，不写 `pip install`；安装脚本幂等，已存在则跳过 |
| L-03 工作区权限导致命令起不来 | 是（已修） | init 时已修复并留恢复件（`dsh-note-taker-acl-logs/`）。verify 脚本第一次执行就是在验证命令层可用；若再犯，按该条规则一条命令修，不改被执行的命令 |
| L-04 造不出测试音频 | **是** | 验收不用 TTS：录音链路自身是音源，T-11 用真人说话录音，rtf 与时长全部实测记录，禁止拿估算值当结果 |
| L-05 起名不查注册表 | 否 | 包名 `dsh-note-taker` 已于 2026-11-10 核实为空号 |
| L-06 开发期写 `~/.dsh` 被拒 | **是** | 数据根从第一版就支持 `NOTE_TAKER_DATA` 覆盖，代码内不出现硬编码 homedir；verify 与单测全部跑在临时目录 |
| L-07 表检/脚本在 GBK 控制台崩 | **是** | 所有 Python sidecar 开头 `sys.stdout.reconfigure(encoding='utf-8')`；verify 与 README 执行前设 `PYTHONUTF8=1`；Node 侧 spawn 时显式传 `PYTHONUTF8=1` 与 `PYTHONIOENCODING=utf-8` |

补充（本轮新踩）：给表检脚本传多个文件时不能拼成一个逗号串，必须逐个传参——已并入 L-07 的防再犯规则。

## 方案概述

三件事全部在**宿主侧**完成，本版没有浏览器代码、没有 HTTP 路由（页面属 BL-01）。
Node 负责编排、状态、持久化与模型调用；Python 负责音频与转写；两侧只通过
「文件路径 + 一行 JSON」通信，接口面窄到可以手写。

- 录音：spawn `py/record.py`，默认输入设备 → 16k/单声道/16bit wav，stdin 收 `stop` 收尾
- 转写：spawn `py/transcribe.py`（faster-whisper 1.2.1，已装）→ `transcripts/<id>.{md,json}`
- 纪要：读转写 → 组装固定结构提示 → `ctx.llm.stream()` → 校验 → `minutes/<id>.md`

对应 R-01/R-07（加载与工具）、R-02（存储）、R-03（录音）、R-04（转写）、R-05（解析）、
R-06（纪要）、R-08（隐私）、R-09/R-10（骨架与单测）。

## 模块与分层

```
lib/index.js        插件入口：export name / inject ['tools','llm'] / apply(ctx)
lib/logger.js       结构化日志（级别、k=v、runId、脱敏）；不引第三方库
lib/meetings.js     会议存储：meetings.json 事务读写、去重、排序
lib/parse.js        转写解析与统计（纯函数，零依赖）
lib/minutes.js      提示组装 + llm 调用 + 结构校验 + 落盘
lib/llm.js          ctx.llm.stream 的薄封装（超时、异常收敛、用量日志）
lib/py.js           spawn sidecar：UTF-8、超时、stderr 尾部、退出码
lib/errors.js       错误码常量与 ok/err 信封构造（错误码头，唯一来源）
lib/jobs.js         串行队列与状态迁移（录音/转写/纪要互斥）
py/record.py        录音 sidecar
py/transcribe.py    faster-whisper sidecar
py/_common.py       UTF-8 重配置、参数校验、JSON 输出
scripts/verify.mjs  结构清单 + 单测入口
scripts/install-py.mjs  离线安装采集库（L-02 路径）
tests/*.test.js     node --test
README.md           目录树、分层职责、安装、命令、数据目录
```

分层纪律：`lib/` 里除 `index.js` 外不出现 `ctx`；副作用集中在 `py.js` / `llm.js` /
`meetings.js`，其余是纯函数，便于单测。

## 数据流

```
meeting_record_start(label?)
  └ meetings.create(status.record=running) → spawn record.py
     └ 边写 recordings/<id>.wav，边按块记字节数

meeting_record_stop()
  └ stdin 'stop' → sidecar 写 WAV 头并退出
     └ 读 WAV 头得时长 → meetings.patch(record=done, durationSec)

meeting_transcribe(meetingId?)
  └ jobs.run('transcribe') → spawn transcribe.py → transcripts/<id>.{md,json}
     └ parse.js 解析统计 → meetings.patch(transcribe=done, stats)

meeting_minutes(meetingId?)
  └ 读 transcripts/<id>.md → parse → 组装提示 → ctx.llm.stream
     └ 结构校验 → 通过则写 minutes/<id>.md；不通过 → 列缺失项、状态 failed
```

## 接口设计

工具契约（`ctx.tools.register`；`output.type='text'`，内容为信封 JSON 的字符串形式）：

| 工具 | 参数 | 成功返回 | 可返回错误 |
|---|---|---|---|
| `meeting_record_start` | `label?`（≤60 字） | `{ ok:true, meetingId, startedAt, status }` | `E_DEP` 采集库缺失 / `E_DEVICE` 无设备 / `E_STATE` 已在录音 |
| `meeting_record_stop` | — | `{ ok:true, meetingId, durationSec, audioPath }` | `E_STATE` 未在录音 / `E_AUDIO` 文件不可读 |
| `meeting_transcribe` | `meetingId?`、`model?`（`small`\|`medium`） | `{ ok:true, meetingId, segments, durationSec, rtf, transcriptPath, stats }` | `E_MODEL` / `E_AUDIO` / `E_DEP` / `E_STATE` |
| `meeting_minutes` | `meetingId?`、`force?` | `{ ok:true, meetingId, minutesPath, markdown, notice }` | `E_LLM` / `E_STATE`（未转写或校验不通过） |
| `meeting_list` | `limit?`（1–100，默认 20） | `{ ok:true, meetings:[...] }` | — |
| `meeting_status` | `meetingId` | `{ ok:true, meetingId, status, errors }` | `E_STATE` 不存在 |

错误信封与成功信封（唯一构造入口 `lib/errors.js`）：

```
{ ok:false, code:'E_DEVICE', message:'默认输入设备不可用，请检查系统录音设备', detail:{ device:'…' } }
```

按 `standards/api-design.md` 迁移的三条（HTTP 专属条款不适用——本版无 HTTP 路由）：

- **单一信封**：成功/失败都走同一个 `ok` 字段，不混用两套；错误码集中在一个常量模块，不散落硬编码
- **message 人类可读、不泄漏内部信息**：堆栈、Python 原始 stderr、绝对路径只进日志，不进 message；
  `detail` 里只放排查必需的最小字段
- **入参在入口统一校验**（不信任调用方）：`label` 长度、`limit` 范围、`model` 取值白名单、
  `meetingId` 格式；校验失败返回 `E_STATE` + `detail.field`
  —— R-07 的错误码是封闭集合，新增 `E_PARAM` 属需求变更，本版不擅自扩；确有需要走 CR（minor）
- **时间统一 ISO 8601 带偏移**（`2026-11-10T11:45:00+08:00`），落盘与返回一致

## 数据模型

根目录 = `NOTE_TAKER_DATA` || `~/.dsh/note-taker`：

```
meetings.json              索引（原子写：写 meetings.json.tmp → rename；解析失败报错不重置）
recordings/<id>.wav        16kHz / 单声道 / 16bit PCM
transcripts/<id>.md        人类可读转录
transcripts/<id>.json      { meetingId, model, language, segments:[{start,end,text}], stats }
minutes/<id>.md            纪要
logs/app.log               结构化日志（INFO 及以上）
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
  "stats": { "segments": 42, "chars": 5120 },
  "errors": { "transcribe": null, "minutes": null }
}
```

- 状态取值 `pending | running | done | failed`；迁移只允许单向推进，失败只置 `failed` 并写 `errors`
- 并发：所有写操作进 `lib/jobs.js` 的单队列串行化；录音是单实例，第二次 start 直接 `E_STATE`
- 去重：导入路径按 wav 的 sha256 命中既有条目即返回既有 id
- 不引入数据库：`.specrc.yml` 中 `database: none`，会议量级是每周几条

## 共享面评估

按判据「还有谁依赖这个路径 / 列 / 配置？」逐项自检：

| 对象 | 既有消费者 | 结论 |
|---|---|---|
| 数据目录 `~/.dsh/note-taker` | 无（旧脚手架未安装进任何 profile，该目录当前不存在） | 非共享面 |
| 工具名 `meeting_*` | 无（旧插件未加载） | 非共享面 |
| 文件布局 `recordings/ transcripts/ minutes/` | 无 | 非共享面 |
| 新增依赖（采集库、faster-whisper 已有版本） | 仅本插件 | 非共享面；依赖本身是本版最大外部风险，见风险节 |
| `NOTE_TAKER_DATA` 环境变量 | 无既有使用者 | 非共享面 |

结论：**本 spec 不触碰共享面，故不设身份矩阵**。BL-01 引入 HTTP 路由时会新出现共享面
（路径一旦发布就有外部消费者），届时必须补身份矩阵。

## 关键日志点清单

按 `standards/logging.md` 的四类强制日志点逐项落到本项目的触发点：

| 场景 | 级别 | 触发点 | 必带字段 | runId |
|---|---|---|---|---|
| 插件启动（服务启停） | INFO | `apply()` 首行 | 插件名、版本、工具数、数据根、数据根来源（env/默认） | — |
| 配置与默认值加载 | INFO | `apply()` | 默认模型、线程数、是否首次运行 | — |
| 数据根不可写 | ERROR | `apply()` 自检 | 路径、errno、建议动作 | — |
| 录音开始（安全事件：隐私采集） | INFO | `meeting_record_start` | meetingId、设备名、采样率、目标路径 | meetingId |
| 录音结束 | INFO | `meeting_record_stop` | meetingId、时长、字节数、sidecar 退出码 | meetingId |
| 录音失败 | ERROR | 录音 job | meetingId、错误码、stderr 末尾 500 字 | meetingId |
| 调用转写 sidecar（外部调用，出） | DEBUG | `lib/py.js` | 目标脚本、参数摘要（不含音频内容） | jobId |
| 调用转写 sidecar（回） | INFO | `lib/py.js` | 退出码、耗时 | jobId |
| 转写任务开始（批处理） | INFO | 转写 job | runId、meetingId、模型、音频时长 | jobId |
| 转写任务结束（批处理） | INFO | 转写 job | runId、段数、字符数、rtf、耗时、失败数 | jobId |
| 转写失败 | ERROR | 转写 job | runId、错误码、stderr 末尾 | jobId |
| 纪要生成开始（外部调用：模型） | INFO | `meeting_minutes` | meetingId、provider、model、输入字符数 | runId |
| 纪要生成结束（外部调用：模型） | INFO | `meeting_minutes` | meetingId、耗时、输出字符数、校验结果 | runId |
| 纪要校验不通过 | WARN | `lib/minutes.js` | meetingId、缺失章节列表 | runId |
| 模型调用失败 | ERROR | `lib/llm.js` | meetingId、provider、错误码、耗时 | runId |
| 隐私提示首次触发（安全事件） | INFO | `meeting_minutes` 首次调用 | meetingId、外发内容摘要（只记字符数，不记正文） | runId |
| 会议去重命中 | INFO | `lib/meetings.js` | 新 meetingId、命中既有 id | — |
| 状态迁移 | INFO | `lib/jobs.js` | meetingId、字段、旧值 → 新值 | meetingId |

敏感纪律（红线级）：

- **转写正文、纪要正文、模型提示词、模型返回原文一律不进日志**，只记字符数
- 设备名可记；用户名与路径中的用户目录**不落日志**（记相对路径或 `<data>` 占位）
- 错误消息进响应体时不含堆栈；堆栈只进日志
- 级别判据：可预期失败（无设备、未转写）用 WARN/INFO，不占 ERROR；ERROR 只留给需要人介入的情形

## 关键决策

### 决策 1：录音走宿主侧 Python sidecar

- 采用：spawn `py/record.py`，读默认输入设备 → 16k/单声道 wav；首选 `sounddevice`
  （wheel 自带 PortAudio 二进制），备选 `soundcard`。
- 理由：无浏览器依赖、无客户端构建链，Agent 可直接驱动；采集发生在宿主进程，长录音不受页面生命周期影响。
- 被拒：浏览器 `getUserMedia` + `MediaRecorder`。理由：要新增 React + esbuild 构建链与 `dsh.client`
  入口，Electron 下麦克风权限未验证，把「先跑通」成本抬高约一倍。重新评估条件：BL-01 做页面时接入，
  顺带解决设备选择与免安装。
- 被拒：`ffmpeg` 命令行录制。理由：本机无 ffmpeg 二进制需另装，而转写解码已由 PyAV 覆盖。

### 决策 2：纪要由宿主侧调用已配置模型生成

- 采用：`lib/minutes.js` 组装固定结构提示 → `lib/llm.js` 调 `ctx.llm.stream`
  → 收敛全文 → 结构校验 → 落盘。
- 理由：纪要的核心价值是语义提炼，代码无法产出摘要与决议；宿主侧调用使结果可复现、可校验、可落盘。
  该服务的存在性已在 `dsh-vision-router`（`inject=['tools','llm']`）中确认。
- 被拒：本地模板拼装（把转写切段塞进小标题）。理由：那是假功能，产出不可读，属于骗验收。
- 被拒：把转写丢回对话让 Agent 现写。理由：不落盘、不可复现、无法校验结构。
  **保留为降级路径**：模型不可用时提示用户「可让 Agent 在对话里整理」，但不冒充落盘产物。

### 决策 3：单 JSON 索引 + 每会议独立文件

- 采用：`meetings.json` 存索引，音频/转写/纪要按 id 命名分目录；写入用临时文件 + rename。
- 理由：零依赖、可人读、可 grep、可手工修复；本场景会议量小。
- 被拒：SQLite。理由：多一个原生依赖并引入迁移问题，而 `.specrc.yml` 已声明无库表需求。
- 被拒：每会议一目录靠扫描。理由：排序与去重要靠索引，扫描实现更脆。
- 重新评估条件：会议数 > 5000 或需要按内容检索。

### 决策 4：重建而非迁移旧代码

- 采用：本仓库从零写，旧脚手架只作参考、不复制。
- 理由：旧代码无版本控制与测试，且 `record.py` 全量内存缓存、`latest` 未实现、`DATA_ROOT`
  硬编码 homedir 三处都要重写，重建更快也更干净。
- 被拒：先复制再改。理由：会把上述缺陷一并继承，且旧代码从未被任何测试覆盖过。

## 风险与规避

| 风险 | 概率 | 规避 |
|---|---|---|
| 采集库离线安装失败（最可能失败的一环） | 中 | 优先 `sounddevice`（自带 PortAudio），失败退 `soundcard`；两者都失败则降级为「导入已有音频文件」路径——转写与纪要照常可用，R-04/R-06 验收不受影响，README 写明 |
| `ctx.llm.stream` 参数形状与预期不符 | 中 | 先写最小调用脚本验证形状，再写正式实现；不符则按实际形状改 `lib/llm.js`，不带猜测继续 |
| 可用内存 3.1–3.3 GB | 高 | 默认 `small`；录音边录边写不缓存全量；录音/转写/纪要三者串行 |
| 模型输出结构不稳定 | 中 | 校验器兜底：不通过则不落盘并列出缺失项；`force` 允许重试一次 |
| 长会议（>30 分钟）内存与耗时 | 中 | 本版按 ≤30 分钟验证；分块与上限记 BL-04，不在此版承诺 |
| 转录时间戳与真实时间漂移 | 低 | 解析阶段做单调性校验，异常时报错而非静默 |

## 依赖与前置

- 已就绪：Node 24.16、Python 3.14.5、faster-whisper 1.2.1、ctranslate2 4.8.1、PyAV、numpy
- 需新增：录音采集库（`sounddevice` 或 `soundcard`）及其依赖，按 L-02 离线安装
- 需验证：`ctx.llm` 的实际参数形状（决策 2 的前置，违反前提则回改本文件并重走确认②）
- 不需要：数据库、浏览器构建链、HTTP 路由、任何第三方服务
