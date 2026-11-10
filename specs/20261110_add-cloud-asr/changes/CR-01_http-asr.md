> 编号: CR-01 | 档位: minor（用户 2026-11-10 拍板） | 状态: 已合入 → 父 v1.1.0 | 提出: 2026-11-10 | 提出人: 陈卓
> 父 spec: specs/20261110_add-cloud-asr v1.0.0 → 目标 v1.1.0 | 挂载版本: v1.0.0
> §S: 已确认 | §P: 已确认 | §T: 已确认 | 八动作: 8/8 | 合入: 2026-11-10

# 变更请求 CR-01：云端 ASR 由 WebSocket 流式改为非实时 HTTP

## §S Specify（变更意图）

**触发**：陈卓 2026-11-10 真机验证时发现原选定协议跑不通，随后给出非实时 HTTP API 文档，
实测该接口可用。原话：「可能我给你给错了」。

**事实依据（都是实测，不是推测）**：

| 实验 | 结果 |
|---|---|
| `wss://token-plan.../api-ws/v1/inference` 只发 `run-task` | ✅ `task-started` |
| 再发任意一帧（二进制 PCM / 文本 URL / JSON 带 url） | ❌ `InvalidParameter: url error, please check url！` |
| 用 `qwen-audio-3.0-asr-flash-streaming` / `-3.1-` | ❌ `Model not exist.` |
| `GET /compatible-mode/v1/models` | ✅ 21 个模型，含 `qwen-audio-3.0-asr-flash`（**无** `-streaming` 变体） |
| `POST /api/v1/services/aigc/multimodal-generation/generation`（base64 data URI） | ✅ **200，1 秒返回，逐字时间戳齐全** |

**修改 R**

- R-02 旧：「按百炼实时语音识别的客户端协议完成一次任务：WebSocket → `run-task` → 分帧推音频 →
  `finish-task` → 收 `result-generated` 直到 `task-finished`」
  → 新：「WHEN 选择云端引擎并给出音频文件，系统 SHALL 调用百炼非实时语音识别 HTTP 接口：
  把整段音频以 Base64 Data URI（或可配置的公开 URL）放进 `input.messages[].content[].input_audio.data`，
  一次请求取回识别结果，并把 `sentence`/`sentences` 聚合成同构的 `transcripts/<id>.md|json`」

**新增 R**

- **R-11 长音频分片**：WHEN 音频时长超过接口上限（实现按官方「音频规格」取安全值，默认 5 分钟），
  系统 SHALL 切片后逐片识别，并按片起始偏移累加时间戳后合并为单一结果，使线上行为与「一次上传」一致。
  （理由：47 分钟会议必须能跑；不改这条就只能在长会上报错）
- **R-12 说话人分离可选**：WHEN 配置开启且模型支持（`qwen-audio-3.1-asr-flash` 的
  `speaker_diarization_enabled`），系统 SHALL 透传该参数并把 `speaker_id` 落进 segments；
  模型不支持时 SHALL 不发送该参数。（本版不默认开启，只保证参数可透传）

**受影响既有 R 核查（必答）**

- R-01 引擎切换：不变（`local`/`cloud` 仍是二选一）
- R-03 配置来源：**扩展**——新增 `endpoint`（HTTP 路径）与 `model` 默认值变更，配置项语义不变
- R-04 术语：由「流式 `vocabulary`/`language_hints`」改为「HTTP 的上下文消息 `input_text`」，
  **语义保留、载体变化**
- R-05 失败超时：流式空闲超时不再适用，改为「HTTP 请求超时 + 非 200 响应映射」
- R-06/07/08/09：不变
- R-10 可测：假客户端从「假 WebSocket」改为「假 fetch」，覆盖面不变

**Non-goals（本次不跟着做）**

- 不实现实时边说边出（仍属另一个 spec）
- 不实现预编译热词列表（`vocabulary_id`），本版只用上下文消息传术语
- 不做本地/云端双跑择优

**为何不另立新 spec**：目标（给会记加云端 ASR）未变，变的只是同一能力下的传输方式；
另立会把「一个能力」拆成两套数据模型与两套配置，反而增加维护面。

**我正在做的假设**

1. 该 HTTP 接口就是此工作空间唯一可用的 ASR 入口（已实测）。
2. Base64 方式不需要公网 URL，因此音频仍只在「本地 → 阿里云」一跳，不经过第三方存储。
3. 单次请求的音频上限按官方「音频规格」执行，实现里取保守值并做分片。

**范围自检**：本 CR 是否让本 spec 的可交付目标发生变化？**否**——交付物仍是「可选的云端 ASR 引擎」。

## §P Plan（影响面 + 已实现处置）

**影响面**：
- `lib/asr/cloud.js`（WS 流式客户端）→ 停产
- `tests/cloud-asr.test.js` + `tests/support/fake-ws.js`（假 WebSocket）→ 停产
- `lib/asr/pcm.js`（解码分帧）→ 改为「解码为了 Base64，不再分帧」
- `package.json` 的 `ws` 依赖 → 移除
- `lib/asr/config.js` → endpoint 语义改为 HTTP、模型默认值确认
- 新增 `lib/asr/http.js`（HTTP 客户端）+ `lib/asr/chunk.js`（长音频切片）

**已实现处置表**

| 已完成任务 | 与 CR 的关系 | 处置 | 后果 |
|---|---|---|---|
| T-01 配置解析 | R-03 扩展 | 保留 + 微调（endpoint 改成 HTTP 地址、模型默认值沿用实测可用的名字） | 配置来源抽象不变，页面配置仍可替换 |
| T-02 事件聚合 | 结果结构变化（`sentence` 单个 vs 流式事件流） | 改造 | 复用「毫秒转秒、句级终态、排序」逻辑，输入从事件数组变成响应体 |
| T-03 解码与分帧 | 分帧不再需要（改 Base64） | 改造 | `decode_pcm.py` 保留（分片时需要重编码）；`framePcm` 退役 |
| T-04 WS 客户端 | 协议不再使用 | **回退（停产）** | 文件保留在历史里，不参与构建；若将来工作空间开通流式模型可复活 |
| T-05 假 WebSocket 测试 | 同上 | **回退（停产）** | 由假 fetch 测试替代 |
| T-06/T-07/T-08 | 未开始 | 保留原计划 | 仅替换底层客户端 |

**关键决策**

- 决策 1：采用非实时 HTTP + Base64。理由：唯一实测可用的路径；且 1 秒返回，比 1x 实时推流快两个数量级。
- 决策 2：长音频**分片串行识别**（默认 5 分钟一片），按偏移合并。理由：单请求有上限，47 分钟会议必须能跑。
- 被拒方案 A：**另立新 spec** | 拒绝理由：目标未变，只是传输方式变更，另立会分裂数据模型。
- 被拒方案 B：继续调 WebSocket（换 host/参数） | 拒绝理由：已用 6 组对照实验确认该工作空间无流式后端。
- 被拒方案 C：要求音频公网 URL（不做 base64） | 拒绝理由：会把用户录音推到第三方存储，违反 R-06 隐私边界。

**风险与规避**：
- 分片边界切断句子 → 按静音对齐切点（用 VAD 或固定重叠窗口）并在合并时去重
- Base64 体积膨胀 33% → 分片上限据此下调
- 接口限流 → 分片串行 + 失败重试一次

**是否需拆版/换挂版**：不需要，仍在 v1.0.0。

## §T Tasks（增 / 改 / 废）

- [ ] T-10 实现 HTTP ASR 客户端（fetch + base64 + 错误映射）
  关联: R-02, R-05
  依赖: T-01
  CR: CR-01
  处置: 新增
  验证方式: `node --test tests/asr-http.test.js`——假 fetch 断言请求体结构（model/messages/input_audio/parameters）、
  200 正常解析、非 200 错误映射、超时中止、响应缺 sentence 时判错
  日志断言: 出现「云端识别请求」（含 model、音频秒数、base64 字节数，不含 key）与「云端识别完成」（耗时、句数）
  验收标准: 五类用例全绿；请求体与官方示例逐字段对齐

- [ ] T-11 实现长音频分片与合并
  关联: R-11
  依赖: T-10
  CR: CR-01
  处置: 新增
  验证方式: `node --test tests/asr-chunk.test.js`——给定 12 分钟音频与 5 分钟上限产出 3 片、
  片间无丢帧无重叠（按字节比对）、合并后时间戳按偏移累加且单调递增
  验收标准: 分片边界用例全绿；合并结果与一次性识别的段序一致（用假 fetch 返回固定结果验证）

- [ ] T-12 改造聚合器以适配 HTTP 响应
  关联: R-02, R-07
  依赖: T-02
  CR: CR-01
  处置: 改造
  验证方式: `node --test tests/asr-aggregate.test.js` 增补——HTTP 响应体 `{sentence}` 与
  `{sentences:[]}`（开说话人分离时）都能聚合成 segments；`words` 透传到 json
  验收标准: 两种响应形态各有用例；既有流式事件用例保留（函数仍支持）

- [ ] T-13 移除 ws 依赖并退役流式客户端
  关联: R-02
  依赖: T-10
  CR: CR-01
  处置: 回退
  验证方式: `npm ls ws` 不再出现；`npm run verify` 全绿；`git log` 里 T-04/T-05 的 commit 保留
  验收标准: 依赖树干净；测试仍全绿

- [ ] T-14 用真实音频验证云端识别
  关联: R-02, R-07
  依赖: T-10, T-11
  CR: CR-01
  处置: 新增（替代原 T-09）
  验证方式: 用真实 m4a 的 2 分钟与全片各跑一次，记录耗时、段数、字数、与本地 small 的原文对照
  验收标准: 真实返回成功且被下游解析；质量差异有原文对照

**自检**：新/改 R 全覆盖 ✓；无超范围 T ✓；已合并 commit 均在处置表 ✓

## §I Implement（执行 + 证据）

| 任务 | commit | 验证输出 |
|---|---|---|
| T-10 | e99379b | 真机 1.3s 返回、2 句、请求体逐字段对齐 |
| T-11 | 1673f79 | 7 用例；分片字节总数等于原音频 |
| T-12 | a8229fa / f49c15a | 12 用例；2 分钟从 1 段切到 19 段 |
| T-13 | be8cedc | `npm ls ws` 空、verify 全绿 |
| T-14 | 待全片跑完回填 | 2 分钟：19 段 / rtf 0.098 / 12s |

## 合入登记（八动作）

- [x] 1 R 条款落 requirements.md（含新增 R-11/R-12）
- [x] 2 三文档版本头 bump 至 v1.1.0
- [x] 3 changelog 记到编号级
- [x] 4 新 T 并入 tasks.md，T-04/T-05 标「[作废 CR-01 v1.1.0]」
- [x] 5 本文件盖合入戳
- [x] 6 MILESTONE 计数同步（无 SQL/配置件）
- [x] 7 关联账联动（流式复活记 BL-05）
- [x] 8 `docs(spec): CR-01 合入 v1.1.0`
