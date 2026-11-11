> 版本: v1.0.0 | 状态: 已确认 | 更新: 2026-11-11 | 确认人: 陈卓 | 确认日期: 2026-11-11

# 技术方案：streaming-asr

## 坑核对（必填，确认②审这一节）

已核对 `specs/_project/lessons.md` 全部 17 条 active/休眠条目，相交 8 条，逐条给做法：

| 坑 | 本方案如何避开 |
|---|---|
| L-06 开发期数据目录不可写 | 流式 PCM 旁路文件写在 `NOTE_TAKER_DATA` 下，不硬编码 `~/.dsh` |
| L-09 「环境不支持」的结论会失效 | CR-01 的「该空间无流式后端」已被本轮实测推翻，方案只依据**本次实测输出**，不引用旧结论 |
| L-10 headless 不挂载插件 | 验证一律在 `dsh web --port 8099` 真实宿主，不指望 headless |
| L-12 词表与分人互斥 | 流式路径不发词表、不做分人，从源头上不制造这个冲突 |
| L-13 宿主工具契约会变 | 若给工具加 `stream` 参数，`output` 仍用 `TEXT_OUTPUT`（同时带 type 与 schema/render） |
| L-14 PowerShell 批量替换吃模板串 | 改 `src/client/*.jsx` 一律用编辑工具/Node 脚本，不用 `-replace` |
| L-15 展示值与执行值两处读配置 | 字幕状态、引擎标识都从服务端同一份 `resolveStreamConfig()` 返回，前端不自己读环境变量 |
| L-16 外部改产物导致状态位失真 | 流式前后端状态全部由服务端 liveState 推导；产物仍按文件内容判断纪要，沿用现有自愈 |
| L-17 沙箱下子进程 EPERM | 本轮会话已是 danger-full-access；若受限，先按 L-17 判定为沙箱问题 |

其余 8 条（L-01/02/03/04/05/07/08/11）与流式链路无相交。

## 方案概述

在**不改动现有非流式路径**的前提下，加一条并行通路：

```
py/record.py  边录边写 WAV（现状）
             ＋边录边写 recordings/<id>.pcm（16k mono s16le，新增）
                    ↓ 宿主 tail 该文件（100ms 轮询读增量）
        lib/asr/stream.js  用 ws 连 wss://<host>/api-ws/v1/realtime?model=qwen3-asr-flash-realtime
                    ↓ session.update → input_audio_buffer.append(base64 PCM)
        服务端事件：speech_started / transcription.text(text+stash) / completed(transcript)
                    ↓
        liveState（内存：finals[]、partial、已发时长、状态机）
                    ↓ GET /note-taker/live?id=   500ms 轮询
        卡片字幕区实时显示；停录后 → 与旧路径同一套落盘（output.js）→ 人工确认 → 交会话
```

满足 R-01~R-10；`stream=false` 时整条链路不参与，行为与改造前逐字一致。

## 探针实测结论（Phase 2 第一件事，已完成）

用真实 2 分钟会议录音的前 20 秒，以 5× 实时速率推流，实测输出（`.tmp/probe-realtime.log`）：

```
[0.13s] OPEN  wss://llm-4n33szuc4n4q3os4.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime
[0.13s] session.created model=qwen3-asr-flash-realtime sr=16000
[0.30s] input_audio_buffer.speech_started
[0.41s] conversation.item.input_audio_transcription.text  {"text":"","stash":"这个","language":"zh"}
[2.79s] input_audio_buffer.speech_stopped
[2.94s] conversation.item.input_audio_transcription.completed
        {"transcript":"这个里面变更的时候可能不需要大量的，比如说我们针对行业的，把它给线上化，或者说把它变成流程化的东西。","usage":{"duration":9}}
```

要点（都来自实测，不是文档推断）：

1. **协议是 OpenAI-Realtime 风格**，不是旧 `run-task/task-started` 那套；端点 `/api-ws/v1/realtime?model=<id>`，鉴权仍用 `Authorization: Bearer`。
2. `session.update` 的 `input_audio_format` 必须写 **`pcm`**；写 `pcm16` 会回 `Internal service error: Audio format is not valid 'pcm16'!`。
3. 中间结果在 `...transcription.text` 事件里分两段：`text`（已定稿部分）+ `stash`（正在改写的部分），**显示要拼 `text + stash`**。
4. 最终结果在 `...transcription.completed`，字段 `transcript`；**没有时间戳字段**，只有 `usage.duration`（分句时长，秒）。
5. 服务端 VAD 自动切句（默认 `silence_duration_ms: 800`），不需要我们手动 commit 分句。
6. 首字延迟：语音开始后约 **0.3 秒**出第一个 `text` 事件；每句定稿在 `speech_stopped` 后约 **0.15 秒**。
7. **`qwen-audio-3.1-realtime-flash` / `qwen-audio-3.0-realtime-flash` 是「全能对话」模型**：喂音频后除了转写还会生成回复（实测 `response.text.done` 返回「哈哈，我猜你可能是想问…」）。用它们做纯转写会额外计费且污染结果 → **不选**。

## 涉及模块与数据流

| 模块 | 改动 |
|---|---|
| `py/record.py` | 新增 `--pcm-out` 参数：同一循环里把 PCM 追加写入旁路文件（不缓存全量） |
| `lib/asr/stream.js` | **新增**：WS 客户端（连接/会话更新/推流/事件归类/重连/收尾）、本地时间轴推导、liveState |
| `lib/asr/config.js` | 新增 `resolveStreamConfig()`：模型名、端点、是否启用、采样率；缺 Key 视为不可用 |
| `lib/service.js` | `recordStart` 支持 `stream`；`recordStop` 走流式收尾；新增 `liveSnapshot()`；流式失败时停录走非流式兜底 |
| `lib/routes.js` | 新增 `GET /note-taker/live`；`POST /note-taker/record` 接受 `stream` 字段 |
| `lib/settings.js` | 新增 `streamEnabled` / `streamModel` 两项（白名单 + 热生效） |
| `src/client/QuickPanel.jsx` | 字幕区 + 状态提示 + 隐私二次确认（流式文案） |
| `src/client/api.js` | `startRecord({stream})`、`live(id)` |
| `package.json` | 重新引入 `ws` 依赖（CR-01 时移除） |

时间轴推导（因为服务端不给时间戳）：维护 `audioSecondsSent = bytes / 32000`；
收到 `speech_started` 记 `itemStart = audioSecondsSent`，收到 `speech_stopped` 记 `itemEnd = audioSecondsSent`，
`completed` 按 `item_id` 回填文本。误差 ≈ 一次事件往返（实测 0.15–0.3 秒），写进产物时保留 2 位小数即可。

## 接口设计

### GET /note-taker/live?id=&lt;meetingId&gt;

```json
{
  "ok": true,
  "data": {
    "meetingId": "20261111-1015-ab12",
    "state": "idle|connecting|streaming|finalizing|done|degraded",
    "elapsedSec": 42.3,
    "audioSecondsSent": 41.9,
    "chars": 218,
    "partial": "然后前段时间我跟",
    "finals": [{ "startSec": 0.0, "endSec": 9.2, "text": "这个里面变更的时候…" }],
    "error": null,
    "engine": { "stream": true, "model": "qwen3-asr-flash-realtime", "source": "file" }
  }
}
```

- `id` 校验沿用现有白名单正则；非当前录音的 id 返回 `state: "idle"`。
- 无副作用、只读内存，允许 500ms 一刷。

### POST /note-taker/record

入参新增 `stream?: boolean`（缺省取配置）。其余字段与语义不变。

## 数据模型变更

无库表。会议记录新增可选字段 `stream: true`（落盘在 `meetings/index.json` 的会议条目上），
产物文件结构不变（R-05）。

旁路文件 `recordings/<id>.pcm`：录音结束后**删除**（WAV 已覆盖回退需求），失败路径保留以便排查。
测试断言「结束后不留 `.pcm`」。

## 共享面身份矩阵（必填，有既有消费者）

| 对象 | 身份（方法×调用方×端点） | 变更后预期行为 | 断言归属 |
|---|---|---|---|
| `POST /note-taker/record` | 卡片 QuickPanel 开始/停止录音 | 不传 `stream` → 行为与改造前逐字一致 | T-05 |
| 同上 | 工具 `meeting_record_start/stop` | 同上 | T-05 |
| 同上 | `tests/routes.test.js`、`tests/service.test.js` | 现有断言不改也得全绿 | T-06 |
| `recordings/<id>.wav` | 非流式转写、降级重转写、导入 | 依旧生成、可解码、时长正确 | T-05 |
| 产物单文件 | `detail` 路由、交接、纪要 | 结构不变（元信息 + 转写 + 纪要） | T-06 |
| `GET /note-taker/live`（新增） | 仅新卡片轮询 | 无既有消费者；非录音时返回 idle | T-04 |
| 配置 `config.json` | 设置页、`health`、既有 env | 新增两项不改变既有四项的解析结果 | T-03 |
| `meeting_*` 工具 7 个 | 会话内 agent | 全部保持注册与契约（L-13） | T-06 |

## 关键日志点清单

| 场景 | 级别 | 触发点 | 必带字段 | runId |
|---|---|---|---|---|
| 流式会话建立 | INFO | `stream.connect` | model, sampleRate, sessionId | meetingId |
| 会话参数被服务端接受 | DEBUG | `stream.sessionUpdated` | model, format, turnDetection | meetingId |
| 每 30 秒推流心跳 | INFO | `stream.progress` | audioSecondsSent, finals, chars | meetingId |
| 首帧发送 | DEBUG | `stream.firstFrame` | bytes, delayMs | meetingId |
| 停录收尾完成 | INFO | `stream.finalize` | 耗时 ms, finals, chars, 是否超时 | meetingId |
| 降级 | WARN | `stream.degrade` | 原因（connect_failed/reconnect_exceeded/timeout）, 已完成 finals | meetingId |
| 鉴权失败 | ERROR | `stream.connect` | httpStatus, 原因（**不含 Key**） | meetingId |
| 旁路文件清理 | DEBUG | `record.cleanup` | path, 是否存在 | meetingId |

正文不逐字入日志（只记字数）——与会话内容无关的运维事实足够。

## 关键决策

### 决策 1：用 `qwen3-asr-flash-realtime`，不用 `qwen-audio-*-realtime-*`

- 采用：专用 ASR 实时模型，只输出转写。
- 被拒绝：`qwen-audio-3.1-realtime-flash` / `qwen-audio-3.0-realtime-flash` —— 实测是 omni 对话模型，
  会给音频「回话」（`response.text.done` 返回完整回答），既污染结果又额外计费。重新评估条件：若将来需要
  「边说边答」的助手形态，这两个才是对的选项。

### 决策 2：录音 sidecar 双写 WAV + PCM 旁路文件，宿主 tail 文件

- 采用：`py/record.py` 同循环写两份，宿主按偏移读 `.pcm` 增量推流。
- 被拒绝：① 改 stdout 为二进制帧 —— 会破坏现有「stdout 只打一行 JSON」的契约，`smoke-*` 与 e2e 都依赖它；
  ② 额外 fd/命名管道 —— Windows 下 spawn 与 Node 侧都要额外处理，收益不足以抵消复杂度。
- 好处：即使流式全挂，WAV 还在，降级重转写零成本。

### 决策 3：字幕用 500ms 轮询，不做 SSE/WebSocket 推送

- 采用：`GET /note-taker/live` 只读内存快照，卡片 500ms 轮询（页面隐藏时暂停）。
- 被拒绝：SSE / WS upgrade —— 宿主 `webServer.register` 是请求-响应式，**流式响应未验证**；
  先例代价太大（T-01 探针已多次证明「源码里有 ≠ 插件里能用」）。3 秒需求用 500ms 轮询有 6 倍余量。
- 重新评估条件：若将来要做逐字打字机效果或 0.5s 以内延迟，再验一次宿主流式响应能力。

### 决策 4：时间戳由本地时钟推导

- 采用：以「已发送音频秒数」为轴，在 `speech_started`/`speech_stopped` 打点。
- 被拒绝：等服务的 `usage.duration` 反推 —— 它只有时长没有起点，累加会漂移。
- 精度：±0.3 秒；对「按时间戳对齐纪要」够用，产物里不标精度声明（避免噪音）。

### 决策 5：重新引入 `ws` 依赖

- 采用：`ws` 包（支持自定义 `Authorization` 头）。
- 被拒绝：Node 24 内建 `WebSocket` —— 无法带自定义头，鉴权过不去（CR-01 已实测）。

### 决策 6：流式默认关闭，降级即回非流式

- 采用：`streamEnabled` 默认 false；流式失败 → 停录后用 WAV 走现有非流式识别，产物完整、只多一次调用。
- 被拒绝：流式失败后尝试「继续流式重传」——已发送音频无法回补，重传会让时间轴错位。

## 风险与规避

- [VAD 把长句切成碎片] → 前端按 `item_id` 合并显示；产物层按段落粒度落盘，不做逐字对齐；
  必要时把 `silence_duration_ms` 调到 1200 并写进配置。
- [时间戳 ±0.3s 误差] → 在产物元信息里不声明精度；纪要要求「按发言人/议题组织」而非逐秒引用。
- [1 小时会议 WS 断线] → 重连 2 次（1s/2s 退避），仍失败则降级；WAV 兜底保证不丢内容。
- [网络抖动导致重复文本] → 以 `item_id` 去重，最终以 `completed.transcript` 覆盖该 item 的所有中间结果（R-03）。
- [`ws` 依赖引入回归风险] → 单测用假 WS 契约测试（沿用 CR-01 的 `tests/support/fake-ws.js` 思路重建），
  真实连通只在探针与手工验证里跑。
- [旁路 PCM 文件残留] → 收尾与异常路径都删；单测断言目录里不留 `.pcm`。

## 依赖与前置

- 百炼 Key（复用 `cloud.apiKey`），端点默认由 cloud endpoint 的 host 推导为 `wss://<host>/api-ws/v1/realtime`。
- `ws` npm 包（重新引入）。
- 录音 sidecar 可用（`pylibs/sounddevice.py` 已就绪）。
- 现有产物链路（`lib/output.js`）与交接构造（`src/client/handoff.js`）保持不变。