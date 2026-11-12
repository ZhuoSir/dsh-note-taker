# 任务：meeting-trigger

> 版本: v0.4.0 | 状态: 待重确认 | 更新: 2026-11-12 | 确认人: — | 确认日期: —
> 变更: CR-03（新增 T-16 ~ T-19，历史纪要搬到页面）
> 变更: CR-02（新增 T-11~T-15，入口搬到侧栏）
> 变更: CR-01（新增 T-08~T-10；T-03 记忆部分回退、T-04 拆分到 T-10）
> 需求: `requirements.md` v0.1.0（已确认）| 方案: `plan.md` v0.1.0（已确认）
> 施工分支: `feature/meeting-trigger`（自 `1.1.0` 切出，完成后 `--no-ff` 合回）

## 覆盖表（R → 任务）

| R | 覆盖任务 |
|---|---|
| R-01 入口构成 | T-02 |
| R-02 状态色彩 | T-01, T-02 |
| R-03 录制计时 | T-01, T-02 |
| R-04 打开收起 | T-03 |
| R-11 全局入口（CR-02） | T-13 |
| R-12 单一入口（CR-02） | T-14 |
| R-13 会记页面（CR-02） | T-12, T-13 |
| R-14 全局录音状态（CR-02） | T-11 |
| R-05 收起记忆 | T-03 |
| R-06 可访问性 | T-02, T-03 |
| R-07 功能不回归 | T-04 |
| R-08 主题安全 | T-02 |
| R-09 可测 | T-01, T-05 |
| R-10 卡片不遮挡输入区（CR-01） | T-08, T-10 |

## 验收场景 → 任务

| S | 任务 |
|---|---|
| S-01 待机外观 | T-02, T-04 |
| S-02 录制中变绿+计时 | T-01, T-07 |
| S-03 开合 | T-03, T-04 |
| S-04 刷新记忆 | T-03, T-07 |
| S-05 键盘 | T-02, T-03 |
| S-06 全流程不回归 | T-04, T-07 |
| S-07 Esc 收起 | T-03 |
| S-08 录制中可打字（CR-01） | T-08, T-10 |

## 任务清单

- [x] T-01 `logic.js` 新增 `triggerView` 与单测 [node --test tests/page-logic.test.js → 14 pass]
  依赖: 无（可先做）
  验收标准: `triggerView({recording:false})` → `tone='muted'`、`timing=''`、`label='会记'`；
  `triggerView({recording:true, seconds:42})` → `tone='success'`、`timing='0:42'`；
  `expanded` 跟随 `open`；`title`/`ariaLabel` 在录制中带「录制中」字样（R-02 不只靠颜色）。
  验证方式: `node --test tests/page-logic.test.js`——新增 3 例（待机 / 录制中 / open=true），
  断言对象逐字段 `deepEqual`；再跑一次确保现有 12 个导出未被破坏。
  日志断言: 无（纯函数，不涉日志）

- [x] T-02 `QuickPanel.jsx` 入口改造（DOM + 样式 + aria）[产物断言：`border:"none"`、圆点 8px、`aria-expanded`]
  依赖: T-01
  验收标准: 入口渲染为 `button` 内含 `span[dot]` + `span[aria-label 文字]` + 可选 `span[timing]`；
  `styles.trigger` 为常量且无 `border`/`background` 填充/内边距；新增 `styles.dot(tone)`（8px 圆、
  `theme.success`/`theme.textMuted`）与 `styles.timing`（`tabular-nums`）；`aria-expanded` 跟随 `open`；
  圆点为 `aria-hidden`；不新增 `useState`（`open` 仍槽位 0）。
  验证方式: `node --test tests/page-render.test.js`（T-04 改写后）+ 构建后 grep 产物确认
  `border` 已不在入口样式；视觉真机见 T-07。
  日志断言: 无（UI 渲染）

- [x] T-03 卡片收起记忆与 Esc（R-04 / R-05 / R-06）`[CR-01：记忆部分回退 → T-09]`[记忆抽到 logic.js 的 readPanelOpen/writePanelOpen 并单测 3 例；Esc 与点外部同一 effect]
  依赖: T-02
  验收标准: `localStorage` 键 `dsh-note-taker:panel-open`；`useState` 初始化读记忆，缺省/读失败为
  `false`（收起）；每次都 toggle 后写回；读写均 `try/catch` 吞异常；`Esc` 仅在 `open` 时挂载、
  不 `preventDefault`/`stopPropagation`；点击外部关闭保持原行为。
  验证方式: `node --test tests/page-render.test.js` + 真机 T-07 的刷新验证；
  另在 Node 里直接调用 `readStoredOpen`/写路径的等价逻辑（用假 storage 注入）。
  日志断言: 无（方案 §四已豁免：UI 状态无副作用）

- [x] T-04 同步渲染断言与阶段用例（R-07）[`/● 0:42/` 改为结构断言（无 ●、含 0:42、绿点 #2f9e63、border none、aria-expanded）；新增收起态一例 → 8 pass]
  依赖: T-02, T-03
  验收标准: `tests/page-render.test.js:191` 的 `/● 0:42/` 改为断言新结构（圆点元素 + `0:42` 文本，
  且 `●` 不再出现）；槽位注释（L162）仍成立；录音中/识别中/确认区三用例继续通过；
  新增一例：`open=false` 时入口仍渲染（R-05 入口常驻）。
  验证方式: `node --test tests/page-render.test.js`，贴真实输出。
  日志断言: 无

- [x] T-05 重建客户端产物并提交 [构建校验: lib/client.js 可重复构建（14e953214ad3）；tests 350 / pass 350 / fail 0]
  依赖: T-04
  验收标准: `lib/client.js` 与源码一致；`npm run verify` 输出「构建校验: lib/client.js 可重复构建（<新哈希>）」；
  全量 `tests` 通过且 `fail 0`。
  验证方式: `npm run verify` 贴真实输出（结构检查项数、构建哈希、tests/pass/fail）。
  日志断言: 无

- [x] T-06 README 入口描述同步 [第 52/106 行改为「图标 + 文字」「圆点变绿、显示计时」；grep「会记」按钮」无残留]
  依赖: T-02
  验收标准: `README.md` 第 52 行「有「会记」按钮」与第 106 行同类表述改为「图标 + 文字」的描述，
  与新入口一致；不新增与实现不符的说法。
  验证方式: `grep -n "按钮" README.md` 复核，贴输出。
  日志断言: 无

- [ ] T-07 真机验证（浅色/深色主题）— 待用户在桌面版重启后确认（代码侧证据：profile link 指向本仓、产物哈希 14e953214ad3 与本仓一致）
  依赖: T-05
  验收标准: 桌面版（或 web）里：待机为灰点+「会记」无边框；开始录音后 3 秒内变绿并显示计时；
  停止后回灰、计时消失；点入口开卡片、点外部与 Esc 收起；收起后刷新页面仍收起；
  录 3 秒→停止→识别→交会话全流程正常；设置页不受影响（S-01~S-07）。
  验证方式: 真机操作 + 截图/描述；浅深两主题各看一次。若无法自动截图，由用户在真机上确认并记录原话。
  日志断言: 宿主日志应无新增 ERROR/WARN；录音启停日志仍与 v1.0.0 一致

## 依赖图

```
T-01 → T-02 → T-03 → T-04 → T-05 → T-07
         └───────── T-06
```

## 完成判定

7 项全勾 + `npm run verify` 真实输出（344+N 例全过、构建哈希更新）+ 真机确认原话，
才写 `completion.md` 并进入合并。

## CR-01 新增任务（2026-11-11）

- [x] T-08 卡片锚点改为输入行上沿、且不与输入区重叠（CR-01 / R-10）[产物断言 `"bottom":"100%"` / `"alignSelf":"stretch"` / `"marginBottom":8`，不再有 `calc(100% + 8px)`]
  依赖: 无 | 处置: 新增
  验收标准: `root` 增加 `alignSelf:'stretch'` 与 flex 居中；`panel` 改用 `bottom:'100%'` + `marginBottom:8`
  （不再用 `calc(100% + 8px)` 把锚点推进行内）；`panel.maxWidth` 兜窄屏；入口视觉位置不变。
  验证方式: 产物断言 `"bottom":"100%"` 与 `"alignSelf":"stretch"`；真机点输入框能进光标。
  日志断言: 无

- [x] T-09 撤销跨会话开合记忆（CR-01 / R-05）[logic.js 删 27 行记忆三件套；grep 无残留；page-logic 回到 14 例]
  依赖: 无 | 处置: 新增（回退 T-03 的记忆部分）
  验收标准: 删 `PANEL_STATE_KEY`/`readPanelOpen`/`writePanelOpen`；`open` 回到 `useState(false)`；
  收起/展开不再写浏览器存储；`page-logic` 的 3 个记忆用例删除。
  验证方式: `node --test tests/page-logic.test.js` 贴输出（应回到 14 例）；`grep -r "panel-open" src/` 无命中。
  日志断言: 无

- [x] T-10 断言改写与真机复验（CR-01 / R-10 / S-08）[断言全绿；真机「录制中可打字」由用户 2026-11-11 确认]
  依赖: T-08, T-09 | 处置: 新增（承接 T-04/T-07）
  验收标准: `page-render` 收起态用例改写成「默认收起」；新增断言「卡片展开时 panel 不进入输入行」
  （`"bottom":"100%"`）；真机：卡片展开、录制中直接点输入框能打字并发送。
  验证方式: `npm run verify` 贴真实输出（结构检查/构建哈希/tests 数）；真机由用户确认原话。
  日志断言: 宿主日志无新增 ERROR/WARN

## 依赖图（CR-01 段）

```
T-08 ─┐
      ├→ T-10 →（真机复验 → completion）
T-09 ─┘
```

## CR-02 任务（2026-11-11）

- [x] T-11 宿主 `recordState()` + `GET /record`（CR-02 / R-14）
  证据: `lib/service.js` 新增 `recordState()`（含 `child.exitCode` 自愈）；`lib/routes.js` 的 `/record` 支持 GET

- [x] T-12 `QuickPanel` 支持页面模式（CR-02 / R-13）
  证据: 新增 `page` 参数；页面态 `styles.pageRoot/pagePanel`，不再有绝对定位浮层与入口按钮

- [x] T-13 注册 `main` + `sidebar.panellist` + 侧栏图标（CR-02 / R-11）
  证据: `src/client/index.jsx` 注册 `main`（key `meeting-panel`）与 `sidebar.panellist`（order 30）；
  新增 `MeetingPanel.jsx`、`RecordIcon.jsx`、`recordState.js`

- [x] T-14 删除输入框入口并重写渲染测试（CR-02 / R-12）
  证据: `conversation.input.right` 注册已删除；`page-render` 增加注册表断言（id 与 key 一致、order 30、
  不再有 input.right）；`page-live` 改用模块导出

- [x] T-12b 页面模式初始化修复（web 版实测发现）
  证据: 初始化 effect 改 `visible = page || open`；`useRecordState` 接入页面态，
  另一会话开着的录音在页面里显示「停止并识别 mm:ss」

- [x] T-12c 切页面后字幕框丢失（用户反馈，host + client 两处）
  证据: 宿主 `streaming: Boolean(recording.stream)`；客户端派生 `recording/liveMeetingId/liveStreaming`
  并在外部录音时重建 `current`；CDP 实测切回后 /live 轮询恢复、字幕框与「录制中」都在

- [x] T-12d 「交给会话」拿不到当前会话 id（用户反馈）
  证据: `currentSessionId()` 读 `dsh.sessions.current`；作用域缺失时用 `sessions.using` 借；
  web 实操「已发送到会话 …ee3c2e27（全文，38 字）」，会话存储里出现 `agent/inbox/spliced` + `turn/start`

- [x] T-12e 写锁冲突（session/writer-held）处理
  证据: 删除 `sessions.using` 兜底路径（retain + send = 自己抢自己）；
  识别 `writer-held` 并给出「另一个客户端占着会话」的明确提示 + 剪贴板兜底；
  验证用 web 宿主已停

- [x] T-12f 停止录制后切页面，刚录完那场消失（用户反馈）
  证据: `lastMeeting.js` 记忆 + 挂载时 `GET /detail` 恢复确认区；
  `tests/page-restore.test.js` 3 例 + `tests/last-meeting.test.js` 5 例；
  现场会议 `20261112-1309-2625` 已补成产物 `meetings/20261112-1309-2625.md`

- [ ] T-15 真机验证（CR-02 / S-09 / S-10）
  验收标准: 侧栏出现第 4 行「会记」；点击进入页面；录制中切会话图标仍是绿点 + 计时；无会话也能录音
  验证方式: 用户原话确认

## 依赖图（CR-02 段）

```
T-11 ─┐
T-12 ─┼→ T-13 → T-14 → T-15（真机）
      ┘
```

### T-15 进展（web 版 CDP 实测，2026-11-11）

已完成（脚本 `node .tmp/cdp-panel2.mjs <url>`）：
- 侧栏入口存在且在工作区标题之上（y=200 < 254），`aria-label="会记"`
- 点击后主区域渲染会记页面，`云端已配置: true`，`开始录音可用: true`，状态词「空闲」
- `GET /note-taker/record` 返回 `200 {"ok":true,"running":false}`

仍需真人真机确认（headless 无麦克风，录不了音）：
- 录制中侧栏图标变绿 + 显示 mm:ss
- 录制中切会话 / 切到空会话，入口仍在、仍能停止
- 2026-11-11 追加实测：切走再切回会记页面，字幕区恢复（`{字幕框:true, 录制中:true, 停止按钮:true}`），
  `/live` 轮询在切走后归零、切回后恢复




