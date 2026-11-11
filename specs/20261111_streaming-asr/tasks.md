> 版本: v0.1.0 | 状态: 草稿 | 更新: 2026-11-11

# 任务清单：streaming-asr

## 1. 基础（配置与采集）

- [ ] T-01 流式配置解析 `resolveStreamConfig`
  关联: R-09, R-07
  依赖: 无
  验证方式: 单测 ≥8 例——①未做任何配置时 `enabled=false` 且 `available=false`；②`streamEnabled=true` 但缺 Key → `available=false` 且带原因；③端点缺省由 cloud endpoint 的 host 推导为 `wss://<host>/api-ws/v1/realtime`；④显式端点优先于推导；⑤环境变量可覆盖；⑥页面配置优先于环境变量；⑦模型名空白/非法 → 校验失败并指名字段；⑧`source` 字段正确反映 file/env/default
  日志断言: 不适用（纯函数，无副作用）
  验收标准: 8 例全绿；未配置时 `enabled=false`，与改造前行为一致

- [ ] T-02 录音 sidecar 旁路 PCM（`py/record.py --pcm-out`）
  关联: R-01
  依赖: 无
  验证方式: 冒烟录音 3 秒——WAV 与 PCM 同时生成，PCM 字节数 = 32000 × 秒数（±1 块）；不传 `--pcm-out` 时**不产生** PCM 文件，WAV 与改造前一致；写 PCM 失败不中断 WAV
  日志断言: 跑一次带 `--pcm-out` 的录音，stderr 须出现「录音开始」与「录音结束」，结束 JSON 含 `pcmPath`；不传时 JSON 无该字段
  验收标准: 两个文件都在、长度匹配；旧调用方行为零变化

## 2. 流式客户端

- [ ] T-03 `lib/asr/stream.js` 流式客户端
  关联: R-01, R-02, R-03, R-04, R-07
  依赖: T-01, T-02
  验证方式: 假 WS 契约测试 ≥10 例——①连接后先发 `session.update`，`input_audio_format` 为 `pcm`、`sample_rate` 16000；②收到 `session.created` 后开始按帧推送 `input_audio_buffer.append`（base64，3200 字节/帧）；③`text`+`stash` 拼接为 partial；④`completed` 用 `transcript` 回填并标记 final（不再被后续 partial 覆盖）；⑤同 `item_id` 重复事件去重；⑥`speech_started`/`speech_stopped` 打点为 startSec/endSec；⑦停录发 `input_audio_buffer.commit` 并等最后一帧（≤10s）；⑧服务端 `error` 事件转成可读错误；⑨连接失败/中途断开重连 2 次仍失败 → 状态 `degraded` 且带原因；⑩日志不含 Key
  日志断言: 契约测试中捕获日志——须出现「流式会话建立, model=…, sampleRate=16000」与（降级用例）「降级, 原因=reconnect_exceeded」；全文不得出现 Key 字符串
  验收标准: ≥10 例全绿；假 WS 覆盖重连与超时两条异常路径；真实调用只在 T-09 手工验证

- [ ] T-04 liveState 与 `GET /note-taker/live`
  关联: R-02, R-03, R-04
  依赖: T-03
  验证方式: 单测 ≥6 例——①无录音时返回 `state=idle`；②流式中返回 partial/finals/elapsedSec/chars；③非法 id（含 `../`）被拒；④查询非当前录音返回 idle；⑤状态机顺序 connecting→streaming→finalizing→done；⑥chars 与 finals 文本一致
  日志断言: 不适用（只读内存快照，无副作用）
  验收标准: 6 例全绿；接口响应 <10ms；连续 500ms 轮询 100 次无副作用

## 3. 宿主接线

- [ ] T-05 service 支持流式录音与降级
  关联: R-01, R-04, R-05, R-06, R-07
  依赖: T-03
  验证方式: service 单测 ≥6 例——①`stream=false` 行为与改造前逐字一致（回归）；②`stream=true` 走流式并记录 `stream:true`；③停录后产物结构与非流式同构（字段名/层级/秒级时间戳）；④流式降级后停录仍用 WAV 走非流式并产出完整产物；⑤结束后 `.pcm` 被删除（异常路径也删）；⑥并发第二场录音仍被拒
  日志断言: 跑一次流式停录——日志须出现「收尾完成, 耗时=…ms, finals=…, chars=…」；降级用例须出现「降级, 原因=…」；两处均不得含 Key
  验收标准: 6 例全绿；既有 267 个测试无一失败

- [ ] T-06 路由透传 `stream` 与共享面回归
  关联: R-01, R-06, R-09
  依赖: T-05
  验证方式: ①`POST /note-taker/record` 带 `stream:true` 进入流式、不带时行为不变；②按 plan 的共享面身份矩阵逐条断言 8 个身份：卡片 start/stop、工具 `meeting_record_start/stop`、`tests/routes.test.js`、`tests/service.test.js`、`recordings/<id>.wav`、产物单文件（detail/交接/纪要读取）、`GET /live` 的 idle 响应、`config.json` 既有四项解析
  日志断言: 带 `stream:true` 的一次 start，日志出现「流式会话建立」；不带时**不出现**该行
  验收标准: 8 条身份断言全绿（改好了 + 没改坏都有证据）；路由总数与既有清单一致（新增 live 后 +1）

## 4. 前端

- [ ] T-07 卡片字幕区
  关联: R-02, R-03
  依赖: T-06
  验证方式: 渲染用例 ≥5 例——①`streaming` 且有 partial 时显示 partial 且样式弱化（final 强、partial 弱）；②静默 5 秒显示「等待语音」；③`degraded` 显示降级提示且不再更新字幕；④`idle` 不渲染字幕区；⑤字数与已录时长与快照一致。另断言**颜色只来自 theme 令牌**（不得出现裸 `--dsh-*` 或近黑硬编码）
  日志断言: 不适用（纯渲染）
  验收标准: 5 例全绿；既有渲染用例不破

- [ ] T-08 隐私二次确认与 api 封装
  关联: R-08
  依赖: T-07
  验证方式: ①流式首次开始录音弹确认框，文案含「录音期间持续上传音频到阿里云百炼」；②本次会话确认后不再弹；③本地引擎不弹；④`api.live()` 请求带 id、超时阈值与轮询间隔正确，页面隐藏时暂停轮询（用假时钟断言）
  日志断言: 不适用（前端逻辑）
  验收标准: 4 例全绿；非流式路径不出现新弹窗

## 5. 验证收尾

- [ ] T-09 端到端与验收
  关联: R-01, R-02, R-03, R-04, R-05, R-06, R-07, R-08, R-09, R-10
  依赖: T-01~T-08
  验证方式: ①`npm run verify` 全绿并贴输出；②真实宿主（`dsh web --port 8099` + web profile）：录音 20 秒 → 字幕 3 秒内出现 → 停录 ≤10 秒出结果 → 产物可被 `detail` 读到且结构与非流式同构；③README 补「流式识别」一节（开启方式、模型、延迟与计费说明、降级行为）
  日志断言: 真机跑一次流式录音，日志按序出现「流式会话建立」→「首帧发送」→ 至少一条「推流进度」→「收尾完成」；全程无 ERROR
  验收标准: verify 全绿 + 真机字幕可见 + 产物同构 + README 更新

## 自检

- **R 覆盖**：R-01（T-02/T-03/T-05/T-06）、R-02（T-03/T-04/T-07）、R-03（T-03/T-04/T-07）、
  R-04（T-03/T-04/T-05）、R-05（T-05/T-09）、R-06（T-05/T-06/T-09）、R-07（T-01/T-03/T-05）、
  R-08（T-08）、R-09（T-01/T-06）、R-10（T-03/T-05/T-09）——10 条全覆盖
- **超范围检查**：无任务超出 R 范围（无「顺手改非流式」类任务）
- **依赖**：只指向更小编号（T-03→T-01/T-02、T-05→T-03、T-06→T-05、T-07→T-06、T-08→T-07、
  T-09→T-01~T-08），无环
- **粒度**：9 条，在 3~20 区间；每条约 1 次会话可完成
- **日志断言**：涉及外部调用/异步/副作用的 T-02/T-03/T-05/T-06/T-09 均写明「跑什么 + 必须出现哪几行」；
  T-01/T-04/T-07/T-08 为纯函数或纯渲染，标注「不适用」
- **共享面**：T-06 依据 plan 的身份矩阵逐条断言 8 个身份，不遗漏既有消费者