> 版本: v1.0.0 | 状态: 已确认 | 更新: 2026-11-10 | 确认人: 陈卓 | 确认日期: 2026-11-10

# 任务清单：add-cloud-asr

## 1. 配置与纯函数

- [x] T-01 实现云端配置解析
  关联: R-03, R-04
  依赖: 无
  验证方式: `node --test tests/asr-config.test.js`——缺 `DASHSCOPE_API_KEY` 时返回 `E_DEP` 且 `detail.env` 指出变量名；全量环境变量覆盖后模型/地址/倍速/术语解析正确；术语超过 200 条时截断并返回 warning；配置来源通过注入 `source.get(key)` 对象取值（证明可替换为页面配置）
  日志断言: 缺密钥场景日志出现「密钥缺失」含变量名且不含密钥值；术语截断场景出现 WARN 含原始条数与截断后条数
  验收标准: 五类用例全绿；`config.js` 不直接读 `process.env` 之外的全局，来源可注入

- [ ] T-02 实现服务端事件聚合
  关联: R-02, R-07
  依赖: 无
  验证方式: `node --test tests/asr-aggregate.test.js`——覆盖：只取 `sentence_end=true`；`heartbeat=true` 丢弃；中间结果（同 `sentence_id` 多次推送）不重复；毫秒正确转秒（160ms→0.16）；乱序到达按 `begin_time` 排序；空事件流产出空数组；`sentence` 缺字段时不抛错而是跳过并计数
  验收标准: 七类用例全绿；聚合器为纯函数，不读时钟、不发网络

- [ ] T-03 实现 PCM 分帧
  关联: R-02
  依赖: 无
  验证方式: `node --test tests/asr-pcm.test.js`——用合成正弦波 wav 断言：输出采样率 16000、单声道、帧长 3200 字节（100ms）；末帧不足时补零且记录真实字节数；输入 48kHz 立体声时重采样与下混正确；损坏文件抛 `E_AUDIO`
  验收标准: 四类用例全绿；帧序列拼回时长与原音频误差 < 50ms

## 2. 客户端

- [ ] T-04 实现百炼 WebSocket 客户端
  关联: R-02, R-05, R-08
  依赖: T-01, T-03
  验证方式: 用 T-05 的假 WebSocket 驱动：断言发送顺序为 `run-task` → （收到 `task-started` 后）音频帧 → `finish-task`；`run-task` 的 `model`/`parameters.format`/`sample_rate` 与配置一致；未收到 `task-started` 就推流时客户端必须等待而不是抢跑；空闲超过阈值触发中止并返回 `E_LLM`；连接错误映射为 `E_LLM`、握手 401 映射为 `E_DEP`
  日志断言: 依次出现「连接建立」（host/耗时）、「task-started」（taskId/model）、「首条最终结果」、「task-finished」（句数/usage.duration/总耗时）；失败路径出现「连接/推流失败」含 code 与服务端 error_code，且**日志中检索不到密钥串**
  验收标准: 协议序列与五类错误路径用例全绿；无真实网络请求

- [ ] T-05 提供假 WebSocket 客户端并补协议单测
  关联: R-10
  依赖: T-02, T-04
  验证方式: `node --test tests/cloud-asr.test.js`——假客户端可编排服务端事件脚本（started→N 条 result→finished），断言客户端产出与 `aggregate` 结果一致；另覆盖：`task-failed`、无响应超时、连接中途关闭、服务端返回畸形 JSON 四种错误路径
  验收标准: 四类错误路径各有用例；整套用例在断网环境可跑（通过注入假实现，不 mock 网络库）

## 3. 接入

- [ ] T-06 在 service 里按引擎分派并落盘
  关联: R-01, R-09
  依赖: T-02, T-04
  验证方式: `node --test tests/service-cloud.test.js`——`engine=local` 时行为与既有完全一致（复用现有 service 用例回归）；`engine=cloud` 时写入 `transcripts/<id>.md|json`，json 键集合 = 本地键集合 + `engine`；云端失败时 `status.transcribe='failed'`、`errors.transcribe` 有原因，且既有成功产物 sha256 不变；非法 `engine` → `E_STATE` + `detail.field='engine'`
  日志断言: 每次分派出现「引擎分派」含 meetingId 与 engine；云端失败出现 ERROR 含 code
  验收标准: 六类用例全绿；既有 `tests/service.test.js` 无一改动仍全绿

- [ ] T-07 工具参数与云端外发告知
  关联: R-01, R-06, R-08
  依赖: T-06
  验证方式: `node --test tests/tools.test.js` 增补——`meeting_transcribe` 接受 `engine` 并透传；不传 `engine` 时调用参数与既有断言一致（回归）；返回信封含 `engine` 字段。`tests/service-cloud.test.js` 增补：首次云端调用返回值含外发提示文案（含「阿里云百炼」），第二次不再出现
  日志断言: 首次云端调用出现「云端外发告知」一条（含 endpoint 主机名，不含 key），且全程只出现一次
  验收标准: 新增用例全绿；不带 engine 的老调用路径零行为变化

## 4. 文档与真实验证

- [ ] T-08 更新 README 与配置说明
  关联: R-03, R-05
  依赖: T-01
  验证方式: 人工核对 README 新章节包含：`DASHSCOPE_API_KEY` 配置方式、两个候选模型名、两套域名与 Workspace ID 说明、**「云端按实时速率，47 分钟音频约 47 分钟」的耗时预期**、倍速参数、失败时不会自动回退本地
  验收标准: 上述六项齐全；不出现真实密钥样例

- [ ] T-09 真实云端调用验证
  关联: R-02, R-07
  依赖: T-06, T-07
  验证方式: 设置 `DASHSCOPE_API_KEY` 后，用真实 m4a 的前 2 分钟跑 `engine=cloud`，记录：实际模型名、段数、字数、耗时与 rtf、usage.duration，并把云端与本地（small）的同一段转写并排贴进 completion.md；确认 `parse.js` 能解析云端产物
  验收标准: 真实返回成功且产物可被下游解析；两侧质量差异有原文对照
  日志断言: 日志按序出现连接建立 → task-started → 首条最终结果 → task-finished，无 ERROR
  备注: **若你未提供 `DASHSCOPE_API_KEY`，本任务按「技术阻塞」延期并在 completion.md 记录**，其余任务不受影响

## 自检

| R | 覆盖任务 |
|---|---|
| R-01 | T-06, T-07 |
| R-02 | T-02, T-03, T-04, T-09 |
| R-03 | T-01, T-08 |
| R-04 | T-01 |
| R-05 | T-04, T-08 |
| R-06 | T-07 |
| R-07 | T-02, T-06, T-09 |
| R-08 | T-04, T-07 |
| R-09 | T-06 |
| R-10 | T-05 |

- 每条 R 至少被一个 T 覆盖；无 T 找不到对应 R
- 依赖只指向更小编号（T-04→T-01/T-03、T-05→T-02/T-04、T-06→T-02/T-04、T-07→T-06、T-08→T-01、T-09→T-06/T-07），无循环
- 任务数 9，在 3~20 区间；涉及外部调用/网络/落盘的任务（T-01/T-04/T-06/T-07/T-09）均有可执行日志断言
