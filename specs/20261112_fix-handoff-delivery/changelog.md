# Changelog: fix-handoff-delivery

> 只追加不改写。每条带证据（命令输出 / 文件行号 / 用户原话）。

## 挂载: v1.1.0（2026-11-12，用户「代码合并1.1.0」后的修 bug 口令，随 v1.1.0 在途版本）

## v1.0.0（2026-11-12）确认人: 陈卓

### 确认①（需求）

用户原话：「BUG-05，这个你看下什么问题」→ 诊断后「走个fix，修复」→
问询「三份文档要一起确认吗」→ 用户选「三层一起确认，挂 v1.1.0（推荐）」。

R-01 绝对路径 + 字节数 / R-02 长转文不截断 / R-03 载体自证 / R-04 回执口径。
Non-goals 四条（不改会话通道、不改产物结构、不做重新生成、不清理 0:03 残留录音）。

### 确认②（方案）

`GET /detail` 只增五字段（`outputAbs`/`outputRelative`/`outputBytes`/`transcriptAbs`/`transcriptChars`）；
`buildHandoffMessage` 三模式 file / legacy / inline，删除 800 字截断。
坑核对：L-38 避开、L-35 不涉及、相对路径跨工作区失效（本 bug 本体）落到 R-01/R-03。

### 确认③（任务）

T-01 ~ T-07 七项，含真机验证（对 1:04:34 那场点生成纪要，贴会话收到的消息全文）。

### 实现与验证（BUG-05 → 已修复）

| 动作 | 落点 | 证据 |
|---|---|---|
| T-01 `GET /detail` 增五字段 | `lib/service.js:969` | `tests/detail-facts.test.js` 3 例全过 |
| T-02 file 模式给绝对路径 | `src/client/handoff.js` | `tests/handoff-bug05.test.js` S-01/S-02 |
| T-03 legacy 模式 | 同上 | S-03 |
| T-04 无载体/超长明确失败 | 同上 | S-04 |
| T-05 两处调用统一 `buildFor` | `src/client/QuickPanel.jsx` | 全量 375/375 |
| T-06 真机端到端 | web `--profile web` | 见下 |
| T-07 账目收尾 | 本文件 + bugs.md + completion.md | `mdtable_check` 全绿 |

真机会话实际收到的消息（会话 `…cf13df57`，351 字）：

```
【会记】会议 20261111-1137-df60（M4演练-回放11点17分录音，0:28）
产物文件（绝对路径）：`D:\workspace\my_workspace\dsh-note-taker\meetings\20261111-1137-df60.md`
相对路径：`meetings/20261111-1137-df60.md`
该文件 359 字节，含 `## 转写`（97 字）与 `## 纪要` 两节。
请直接读取上面的绝对路径，生成会议纪要并写入同一文件的 `## 纪要` 一节；结构要求：…
```

`npm run verify`：结构检查 41 项 / 构建校验 `d872418e129a` / tests 375 pass 0 fail。
