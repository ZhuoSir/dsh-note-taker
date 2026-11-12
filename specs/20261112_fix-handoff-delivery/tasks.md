# 任务：fix-handoff-delivery

> 版本: v1.0.0 | 状态: 已确认 | 更新: 2026-11-12 | 确认人: 陈卓 | 确认日期: 2026-11-12
> 需求: `requirements.md` v0.1.0（已确认）| 方案: `plan.md` v0.1.0（已确认）
> 施工分支: `feature/fix-handoff-delivery`（自 `1.1.0` 切出，完成后 `--no-ff` 合回）

## 1. 服务端：把路径事实交出去

- [ ] T-01 `GET /detail` 增 `outputAbs` / `outputRelative` / `outputBytes` / `transcriptAbs` / `transcriptChars`
  关联: R-01, R-03
  依赖: —
  验证方式: `node --test tests/detail-facts.test.js`——造一个有产物的会议，断言 `outputAbs` 绝对且
  文件存在、`outputBytes>0`；造一个仅旧转写的会议，断言 `outputAbs=null` 且 `transcriptAbs` 存在
  验收标准: 五个字段齐备且语义与 plan §三 一致；既有字段（`transcript`/`outputPath`/`outputMode`）输出不变

## 2. 消息组装：绝对路径优先，不截断

- [ ] T-02 重写 `buildHandoffMessage` 的 file 模式：绝对路径 + 相对路径 + 字节数 + 转写字数
  关联: R-01, S-01, S-02
  依赖: T-01
  验证方式: `node --test tests/handoff-message.test.js`——断言消息含 `outputAbs` 原样字符串、
  含「字节」「转写」字样、长度 < 400；对 24912 字转写的输入，断言消息里**不含**「只放开头摘要」
  验收标准: 绝对路径出现在消息首屏；长转写不再截断

- [ ] T-03 新增 legacy 模式：无产物但旧转写文件存在时，交付该文件绝对路径
  关联: R-03, S-03
  依赖: T-02
  验证方式: 同上测试文件——构造 `outputAbs=null && transcriptAbs!==null`，断言 mode='legacy'
  且消息含 transcriptAbs、含「只有转写」提示
  验收标准: 旧会议不再落到「内联 + 截断」

- [ ] T-04 两者皆无时不发送空消息；超长转写禁止内联截断
  关联: R-02, R-03, S-04
  依赖: T-03
  验证方式: 构造 `outputAbs=null && transcriptAbs=null && transcript` 分别为空/超 8000 字，
  断言返回 `ok:false` 或明标「不完整」；断言不存在任何 800 字切片逻辑
  验收标准: 无内容 → 明确失败；超长 → 报错而非静默截断

## 3. 接入与口径

- [ ] T-05 `QuickPanel.generateMinutes` 与确认区 `handoff` 同时传入新字段
  关联: R-04, S-05
  依赖: T-01
  验证方式: `node --test tests/page-history.test.js`——断言两处调用的入参都含 `outputAbs`；
  发送成功提示按 mode 显示「文件路径」或「全文」
  验收标准: 两处口径一致；提示不把路径说成全文

- [ ] T-06 测试与真机验证
  关联: 全部
  依赖: T-02, T-03, T-04, T-05
  验证方式: `npm run verify` 全绿；真机（web `--profile web` + CDP）对 1:04:34 那场点生成纪要，
  把会话收到的消息全文贴出来——必须含绝对路径且 < 400 字
  验收标准: 真机消息可见绝对路径；`tests` 全过

## 4. 收尾

- [ ] T-07 BUG-05 状态翻「已修复(v1.1.0)」、changelog 记到编号级、completion.md 生成
  关联: —
  依赖: T-06
  验证方式: `mdtable_check.py` 三文件全绿；`git log` 有对应 commit footer `Bug: BUG-05`
  验收标准: 台账与代码一致