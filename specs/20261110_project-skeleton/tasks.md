> 版本: v1.0.0 | 状态: 已确认 | 更新: 2026-11-10 | 确认人: 陈卓 | 确认日期: 2026-11-10

# 任务清单：project-skeleton（会记 · 基础链路）

## 1. 骨架与基础设施

- [x] T-01 建立仓库骨架、插件入口与 README
  关联: R-01, R-09
  依赖: 无
  验证方式: `npm run verify -- --structure-only` 输出检查项数且 exit 0；`node -e "import('./lib/index.js').then(m=>console.log(m.name, JSON.stringify(m.inject)))"` 打印 `dsh-note-taker ["tools","llm"]`；README 里目录树的每一项都在磁盘上存在
  日志断言: 用最小 fake ctx 调 `apply()`，日志必须出现两行——「插件启动」含 name/version/tools/root/rootSource，「配置加载」含 model/threads/firstRun；对应 plan 关键日志点第 1、2 行
  验收标准: 结构检查绿；三导出齐全；README 覆盖目录树、分层职责、安装、命令、数据目录

- [x] T-02 实现结构化日志与错误信封
  关联: R-07
  依赖: T-01
  验证方式: `node --test tests/logger.test.js tests/errors.test.js`——断言日志行为 `时间 级别 [runId] 模块 - 中文消息, k=v` 且消息内出现 `{` 占位未替换即失败；断言 `err(code,msg,detail)` 产出 `{ok:false,code,message,detail}` 且 `detail` 不含 `stack`；断言日志里写入含 `/Users/` 或 `C:\\Users\\` 的路径时被替换为 `<data>`
  日志断言: 构造一次 ERROR 写入，日志行须含错误码与 `runId`，且**不含**堆栈以外的正文；构造含用户目录的路径，日志中该段被脱敏
  验收标准: 两类用例全绿；错误码常量表就是 `lib/errors.js` 一处，其他文件不出现字面量错误码串

- [x] T-03 实现会议存储与原子写
  关联: R-02
  依赖: T-02
  验证方式: `node --test tests/meetings.test.js`——覆盖新增后读回字段一致、重新实例化后仍可读、按 startedAt 倒序、同 sha256 重复登记返回既有 id、`meetings.json` 被人为写坏时报错且原文件不被覆盖、写入后无 `.tmp` 残留
  日志断言: 重复登记场景日志出现「会议去重」含新 id 与命中 id（plan 日志点第 17 行）
  验收标准: 六类用例全绿；损坏文件场景抛可读错误而非静默重建

## 2. 核心逻辑（纯函数）

- [x] T-04 实现转写解析与统计
  关联: R-05
  依赖: T-01
  验证方式: `node --test tests/parse.test.js`——标准 `[HH:MM:SS]` 解析、无时间戳变体、一条发言跨两行合并、末段结束时间等于覆盖时长、字符数等于各段正文之和、`[3:1]` 报错含行号、空输入返回空集合不抛错
  日志断言: 不适用（纯函数无副作用；仅在校验失败时由调用方记录，见 T-09）
  验收标准: 七类用例全绿；`lib/parse.js` 不 import 任何第三方包

- [x] T-05 实现纪要结构校验器
  关联: R-06
  依赖: T-01
  验证方式: `node --test tests/minutes-validate.test.js`——七章节齐全判合格、缺「决议」判不合格并点名该章节、行动项表为空但写明「本次无行动项」判合格、行动项缺负责人被判为待补项且不被丢弃、空字符串输入判不合格
  日志断言: 不适用（纯函数；不合格时的 WARN 由 T-08 记录）
  验收标准: 五类用例全绿；校验器对入参只读（用冻结对象断言不被修改）

## 3. 音频链路

- [x] T-06 离线安装采集库并接入录音 sidecar
  关联: R-03
  依赖: T-02, T-03
  验证方式: `node scripts/install-py.mjs` 在无网也能复跑（幂等，已装则跳过）；`node scripts/smoke-record.mjs 5` 录 5 秒后，用 `python -c "import av; c=av.open(r'<wav>'); print(c.duration)"` 读出时长 5s±0.5s、采样率 16000、单声道；把设备名改成不存在的设备，返回 `E_DEVICE` 且 `recordings/` 无残留文件
  日志断言: 正常路径依次出现「录音开始」（device/sampleRate/path）与「录音结束」（duration/bytes/exitCode）；异常路径出现「录音失败」含 code 与 stderr 末尾 500 字——对应 plan 日志点第 4、5、6 行
  验收标准: 离线安装可复跑；5 秒录音合规；无设备时 `E_DEVICE` 且零残留

- [ ] T-07 接入转写 sidecar
  关联: R-04
  依赖: T-02
  验证方式: 用 T-06 的 wav 跑 `node scripts/smoke-transcribe.mjs`，产出 `transcripts/<id>.md` 与 `.json`，json 的 segments 数 > 0 且 start 单调递增；把 wav 头部截断后复跑，返回 `E_AUDIO` 且既有 transcript 文件内容不变（比对 sha256）
  日志断言: 依次出现「调用转写 sidecar（出）」DEBUG（含脚本名与参数摘要，不含音频内容）、「转写开始」（runId/meetingId/model/音频时长）、「转写结束」（段数/字符数/rtf/耗时/失败数）、「调用转写 sidecar（回）」（退出码/耗时）；失败路径出现「转写失败」含 runId 与 stderr 末尾——对应 plan 日志点第 7~11 行
  验收标准: 正常与损坏两路符合 R-04；失败不覆盖既有产物

## 4. 纪要与工具

- [ ] T-08 验证 llm 调用形状并实现纪要生成
  关联: R-06, R-08
  依赖: T-02, T-05
  验证方式: 先 `node scripts/smoke-llm.mjs` 打一次最小请求，打印首尾各 80 字符与耗时（确认 `ctx.llm.stream` 的参数形状，形状不符则回改 plan 并重走确认②）；再实现 `lib/minutes.js`，用固定转录跑出纪要，校验器判合格并落盘；把模型返回替换成缺「决议」的文本，确认不落盘、状态 failed、错误体列出缺失章节
  日志断言: 出现「纪要生成开始」（meetingId/provider/model/输入字符数）与「纪要生成结束」（耗时/输出字符数/校验结果）；缺章节场景出现 WARN「纪要校验不通过」含缺失章节；模型抛错场景出现 ERROR「模型调用失败」含 provider/code/耗时——对应 plan 日志点第 12~15 行；正文与提示词**不得**出现在任何日志行
  验收标准: 真实模型跑通一次并落盘；缺章节不落盘；日志中检索不到转写正文片段

- [ ] T-09 注册 6 个工具、状态机与隐私提示
  关联: R-01, R-07, R-08
  依赖: T-03, T-06, T-07, T-08
  验证方式: `npm run verify -- --tools-only` 断言注册数为 6 且名字集合精确匹配；逐条失败路径：未录音 `meeting_record_stop` → `E_STATE`；未转写 `meeting_minutes` → `E_STATE`；未知 meetingId → `E_STATE`；`limit=0` 与 `model=large` → `E_STATE` + `detail.field`；并发两次 `meeting_record_start` → 第二次 `E_STATE` 且进程不退出
  日志断言: 每次状态迁移出现「状态迁移」含 meetingId/字段/旧值→新值；第二次录音出现拒绝并发的一行；首次 `meeting_minutes` 出现「隐私提示首次触发」含 meetingId 与字符数（不含正文）——对应 plan 日志点第 18、16 行
  验收标准: 六工具齐备；五类错误路径返回结构化错误；并发被拒；隐私提示在返回值 `notice` 与日志各出现一次

## 5. 验证收尾

- [ ] T-10 单测收口与 verify 全量
  关联: R-09, R-10
  依赖: T-03, T-04, T-05
  验证方式: `npm run verify` 一次跑完结构检查 + 全部单测，输出检查项数与通过/失败数；人为把 `lib/parse.js` 改成静默丢弃非法行后复跑，确认对应用例失败并指出断言名；再还原并复跑全绿
  日志断言: 不适用（纯校验脚本，无副作用）
  验收标准: 全绿；人为破坏能被测出；verify 退出码与结论一致

- [ ] T-11 端到端演练：录音 → 转写 → 纪要
  关联: R-03, R-04, R-06, R-08
  依赖: T-09, T-10
  验证方式: 真人说 2–3 分钟，内容含 1 个明确决议与 2 个带负责人的行动项；走完三工具链路；把产物路径、音频时长、转写耗时与 rtf、纪要正文前 20 行写入 `completion.md`；再跑一次 `npm run verify` 确认无回归
  日志断言: 单次演练的日志按序出现「录音开始→录音结束→转写开始→转写结束→纪要生成开始→纪要生成结束」，全程无 ERROR 行
  验收标准: 三份产物齐备；纪要含七章节且行动项与口述事实一致；rtf 与耗时如实记录（不得用估算值）

## 自检

| R | 覆盖任务 |
|---|---|
| R-01 | T-01, T-09 |
| R-02 | T-03 |
| R-03 | T-06, T-11 |
| R-04 | T-07, T-11 |
| R-05 | T-04, T-10 |
| R-06 | T-05, T-08, T-11 |
| R-07 | T-02, T-09 |
| R-08 | T-08, T-09, T-11 |
| R-09 | T-01, T-10 |
| R-10 | T-10 |

- 每条 R 至少被一个 T 覆盖；无 T 找不到对应 R
- 依赖只指向更小编号（T-06→T-02/T-03、T-08→T-02/T-05、T-09→T-03/T-06/T-07/T-08、T-11→T-09/T-10），无循环
- 任务数 11，在 3~20 区间；涉及副作用/外部调用/批处理的任务（T-01/T-02/T-03/T-06/T-07/T-08/T-09/T-11）均有可执行的日志断言
