> 版本: v0.1.0 | 状态: 草稿 | 更新: 2026-11-10

# 任务清单：meeting-agent-import

## 1. 纯函数与规则

- [ ] T-01 导入规则（纯函数）
  关联: R-01, R-02, R-05, R-07
  依赖: 无
  验证方式: `node --test tests/import.test.js` —— 覆盖：
  标签推导（`周会录音.m4a` → `周会录音`；无扩展名 `blob_noext` → `blob_noext`；空名 → 时间）、
  扩展名后备（有后缀保留自身；无后缀 → `.bin`）、
  大小判定（499MB 通过 / 501MB 拒绝并带实际大小 / 0 字节拒绝）、
  未知名后缀不拦截（交给解码器判断）
  验收标准: 四类用例全绿；模块不碰 fs

## 2. 服务与工具

- [ ] T-02 importAudio 扩展：上限、命名、自动转写、返回产物路径
  关联: R-01, R-02, R-03, R-04, R-05, R-06
  依赖: T-01
  验证方式: `node --test tests/service-import.test.js` ——
  正常音频（带后缀）→ 建会议、label 来自文件名、返回 outputFile 且文件存在；
  无后缀文件 → 用 `.bin` 落盘且时长正确；
  超限 → `E_AUDIO` 且不建会议；不存在 → 不建会议；
  `transcribe: true` → 调用转写并返回 transcribed/segments；
  `transcribe: false` → 不调用转写且 transcribed=false；
  转写失败 → 导入仍成功、transcribed=false、带原因
  回归: `POST /note-taker/import` 不带 transcribe 时**不触发转写**（旧行为）
  日志断言: 超限出现 WARN 含 bytes/limit；转写失败出现 WARN 且含 meetingId
  验收标准: 七类用例全绿；既有 247 个测试不回归

- [ ] T-03 新增 `meeting_import` 工具
  关联: R-01, R-03, R-07
  依赖: T-02
  验证方式: `node --test tests/tools.test.js` 增补 —— 工具存在、`output` 同时含 `type/schema/render`、
  `timeoutMs` 为 45 分钟、描述里出现「outputFile」与「## 纪要」、
  `execute` 把参数透传给 service（含默认 transcribe=true）
  验收标准: 五个断言全绿；插件在真实宿主不出现 `entry did not activate`

## 3. 真实链路

- [ ] T-04 会话里真的能导入并写纪要
  关联: R-04, R-06
  依赖: T-03
  验证方式: 真实宿主新开会话，让 agent 调 `meeting_import`：
  ① 普通本地音频路径 ② 无扩展名的附件 blob 路径；
  两次都要返回 outputFile，且 agent 能读该文件、把纪要写进「## 纪要」一节
  验收标准: 两种输入都成功；写回的纪要能在设置页历史纪要列表看到
  备注: **需要用户配合新开会话**；若工具不可见先查插件是否激活

- [ ] T-05 文档与收尾
  关联: R-06
  依赖: T-03
  验证方式: README 增加「在会话里导入音频」一节（含工具参数、返回字段、纪要要自己写）；
  跑一次 `npm run verify` 全绿
  验收标准: 文档能照着做通；verify 全绿

## 自检

| R | 覆盖任务 |
|---|---|
| R-01 | T-01, T-02, T-03 |
| R-02 | T-01, T-02 |
| R-03 | T-02, T-03 |
| R-04 | T-02, T-04 |
| R-05 | T-01, T-02 |
| R-06 | T-02（回归）, T-05 |
| R-07 | T-01, T-02, T-03 |

- 每条 R 至少被一个 T 覆盖；无 T 找不到对应 R
- 依赖只指向更小编号（T-02→T-01；T-03→T-02；T-04→T-03；T-05→T-03），无循环
- 任务数 5，在 3~20 区间
- 有日志断言的任务：T-02（超限与转写失败两条 WARN）
