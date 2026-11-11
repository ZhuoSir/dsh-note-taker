# 版本台账

> 规则 v a.b.c：a 大版(破坏性) | b 需求迭代 | c 修 bug | 升位时低位归零 | 初始 v1.0.0
> 状态机: 在途 →(tag)→ 悬空(已发未合main) →(用户确认合main)→ 已发版 →(整版撤回)→ 已撤回(被vA.B.C) | 在途至多一个

当前版本: v1.0.0 | 状态: 在途 | **分支: `1.0.0`（裸号）** | 已挂: 8 需求 / 0 缺陷
最近已发: 无
读数来源: ③ 新工程默认（git 无 tag、无构建物版本字段） | init 日期: 2026-11-10

备注: 2026-11-10 M0 立项——建 `releases/v1.0.0/`（MILESTONE.md，状态「进行中」）与裸号分支
`1.0.0`（自 main tip 切出，基点: main）。首个挂载需求 `specs/20261110_project-skeleton`。

2026-11-11 收尾——本版 6 个 spec 全部合并至 `1.0.0`：project-skeleton、add-cloud-asr、
meeting-page、meeting-console、meeting-workspace-output、meeting-agent-import；
各 spec 的延期任务（T-11/T-09/T-10/T-08）已由用户实机补验通过，completion.md 与 MILESTONE 同步更新。
下一步为 M2 冻结 → M3 汇总 → M4 发版（均待用户口令）。

2026-11-11 增挂——第 7 个 spec `specs/20261111_streaming-asr`（流式上传 + 流式 ASR，BL-06）挂 v1.0.0，
已以 `75d8afc` 合入 `1.0.0`。里程碑审计（挂接/进度双向）：7 个 spec 与 MILESTONE 7 行一一对应，
任务全勾（14/14、5/5、10/10、9/9、8/8、11/11、9/9），合并提交齐全，无漏挂/假勾。

2026-11-11 增挂——第 8 个 spec `specs/20261111_desktop-adaptation`（桌面版安装与升级）挂 v1.0.0，
已以 `b804fe9` 合入 `1.0.0`；7/7 任务完成、12 例单测、全量 344 例通过，用户重启桌面版后真机自测通过。

## ⚠ 悬空账（已 tag 未合 main——下次起新版前必须处置）

| 分支 | 版本 | tag 日 | 基于 | 状态 |
|---|---|---|---|---|
| 无 | — | — | — | — |
