# 版本台账

> 规则 v a.b.c：a 大版(破坏性) | b 需求迭代 | c 修 bug | 升位时低位归零 | 初始 v1.0.0
> 状态机: 在途 →(tag)→ 悬空(已发未合main) →(用户确认合main)→ 已发版 →(整版撤回)→ 已撤回(被vA.B.C) | 在途至多一个

当前版本: v1.1.0 | 状态: 在途 | **分支: `1.1.0`（裸号）** | 已挂: 1 需求 / 0 缺陷
最近已发: v1.0.0（2026-11-11，tag `v1.0.0`）
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

2026-11-11 M2 冻结——用户「1.0.0走封板流程」：前置检查全过（8/8 spec 已合并、73/73 任务勾选、8 份 completion.md、0 缺陷、CR-01 已合入、无孤儿 spec、工作树干净、分支与远端同为 `7005548`），并删除两个已合并施工分支（`feature/desktop-adaptation`、`feature/streaming-asr`）。MILESTONE 状态转「已冻结」，本版内容封板：新需求默认进下一里程碑。
下一步 M3 汇总 → M4 发版（均待用户口令）。

## ⚠ 悬空账（已 tag 未合 main——下次起新版前必须处置）

| 分支 | 版本 | tag 日 | 基于 | 状态 |
|---|---|---|---|---|
| 无 | — | — | — | — |

### 2026-11-11 M4 发版

用户「M4」：自动审计通过 → checklist 21 项全勾（4 项演练留证）→ 落账批处理（MILESTONE 8 行翻
「已发布(v1.0.0)」、本台账翻「已发版」、backlog 2 行翻「已交付(v1.0.0)」、项目根 CHANGELOG 新增条目）
→ 四步核验 → tag `v1.0.0` 打在落账 tip 上。同日合入 `main`（`dc1f6a6`），悬空账归零。

### 2026-11-12 M0 立项 v1.1.0

用户「会记入口改图标+文字，走个spec」，版本问句用户选「挂 v1.1.0，新开里程碑」。
双建完成：`releases/v1.1.0/MILESTONE.md`（状态「进行中」）+ 裸号分支 `1.1.0`（自 `main` @ `dc1f6a6` 切出）。
首个挂载需求 `specs/20261112_meeting-trigger`（会话入口视觉与卡片收起记忆）。

### 2026-11-11 真机反馈 → CR-01 + 第二个 spec

用户在 v1.1.0 真机上验证新入口，发现四个缺陷（BUG-01~04）：卡片展开时压住输入区导致光标进不去
（缩小窗口可恢复）、录制中不能对话、切会话或空会话被回收后录音找不回来、录音进程退出后账目永久 running。
用户指令「都改」，分两路处置：
- `specs/20261112_meeting-trigger` 开 CR-01（minor，待用户拍板档位）：改 R-05（撤销跨会话展开记忆）、
  新增 R-10（卡片不得遮挡输入区），新增任务 T-08~T-10
- 新 spec `specs/20261112_recording-decouple`（挂 v1.1.0，第 2 个需求）：录音与会话解耦 + 中断自愈

### 2026-11-11 追加

- CR-01（minor）：卡片不再遮挡输入区；撤销跨会话开合记忆；原生 confirm 换页面内确认条
- CR-02（minor）：入口从 `conversation.input.right` 搬到 `sidebar.panellist`（order 30），
  新增全局「会记」页面与 `GET /note-taker/record` 状态接口
- 期望产出: 2 需求（meeting-trigger v0.3.0、recording-decouple v0.1.0）→ 需求数从 2 起

