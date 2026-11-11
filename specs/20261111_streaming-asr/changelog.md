# Changelog: streaming-asr

## v0.1.0（2026-11-11）

- 挂载: v1.0.0（用户确认，2026-11-11）
- 来源: BL-06「流式上传音频 + 流式 ASR」（陈卓 2026-11-10 提出），BL-05 已并入作为技术前提
- 新事实: 2026-11-11 模型清单实测到 realtime 系列（CR-01 时期「无流式后端」的结论已不适用）
- 初始化: requirements 草稿（R-01~R-10），四个「立项前必答」列入待确认问题
- **确认①**（2026-11-11）确认人: 陈卓 —— 用户「按你的建议，确认」：四个必答按建议执行；
  requirements.md 转 v1.0.0 已确认
- **Phase 2 探针**（2026-11-11，真实录音 20 秒推流）：
  - 端点 `/api-ws/v1/realtime?model=` 可用，OpenAI-Realtime 风格事件；`input_audio_format` 必须是 `pcm`
  - `qwen3-asr-flash-realtime` 首字 ≈0.3s、每句定稿 ≈0.15s；中间结果 = `text + stash`；完成事件无时间戳
  - `qwen-audio-3.1/3.0-realtime-flash` 实测是 omni 对话模型，会对音频「回话」→ 不选
- **Phase 2 方案**：坑核对 8 条相交；6 个决策；7 个共享面身份；8 条日志点；时间戳本地推导
- **确认②**（2026-11-11）确认人: 陈卓 —— plan.md 转 v1.0.0 已确认，进入 Phase 3
- **Phase 3 任务**：9 条（T-01 配置 / T-02 sidecar 旁路 PCM / T-03 流式客户端 / T-04 live 路由 /
  T-05 service 接线 / T-06 路由与共享面回归 / T-07 字幕区 / T-08 隐私与 api / T-09 端到端）
- **确认③**（2026-11-11）确认人: 陈卓 —— tasks.md 转 v1.0.0 已确认，进入 Phase 4 施工
- **Phase 4 实现**（2026-11-11，分支 `feature/streaming-asr`）：
  - T-01 `2f7836a`：`STREAM_ENV/STREAM_DEFAULTS/resolveStreamConfig`（默认关闭；缺 Key → `available:false`；
    模型/端点非法 → `E_STATE`）+ 13 例
  - T-02 `26809e1`：`py/record.py --pcm-out` 双写（WAV 永不受影响，PCM 坏了只记一次日志并停写）+ smoke 两种模式
  - T-03 `d6dbbc5`：`lib/asr/stream.js`（预连排队、item 去重、按字节推时间戳、静默窗收尾、重连 2 次后降级）+ 13 例
  - T-04 `eeca836`：`lib/live.js` 内存快照 + `GET /note-taker/live`（非法 id → 400）+ 8 例
  - T-05 `4a27009`：service 接线（`--pcm-out`、tail 推流、`live` 挂载、停录 finalize→落盘→删旁路；
    降级排一次非流式兜底；白名单加 `stream`；capabilities 加 `stream` 段）+ 7 例
  - T-06 `0c8aa0d`：record 路由透传 `stream/sessionId`；共享面回归（7 工具契约、非流式全链路）+ 3 例
  - T-07/T-08 `083acc2`：卡片字幕区（定稿强/中间弱、等待语音、降级冻结、颜色只用 theme 令牌）、
    流式首次确认（文案含「录音期间持续上传音频到阿里云百炼」）、500ms 轮询（页面隐藏暂停）、
    停录按 used/degraded 分流；设置页补「流式识别」两项并映射到 `NOTE_TAKER_STREAM_*`（显式 false → `'0'`）+ 19 例
  - T-09 补充：`ws` 运行时依赖 + `resolveWebSocketImpl()`（内置 WebSocket 带不了 Authorization 头）；
    `tests/stream-ws.test.js` 用本地 ws 服务端复刻真实时序（鉴权头/`pcm`/append 10 帧/commit→completed）
  - 过程中修掉两个真 bug：① `finalize()` 在 `committed` 就收尾会丢最后一句（改为静默窗，且起点取
    `max(最后事件, commit 发出)`）；② 建连阶段断线时 `connect()` 的 Promise 永不 settle（重连循环之外没人叫醒）
- **验证证据**（2026-11-11，danger-full-access）：
  - `npm run verify` → 构建校验通过（lib/client.js 可重复构建 `9f3c81211fed`）+ `tests 331 / pass 331 / fail 0`
  - 宿主实跑（`dsh web --port 8099 --no-open`，web profile）：`路由注册完成 routes=10`；
    `GET /note-taker/health` 200 且带 `stream:{enabled:false,available:false,reason:"missing_key",model:"qwen3-asr-flash-realtime"}`；
    `GET /note-taker/live?id=…` 200 idle 快照；`GET /note-taker/config` 200 且含 `asr.stream`；
    `live?id=../etc/passwd` → 400 `E_STATE`；`POST /record {stream:true}` → 400 `E_DEP`（缺 Key 前置拒绝，`/list` 仍为空）
  - **T-09 真机补验**（2026-11-11 10:32–10:35，用户提供云端 Key，`dsh web --port 8099` + web profile，真实麦克风）：
    - 云端链路独立验证（20 秒真实语音 PCM 按实时节奏推流，`.tmp/cloud-stream-verify.mjs`）：
      建连 **0.24s**；首个中间结果 **+0.91s**（R-01/R-02 达标）；按语义定稿 3 段；停录收尾 **0.90s**
      未超时（R-04 达标）；全文 115 字中文正确，时间戳 0.4–30.8s（本地推导）
    - 第一轮（用户尚未说话，采到静音）：字幕 0 字 → 停录后**自动降级**到整段识别（R-07）→
      云端回 `ASR_RESPONSE_HAVE_NO_WORDS` → `transcribe=failed`；音频 `recordings/<id>.wav` 完好保留，
      全程无崩溃。日志出现「流式服务返回错误」→「收尾完成 finals=0」→「降级为停录后整段识别」
    - 第二轮（用户对着麦克风说了约 25 秒）：首次出字 **+7.75s**（含用户起说延迟，字幕延迟本身见上面云端直推的 0.91s）；
      停录路由耗时 **0.99s**，`stream.used=true / segments=4 / chars=56 / timedOut=false / fallback=null`；
      状态 `record=done, transcribe=done, engine=cloud, stream=true`；产物
      `transcripts/<id>.md`（`[00:00:06]` 起共 4 段）+ `<id>.json`（`mode=stream`）；旁路 PCM 收尾后已删
    - 日志顺序齐全：`流式会话已建立` → `首帧已发送` → `推流进度` → `收尾完成`，成功轮无 ERROR；
      全程日志不含 Key（R-10）
    - 说明：本机扬声器播放被试麦克风拾取时 RMS≈0（AEC/远场），所以「自己放音给自己听」这条自动化路线不可行，
      必须真人说话才能验；这一点不影响插件行为
- **T-09 收官**：9/9 任务完成；`npm run verify` 构建可重复 + 331/331 全绿
- **收尾修复**（2026-11-11）：配置开着但缺 Key 时不再把录音堵死——只有调用方显式 `stream:true` 才硬失败，
  按配置默认且不可用时安静回落普通录音（+1 例，测试 331 → 332）
- **用户自测**（2026-11-11 10:39–10:43）：用户在 `dsh web --port 8099` 实例上自测通过，确认界面与行为符合预期
- **合并**（2026-11-11，用户口令「测试过了，合并」）：`feature/streaming-asr`（`70907ba`）以 `--no-ff` 合入
  `1.0.0` → 合并提交 `75d8afc`；合并后 `npm run verify` 复跑：结构 41 项、构建可重复（`9f3c81211fed`）、
  `tests 332 / pass 332 / fail 0`。**未 push、未打 tag、未冻结版本**