# 完成报告: streaming-asr（流式上传音频 + 流式 ASR）

> 状态: 已实现并验证，待合并进 v1.0.0
> 分支: `feature/streaming-asr`
> 版本: 挂载 v1.0.0（spec 文档 v1.0.0，三重确认已完成）

## 一句话

默认关闭的「录音期间实时出字」：开启后边录边把 16k 单声道 PCM 推给阿里云百炼实时 ASR，
卡片上边录边出字幕，停录约 1 秒内拿到完整转写；连不上或中途断线自动降级回原来的整段识别，音频不丢。

## 交付内容

| 层 | 文件 | 说明 |
|---|---|---|
| 配置 | `lib/asr/config.js` | `STREAM_ENV/STREAM_DEFAULTS/resolveStreamConfig`：默认关闭、缺 Key 不可用、模型/端点非法报 `E_STATE` |
| 录音 | `py/record.py` `scripts/smoke-record.mjs` | `--pcm-out` 双写（WAV 永不受影响；PCM 写坏只记一次日志并停写） |
| 客户端 | `lib/asr/stream.js` | WS 会话：预连排队、item 去重、按已推字节推时间戳、静默窗收尾、重连 2 次后降级 |
| 快照 | `lib/live.js` | 内存快照（idle/connecting/streaming/finalizing/done/degraded），无副作用 |
| 编排 | `lib/service.js` | `recordStart({stream})` 前置校验、tail 旁路推流、`recordStop` finalize→落盘→删 PCM、降级排兜底识别、`live()` |
| 接口 | `lib/routes.js` | 新增 `GET /note-taker/live`（第 10 条路由）；`/record` 透传 `stream/sessionId/workspaceDir` |
| 页面 | `src/client/QuickPanel.jsx logic.js api.js SettingsPage.jsx` | 字幕区（定稿强/中间弱）、等待语音、降级提示、500ms 轮询（隐藏暂停）、首次确认、设置页两项 |
| 配置存储 | `lib/settings.js` | `asr.stream.{enabled,model}` 稀疏落盘 + 映射到 `NOTE_TAKER_STREAM_*`（显式 false → `'0'`） |
| 依赖 | `package.json` | 新增运行时 `ws ^8.22.2`（内置 WebSocket 带不了 Authorization 头，见 L-21） |

## 需求覆盖（R-01~R-10）

| 需求 | 证据 |
|---|---|
| R-01 会话建立 ≤2s | 真机 + 云端直推双测：0.24s |
| R-02 字幕 ≤3s | 首个中间结果 +0.91s；页面 500ms 一轮拉快照 |
| R-03 中间结果不倒退 | `finalizedIds` 守卫：定稿后同 item 的中间结果直接丢弃（单测锁定） |
| R-04 停录 ≤10s 收尾 | 真机 0.99s / 云端直推 0.90s，均未超时 |
| R-05 产物同构 | `transcripts/<id>.md` + `<id>.json(mode=stream)`；工作区模式复用 `writeProductFile`（单测覆盖） |
| R-06 既有流程衔接 | 卡片 `used=true` 直接进确认区，不再跑一遍整段识别；工具/旧路径零改动 |
| R-07 失败降级 | 真机静音轮实证：降级→整段识别→失败报错，音频保留；重连 2 次后 `degraded` |
| R-08 隐私二次确认 | 文案含「录音期间持续上传音频到阿里云百炼」，本次会话只弹一次；非流式不弹 |
| R-09 配置热生效 + 默认关 | 真机在设置页保存后 `health.stream.enabled=true` 立即生效；缺省 `false` |
| R-10 日志不含 Key | 真机全程日志核对，仅出现脱敏路径与模型名 |

## 验证证据

```
$ npm run verify
构建校验: lib/client.js 可重复构建（9f3c81211fed）
tests 331 / pass 331 / fail 0
```

宿主实跑（`dsh web --port 8099 --no-open`，web profile）：

```
note-taker - 路由注册完成, routes=10, basePath=/note-taker
GET  /note-taker/health                  → 200，含 stream:{enabled,available,reason,model,host,source}
GET  /note-taker/live?id=<id>            → 200 idle 快照（幂等）
GET  /note-taker/config                  → 200，含 asr.stream + sources.streamEnabled
GET  /note-taker/live?id=../etc/passwd   → 400 E_STATE
POST /note-taker/record {stream:true}    → 400 E_DEP（无 Key；/list 仍为空，不留半场会议）
```

真机流式（真实麦克风 + 真实云端，第二轮回放用户语音约 25 秒）：

```
录音开始 mode=mic+stream → 流式会话已建立 → 首帧已发送 → 推流进度 → 收尾完成
首次出字 +7.75s（含起说延迟）；停录 0.99s
stream: used=true, segments=4, chars=56, timedOut=false, fallback=null
状态: record=done, transcribe=done, engine=cloud, stream=true
产物: transcripts/20261111-1033-7f11.md（4 段）+ .json（mode=stream）
旁路 PCM 已清理
```

云端链路独立量化（20 秒真实语音按实时节奏推流，不经麦克风）：

```
建连 0.24s；首个中间结果 +0.91s；定稿 3 段；收尾 0.90s 未超时
全文 115 字中文正确；时间戳 0.4–30.8s（本地推导，误差活约 ±0.3s）
```

## 已知取舍

- 时间戳由「已推字节数」推导（服务端事件不带时间戳），±0.3s 量级，不能当秒级对时。
- 停录后若字幕为 0 段会走一次整段识别兜底，此时会比纯流式多一次模型调用。
- `transcribe` 语义未变：流式会话已写好的转写，再次手动触发转写会重新识别（属于既有行为，未在本次改动）。
- 本机「扬声器放音被麦克风拾取」测不到（RMS≈0，AEC/远场），自动化只能靠真实人声，故真机验证为人工参与一次。

## 未做 / 待办

- 合并进 `v1.0.0`（`git merge --no-ff feature/streaming-asr`）与 push 需用户口令；目前 9/9 任务已勾、验证已完成。
- 里程碑台账里的 spec 状态在合并后改「已合并」。

## 教训沉淀

新增 L-18（`input_audio_format` 只认 `pcm`）、L-19（收尾顺序 `speech_stopped → committed → completed`，
静默窗起点要含 commit 时刻）、L-20（`qwen-audio-*-realtime-flash` 是对话模型会回话）、
L-21（内置 WebSocket 带不了 Authorization 头，必须 `ws`）。