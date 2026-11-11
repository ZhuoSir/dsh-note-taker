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
