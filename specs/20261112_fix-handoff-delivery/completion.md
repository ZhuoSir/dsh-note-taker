# 完成清单：fix-handoff-delivery

> 完成时间: 2026-11-12 | 版本: v1.1.0（在途） | 缺陷: BUG-05

## 已完成

| 任务 | 内容 | 验证证据 | commit |
|---|---|---|---|
| T-01 | `GET /detail` 增 `outputAbs`/`outputRelative`/`outputBytes`/`transcriptAbs`/`transcriptChars` | `tests/detail-facts.test.js` 3 例全过 | 见下 |
| T-02 | file 模式给绝对路径 + 字节数 + 转写字数，删除 800 字截断 | `tests/handoff-bug05.test.js` S-01/S-02 | 见下 |
| T-03 | legacy 模式：无产物时交付旧转写文件绝对路径 | S-03 | 见下 |
| T-04 | 无载体/超长转写明确失败，不发明摘要 | S-04 | 见下 |
| T-05 | `QuickPanel` 两处调用统一走 `buildFor`，回执按 `modeLabel` | 全量 375/375 | 见下 |
| T-06 | 真机：会话实收 351 字消息，含绝对路径与体量 | 会话 `…cf13df57` 消息全文（见 changelog） | 见下 |
| T-07 | 账目收尾 | `mdtable_check` 全绿 | 见下 |

## 未完成

无。BL-08（已生成纪要可重新生成）不在本 spec 范围，仍挂待办。

## 验证汇总

```
结构检查: 41 项全部存在
构建校验: lib/client.js 可重复构建（d872418e129a）
tests 375 / pass 375 / fail 0
```
