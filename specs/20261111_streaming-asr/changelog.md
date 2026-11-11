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