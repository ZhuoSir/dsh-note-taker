# Changelog: meeting-trigger

> 只追加不改写。每条带证据（命令输出/文件行号/用户原话）。

## v0.1.0（2026-11-12）确认人: 陈卓

### 确认①（需求）

用户原话：「确认」。范围：R-01 ~ R-09、S-01 ~ S-07、Non-goals 边界，以及决定 5
（「不要按钮」按**外观**理解，入口语义仍是可点击元素，保留键盘可达与 `aria-expanded`）。

### 立项（M0）

用户原话：「这个太难看了，改成前面一个录制中的图标，默认灰色，录制绿色，会记就改成文字，
不要按钮，然后点击可以打开会记卡片，支持隐藏，走个spec」。

版本问句四选，用户答复：挂 v1.1.0（新开里程碑）、圆形录制点、显示计时 mm:ss、
卡片可收起且入口常驻（状态记住）。

### 确认②（方案）

用户原话：「确认」。范围：坑核对（L-14/L-17/L-24 + 4 条代码级约束）、2.1~2.5 方案、
10 行共享面身份矩阵、3 条日志豁免、5 条风险。确认时特别认可两点：
不新增 `useState`（保槽位 0）、计时沿用 `formatDuration` 不补零。

### 确认③（任务）

用户原话：「确认」。范围：7 项任务的粒度与顺序、T-04 改写现有 /● 0:42/ 断言的方式、
T-07 需用户在真机上看观感、施工分支 eature/meeting-trigger 自 1.1.0 切出。

### 实现（T-01 ~ T-06）

- `logic.js`：新增 `triggerView`（tone/label/timing/expanded/title/ariaLabel）、
  `PANEL_STATE_KEY` + `readPanelOpen`/`writePanelOpen`（storage 可注入）
- `QuickPanel.jsx`：入口改为 `button > 圆点 + 「会记」+ 计时`，样式去边框；
  `useState(readPanelOpen)` 仍占槽位 0（不新增 useState）；点外部与 Esc 合并到同一 effect
- `tests/page-logic.test.js`：+6 例（triggerView 3 + 记忆 3）→ 17 pass
- `tests/page-render.test.js`：`/● 0:42/` 改为结构断言（无 ●、含 0:42、绿点 #2f9e63、border none、
  aria-expanded），+1 例收起态 → 8 pass
- `README.md`：52/106 两处入口描述同步
- 产物重建：`构建校验: lib/client.js 可重复构建（14e953214ad3）`，全量 `tests 350 / pass 350 / fail 0`

偏差（如实记，详见 `completion.md` §三）：
1. 实际顺序是「先重建产物，再改渲染断言」——渲染测试读的是产物，先测会假绿，已记 lessons L-25
2. 记忆逻辑从组件上移到 `logic.js` 并补测（方案片段未写这段，行为一致）
3. T-07 真机观感待用户在桌面版重启后确认

## v0.2.0（2026-11-11）CR-01 确认人: 陈卓

### 触发

用户真机测试原话：「我点击会记，再收起来，是可以点击输入框的；但是录制中和录制结束后不能操作，
我将画面缩小然后再大化，恢复了」。补充：「输入框在，但是无法输入，光标无法进入」。

### 拍板

用户：「按 minor，确认」——CR-01 档位定为 minor（2 轮确认：§S+§P 一轮、§T 一轮）。

### R 变更

- 改 R-05：旧「记住收起选择，下次保持收起」→ 新「默认收起，开合状态不跨会话/跨重载持久化」，
  旧句在 requirements.md 内以 `[旧句 v0.1.0 | CR-01 | …]` 留存
- 增 R-10：卡片展开时（含录制中/录制后）输入框必须可点、可进光标、可输入；卡片不得与输入区几何重叠
- S-04 改写为「展开后收起 → 刷新仍是收起态（默认收起）」；新增 S-08「录制中直接打字」

### T 变更

- 增 T-08（卡片锚点改到输入行上沿）、T-09（撤销记忆）、T-10（断言改写 + 真机复验）
- 改造 T-03（记忆部分回退，标注 `[CR-01：记忆部分回退 → T-09]`）、T-04（拆分到 T-10）、T-05（需再重建）
- 保留 T-01/T-02（T-02 的面板锚点另有 T-08 修）/T-06

### 已实现 commit 处置

- `86068f1`（T-01~T-06 实现）：T-01/T-06 保留；T-02/T-03/T-04/T-05 由 T-08~T-10 改造；
  不整体 revert——`triggerView`、圆点入口、Esc 收起、README 与产物脚本都仍然有效

### CR-01 实现（2026-11-11）

- T-08：`styles.root` 改 `inline-flex + alignItems:center + alignSelf:stretch`（撑满输入行高）；
  `styles.panel` 由 `bottom:'calc(100% + 8px)'` 改为 `bottom:'100%' + marginBottom:8`，
  并加 `maxWidth:'min(380px, calc(100vw - 24px))'` 兜窄屏
- T-09：删除 `PANEL_STATE_KEY`/`readPanelOpen`/`writePanelOpen`（logic.js 减 27 行），
  `open` 回到 `useState(false)`，toggle/close 不再写存储
- T-10：渲染断言新增 `"bottom":"100%"`、`"alignSelf":"stretch"`、`"marginBottom":8`、
  否定 `calc(100% + 8px)`；收起态用例改为空 overrides（默认收起）
- 真实输出：`构建校验: lib/client.js 可重复构建（97a486af92fa）`，`tests 347 / pass 347 / fail 0`
