# 里程碑 v1.0.0

> 状态: 已冻结 | 目标日期: 未定 | 负责人: KypCa

## 纳入需求

| spec | spec版本 | 状态 | SQL件 | 配置项 | 备注 |
|---|---|---|---|---|---|
| specs/20261110_project-skeleton | v1.0.0 | 已合并 | 0 | 0 | 基本链路：录音 → 转写 → 纪要；T-11 已于 2026-11-11 用户实机补验通过 |
| specs/20261110_add-cloud-asr | v1.1.0 | 已合并 | 0 | 0 | 云端 ASR（百炼 qwen-audio-3.1-asr-flash，非实时 HTTP + 说话人分离，CR-01 改协议）；本地引擎保留 |
| specs/20261110_meeting-page | v1.0.0 | 已合并 | 0 | 0 | 会记页面基础设施（插槽/路由/构建链/宿主适配），来自 BL-01；T-09 已补验 |
| specs/20261110_meeting-console | v1.0.0 | 已合并 | 0 | 0 | 会记工作台：设置页=配置+历史纪要；会话卡片=录音→人确认→交会话生成纪要；T-10 已补验 |
| specs/20261110_meeting-workspace-output | v1.0.0 | 已合并 | 0 | 0 | 产物写入会话工作区 meetings/，交接改为引用 md 路径；T-08 已补验 |
| specs/20261110_meeting-agent-import | v1.0.0 | 已合并 | 0 | 0 | 会话驱动导入：新增 meeting_import 工具，音频→转写→产物路径，纪要由 agent 自己读写；5/5 完成 |
| specs/20261111_streaming-asr | v0.1.0 | 已合并 | 0 | 0 | 流式上传 + 流式 ASR（BL-06）；9/9 任务完成，真机补验通过（首字 0.91s、停录 0.99s、降级路径实测），合并于 `75d8afc` |
| specs/20261111_desktop-adaptation | v1.0.0 | 已合并 | 0 | 0 | 桌面版（Electron）安装与升级：一条命令幂等安装/卸载、装前备份、装后五项自检；7/7 任务完成，真机自测通过，合并于 `b804fe9` |

## 纳入缺陷（随版修复批）

| 编号 | 标题 | 严重度 | 状态 |
|---|---|---|---|
| （暂无） | — | — | — |

## 升级项（对外口径，M3 汇总时从各 spec 的 R 条款聚合）

- 待 M3 汇总填写

## 冻结记录（M2，2026-11-11）

触发: 用户「1.0.0走封板流程」。前置检查逐项按事实重算（脚本 `.tmp/m2-audit.mjs`，不靠记忆）：

| 检查项 | 判据 | 结果 |
|---|---|---|
| 表内 spec 全部已合并 | MILESTONE 纳入需求表状态列 | ✓ 8/8 = 已合并 |
| 任务全勾 | 各 `tasks.md` 的 `- [x] T-` / `- [ ] T-` 计数 | ✓ 73 勾 / 0 未勾 |
| 证据齐 | 各 spec `completion.md` 存在 | ✓ 8/8 |
| P0/P1 缺陷达已验证 | `specs/_project/bugs.md` 行数 | ✓ 0 行（本版无登记缺陷） |
| 账证初对 | 本版提交 `Bug:` footer ↔ bugs.md | ✓ 无 Bug footer，账证一致 |
| 无孤儿 spec | 各 spec changelog「挂载:」行 | ✓ 8/8 指向 v1.0.0 |
| 无未收口 CR | `specs/*/changes/*.md` 状态 | ✓ 1 份（CR-01 http-asr）已合入 |
| 工作树干净 | `git status --porcelain` | ✓ 空 |
| 版本分支与远端一致 | `git log -1 1.0.0` / `origin/1.0.0` | ✓ 均为 `7005548` |
| 施工分支收尾 | 已合并的 `feature/*` | ✓ 删除 `feature/desktop-adaptation`(d1b58e6)、`feature/streaming-asr`(70907ba)，内容均在 `1.0.0` 历史内 |

冻结结论: **v1.0.0 内容封板**——此后新需求默认进下一里程碑；要挤进本版必须解锁重走 M2 并记录。
本版未产生 SQL 与配置变更（8 个 spec 均无 `artifacts.md` 的 SQL/配置行），M3 汇总的 SQL/配置两节预计为空。

## 汇总进度

- [x] 全部 spec 已合并（M2 冻结前置；以 git 合并记录为准）
- [ ] SQL 汇总编号 + rollback 配对（sql/ 件数 == artifacts 行数）
- [ ] 配置汇总 config/changes.md（覆盖全部 artifacts 配置行）
- [ ] RELEASE-NOTES.md（「包含需求」覆盖纳入表）
- [ ] UPGRADE.md + 回滚步骤（执行序条数 == sql/ 件数）
- 演练（唯一人工留证项，空=未过）：验证人 ____ / 日期 ____ / 结论 ____
- [ ] checklist 全勾 → tag（tag 存在性可自动核）
