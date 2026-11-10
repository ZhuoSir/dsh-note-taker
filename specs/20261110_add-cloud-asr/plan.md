> 版本: v1.0.0 | 状态: 已确认 | 更新: 2026-11-10 | 确认人: 陈卓 | 确认日期: 2026-11-10

# 技术方案：add-cloud-asr

## 坑核对（门控节，确认②先审这一节）

已核对 `specs/_project/lessons.md` 中 **9 条 active 坑**（L-04/L-11 已休眠/退休，不计），相交 4 条：

| 坑 | 相交 | 本方案如何避开 |
|---|---|---|
| L-01 sherpa 在 3.14 不可用 | 否 | 本版不碰本地分人 |
| L-02 pip/装包被 ACL 拦 | **是** | 新增的 `ws` 依赖走 npm（此前 `pnpm add` 在 profile 里成功过），Python 侧不加任何依赖——云端 ASR 全程用 Node 实现，不新增 Python 包 |
| L-03 工作区权限 | 否（已修） | — |
| L-04 造不出测试音频 | 否（休眠） | 已有真实 m4a 与 SAPI 样本可用作手工验证 |
| L-05 起名撞车 | 否 | 不新增包名 |
| L-06 `~/.dsh` 只读 | **是** | 云端结果仍写入 `NOTE_TAKER_DATA` 覆盖的数据根，沿用既有路径解析 |
| L-07 GBK 控制台 | 否 | 本版全在 Node 侧，无 Python 输出 |
| L-08 HF 直连不可用 | 否 | 本版不下载模型 |
| L-09 环境结论会失效 | **是** | 阿里云域名有「旧域名迁移到 Workspace 专属域名」两套，方案里做成可配（见决策 3），不写死 |
| L-10 headless 不挂载插件 | 否 | 本版不依赖插件挂载即可自测（纯 Node 模块 + 假客户端） |

## 方案概述

在 Node 侧新增一个 **cloud ASR 客户端**，把整段音频文件按百炼实时语音识别协议推送出去，
把最终句级结果聚合成与本地引擎**完全同构**的 `transcripts/<id>.md|json`。
本地引擎一行不动，只在 `service.transcribe` 的入口按 `engine` 分派。

关键事实（来自官方文档，已核实）：

- 连接：`wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`（新域名），
  旧域名 `wss://dashscope.aliyuncs.com/api-ws/v1/inference` 仍可用 → 做成可配
- 鉴权：握手头 `Authorization: Bearer <API_KEY>`，可选 `X-DashScope-WorkSpace`
- 流程：连接 → `run-task` → 等 `task-started` → 推**单声道**二进制音频 →
  持续收 `result-generated` → `finish-task` → 收 `task-finished` → 关闭
- 结果：`payload.output.sentence`，含 `begin_time`/`end_time`（**毫秒**）、`text`、
  `sentence_id`、`sentence_begin`/`sentence_end`、`heartbeat`
  → 只取 `sentence_end=true` 且 `heartbeat!=true` 的句子，毫秒转秒

## 模块与数据流

```
lib/asr/config.js     云端配置解析（可插拔来源；当前 env）
lib/asr/cloud.js      百炼 WebSocket 客户端：连接/run-task/推流/收结果/finish-task/超时
lib/asr/aggregate.js  服务端事件 → 句子数组（纯函数，单测主战场）
lib/asr/pcm.js        音频文件 → 16k 单声道 PCM 分帧（纯函数 + PyAV 解码复用）
lib/service.js        只改一处：transcribe() 按 engine 分派 local / cloud
lib/tools.js          meeting_transcribe 增加 engine 参数（可选）
```

数据流：

```
meeting_transcribe(engine=cloud)
  └ service.transcribe → 校验配置（缺 key → E_DEP，不回退）
     ├ pcm.js：解码 + 重采样 16k 单声道 + 切成 100ms 帧
     ├ cloud.js：connect(ws) → run-task → 等 task-started
     │            → 按节奏推帧（默认 1x 实时）
     │            → finish-task → 等 task-finished
     ├ aggregate.js：句级结果 → segments[{start,end,text}]
     └ 落盘 transcripts/<id>.md|json（与本地同构，json 增加 engine='cloud'）
```

## 协议契约

`run-task`（连接建立后立刻发，等到 `task-started` 才推音频）：

```json
{
  "header": { "action": "run-task", "task_id": "<uuid>", "streaming": "duplex" },
  "payload": {
    "task_group": "audio",
    "task": "asr",
    "function": "recognition",
    "model": "qwen-audio-3.0-asr-flash-streaming",
    "parameters": {
      "format": "pcm",
      "sample_rate": 16000,
      "max_sentence_silence": 800,
      "vocabulary": { "XXX": 3 },
      "language_hints": ["zh"]
    },
    "input": {}
  }
}
```

- `vocabulary` / `language_hints` 仅在配置提供时出现（R-04）
- 音频帧：裸 PCM 16bit 小端、单声道、16kHz，**每帧 100ms（3200 字节）**
- `finish-task`：`{ header:{action:'finish-task', task_id, streaming:'duplex'}, payload:{ input:{} } }`

服务端事件处理：

| event | 处理 |
|---|---|
| `task-started` | 记日志，开始推帧 |
| `result-generated` | 解析 `payload.output.sentence`；`heartbeat=true` 或 `sentence_end!=true` 丢弃；否则收集 |
| `task-finished` | 结束收集，记录 usage（duration/tokens） |
| `task-failed` | 以 `E_LLM` 返回，附服务端 `error_code/message` |

## 接口设计

工具层（`meeting_transcribe`）新增一个可选参数，其余不变：

| 参数 | 类型 | 说明 |
|---|---|---|
| `engine` | `local` \| `cloud` | 缺省取配置 `NOTE_TAKER_ASR_ENGINE`（默认 `local`） |
| `meetingId` / `model` | 不变 | `model` 只对本地引擎有意义；云端模型名走配置 |

返回信封新增字段（两种引擎都返回，本地恒为 `local`）：

```
{ ok:true, meetingId, engine:'cloud', segments, chars, durationSec, rtf, transcriptPath, stats }
```

配置来源（`lib/asr/config.js`，接口设计成可插拔，页面配置只换实现）：

| 键 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| 引擎 | `NOTE_TAKER_ASR_ENGINE` | `local` | 缺省引擎 |
| 密钥 | `DASHSCOPE_API_KEY` | 无 | 缺失 → `E_DEP` |
| 模型 | `NOTE_TAKER_CLOUD_ASR_MODEL` | `qwen-audio-3.0-asr-flash-streaming` | 可配 |
| 地址 | `NOTE_TAKER_CLOUD_ASR_URL` | `wss://dashscope.aliyuncs.com/api-ws/v1/inference` | 旧域名默认，可换 Workspace 专属域名 |
| 术语 | `NOTE_TAKER_ASR_TERMS` | 无 | 逗号分隔，转成 `vocabulary` 权重 3 |
| 推流倍速 | `NOTE_TAKER_ASR_SPEED` | `1.0` | 1x 实时；先按 1x 稳，实测后再提 |

## 数据模型

`transcripts/<id>.json` 与本地同构，仅新增一个字段：

```json
{ "meetingId":"…", "engine":"cloud", "model":"qwen-audio-3.0-asr-flash-streaming",
  "language":"zh", "segments":[{"start":0.16,"end":1.64,"text":"欢迎使用阿里云。"}],
  "stats":{"segments":1,"durationSec":1.64,"chars":8},
  "usage":{"duration":2,"totalTokens":89}, "elapsedSec":12.3, "rtf":0.4 }
```

`transcripts/<id>.md` 格式完全不变：`[HH:MM:SS] 正文`（`lib/parse.js` 依赖）。

`meetings.json` 不变（`status.transcribe`、`errors.transcribe` 沿用）。

## 共享面身份矩阵

判据「还有谁依赖这个路径/字段？」——本次**触碰三个共享面**，逐身份列出：

| 对象 | 既有身份（谁在用） | 变更后预期行为 | 断言归属 |
|---|---|---|---|
| `transcripts/<id>.md` | `lib/parse.js` 解析（service 用它算 stats）；纪要生成读它 | 云端产出与本地同格式，`parse.js` 无需改动即可解析 | T-03（聚合）+ T-07（端到端） |
| `transcripts/<id>.json` | 当前无代码消费者，但 completion/README 已把它写成契约 | 云端写入时键集合 = 本地键集合 + `engine`/`usage`/`rtf` | T-05 |
| `meeting_transcribe` 工具 | Agent（现有调用**不带** `engine`） | 不带 `engine` 时行为与现在完全一致；带 `cloud` 才走新路径 | T-06 |
| `meetings.json` 的 `status.transcribe` / `errors.transcribe` | `service.minutes()` 判 `transcribe==='done'`；`meeting_status` 返回 | 云端成功同样置 `done`；失败置 `failed` 并写原因 | T-06 |

矩阵没有列到的身份 = 未评估；本表四个身份都有对应断言。

## 关键日志点清单

遵循 `standards/logging.md` 四类强制点（本版涉及：服务启停中的外部连接、外部调用、批处理、安全事件）：

| 场景 | 级别 | 触发点 | 必带字段 | runId |
|---|---|---|---|---|
| 云端外发告知（安全事件） | INFO | `service.transcribe` 首次云端调用 | meetingId、endpoint 主机名（不含 key） | meetingId |
| 连接建立 | INFO | `cloud.js connect` | meetingId、host、耗时 | runId |
| `task-started` | INFO | `cloud.js` | meetingId、taskId、model | runId |
| 推流进度（批处理） | DEBUG | 每 300 帧 | meetingId、已推字节、帧数 | runId |
| 首条最终结果 | INFO | `cloud.js` | meetingId、sentenceId、累计句数 | runId |
| `task-finished` | INFO | `cloud.js` | meetingId、句数、usage.duration、总耗时 | runId |
| 连接/推流失败 | ERROR | `cloud.js` | meetingId、code、服务端 error_code、stderr 式原因（不含 key） | runId |
| 密钥缺失 | ERROR | `config.js` | 需要的环境变量名 | — |
| 术语超限截断 | WARN | `config.js` | 原始条数、截断后条数 | — |
| 引擎分派 | INFO | `service.transcribe` | meetingId、engine | meetingId |

敏感纪律：日志与错误 detail 都不得出现 API Key、音频字节、转写正文。

## 关键决策

### 决策 1：WebSocket 用 `ws` 包（唯一新增依赖）

- 采用：`ws`（成熟、支持握手自定义头）。
- 理由：Node 24 内置 `WebSocket` 构造器**只接受 url 与子协议，无法传自定义请求头**，而百炼要求
  `Authorization: Bearer <key>` 走握手头；用内置实现只能去改 URL 传 key（文档未支持）。
- 被拒：Node 内置 WebSocket。理由：不能带鉴权头。
- 被拒：手写 WebSocket 帧协议（net/tls + RFC6455）。理由：约 200 行且要处理分片/掩码/心跳，
  出错面比多一个依赖更大。
- 重新评估条件：Node 内置实现支持 headers 时。

### 决策 2：先按 1x 实时速率推流

- 采用：帧间隔默认与音频时长一致（100ms 帧 → 100ms 间隔），倍速可配。
- 理由：服务是实时接口，超速推流可能被判异常；先求稳，实测确认后再提速。
- 影响：**47 分钟录音云端转写预计耗时约 47 分钟**（不像本地那样有 rtf<1 的加速）。
  这一点必须在 README 与工具返回里写明，避免用户以为卡死。
- 被拒：一次性把整段音频灌进去。理由：协议是双工流式，服务端没有「整段上传」语义。

### 决策 3：端点与模型名可配，默认给旧域名

- 采用：默认 `wss://dashscope.aliyuncs.com/api-ws/v1/inference` + `qwen-audio-3.0-asr-flash-streaming`，
  两者都可被环境变量覆盖。
- 理由：官方推荐迁移到 `{WorkspaceId}.cn-beijing.maas.aliyuncs.com` 专属域名，但需要 Workspace ID，
  你手上不一定有；先用通用域名能跑，跑通了再切。
- 被拒：写死新域名。理由：没有 Workspace ID 就完全不可用。
- 被拒：写死你给的 `qwen-audio-3.0-asr-flash`（不带 `-streaming`）。理由：文档里 3.0 与 3.1 的
  流式模型都带 `-streaming` 后缀，实测以能通的为准 → 做成可配，README 写清两个候选。

### 决策 4：结果只取句级最终态

- 采用：只收 `sentence_end=true` 且 `heartbeat!=true` 的句子。
- 理由：中间结果会反复改写同一句，混进去会产生重复与错序；句级终态天然就是我们要的 segment。
- 被拒：用 `words` 数组重建时间轴。理由：word 级时间戳只对 3.1 版完整，3.0 不保证；句级已够。

## 风险与规避

| 风险 | 规避 |
|---|---|
| 云端转写耗时接近实时（47 分钟音频 ≈ 47 分钟） | README 与工具返回明示；倍速参数可调，实测后再默认提速 |
| 鉴权/配额失败信息不透明 | 握手失败映射成 `E_DEP`（key 无效）或 `E_LLM`（配额/服务端错），原样带上服务端 error_code |
| 网络抖动导致中途断连 | 空闲 60s 超时中止 + 关闭连接；失败不覆盖既有成功产物（R-09） |
| 音频格式不支持 | 统一解码成 16k 单声道 PCM 再推，绕开格式差异 |
| 术语/语言参数超过服务端上限 | 截断并打 WARN（R-04 边界） |
| 密钥泄露 | 只从配置读，不进日志、不进错误 detail、不进 git |
| 模型名猜错 | 可配 + README 列候选；失败时把服务端返回的 model 不支持信息原样透出 |

## 依赖与前置

- 新增 npm 依赖：`ws`（唯一）
- 百度…（无）
- 需要你提供：`DASHSCOPE_API_KEY`（环境变量），用于真实调用验证；没有的话 T-07 只能跑假客户端
- 不需要：Python 侧任何改动、新的模型文件
