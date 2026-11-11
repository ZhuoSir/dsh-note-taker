# 里程碑 v1.0.0

> 状态: 进行中 | 目标日期: 未定 | 负责人: KypCa

## 纳入需求

| spec | spec版本 | 状态 | SQL件 | 配置项 | 备注 |
|---|---|---|---|---|---|
| specs/20261110_project-skeleton | v1.0.0 | 已合并 | 0 | 0 | 基本链路：录音 → 转写 → 纪要；T-11 已于 2026-11-11 用户实机补验通过 |
| specs/20261110_add-cloud-asr | v1.1.0 | 已合并 | 0 | 0 | 云端 ASR（百炼 qwen-audio-3.1-asr-flash，非实时 HTTP + 说话人分离，CR-01 改协议）；本地引擎保留 |
| specs/20261110_meeting-page | v1.0.0 | 已合并 | 0 | 0 | 会记页面基础设施（插槽/路由/构建链/宿主适配），来自 BL-01；T-09 已补验 |
| specs/20261110_meeting-console | v1.0.0 | 已合并 | 0 | 0 | 会记工作台：设置页=配置+历史纪要；会话卡片=录音→人确认→交会话生成纪要；T-10 已补验 |
| specs/20261110_meeting-workspace-output | v1.0.0 | 已合并 | 0 | 0 | 产物写入会话工作区 meetings/，交接改为引用 md 路径；T-08 已补验 |
| specs/20261110_meeting-agent-import | v1.0.0 | 已合并 | 0 | 0 | 会话驱动导入：新增 meeting_import 工具，音频→转写→产物路径，纪要由 agent 自己读写；5/5 完成 |

## 纳入缺陷（随版修复批）

| 编号 | 标题 | 严重度 | 状态 |
|---|---|---|---|
| （暂无） | — | — | — |

## 升级项（对外口径，M3 汇总时从各 spec 的 R 条款聚合）

- 待 M3 汇总填写

## 汇总进度

- [ ] 全部 spec 已合并（M2 冻结前置；以 git 合并记录为准）
- [ ] SQL 汇总编号 + rollback 配对（sql/ 件数 == artifacts 行数）
- [ ] 配置汇总 config/changes.md（覆盖全部 artifacts 配置行）
- [ ] RELEASE-NOTES.md（「包含需求」覆盖纳入表）
- [ ] UPGRADE.md + 回滚步骤（执行序条数 == sql/ 件数）
- 演练（唯一人工留证项，空=未过）：验证人 ____ / 日期 ____ / 结论 ____
- [ ] checklist 全勾 → tag（tag 存在性可自动核）
