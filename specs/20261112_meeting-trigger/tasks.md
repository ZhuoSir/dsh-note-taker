# 任务：meeting-trigger

> 版本: v0.1.0 | 状态: 待确认 | 更新: 2026-11-12 | 确认人: | 确认日期:
> 需求: `requirements.md` v0.1.0（已确认）| 方案: `plan.md` v0.1.0（已确认）
> 施工分支: `feature/meeting-trigger`（自 `1.1.0` 切出，完成后 `--no-ff` 合回）

## 覆盖表（R → 任务）

| R | 覆盖任务 |
|---|---|
| R-01 入口构成 | T-02 |
| R-02 状态色彩 | T-01, T-02 |
| R-03 录制计时 | T-01, T-02 |
| R-04 打开收起 | T-03 |
| R-05 收起记忆 | T-03 |
| R-06 可访问性 | T-02, T-03 |
| R-07 功能不回归 | T-04 |
| R-08 主题安全 | T-02 |
| R-09 可测 | T-01, T-05 |

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

## 任务清单

- [ ] T-01 `logic.js` 新增 `triggerView` 与单测
  依赖: 无（可先做）
  验收标准: `triggerView({recording:false})` → `tone='muted'`、`timing=''`、`label='会记'`；
  `triggerView({recording:true, seconds:42})` → `tone='success'`、`timing='0:42'`；
  `expanded` 跟随 `open`；`title`/`ariaLabel` 在录制中带「录制中」字样（R-02 不只靠颜色）。
  验证方式: `node --test tests/page-logic.test.js`——新增 3 例（待机 / 录制中 / open=true），
  断言对象逐字段 `deepEqual`；再跑一次确保现有 12 个导出未被破坏。
  日志断言: 无（纯函数，不涉日志）

- [ ] T-02 `QuickPanel.jsx` 入口改造（DOM + 样式 + aria）
  依赖: T-01
  验收标准: 入口渲染为 `button` 内含 `span[dot]` + `span[aria-label 文字]` + 可选 `span[timing]`；
  `styles.trigger` 为常量且无 `border`/`background` 填充/内边距；新增 `styles.dot(tone)`（8px 圆、
  `theme.success`/`theme.textMuted`）与 `styles.timing`（`tabular-nums`）；`aria-expanded` 跟随 `open`；
  圆点为 `aria-hidden`；不新增 `useState`（`open` 仍槽位 0）。
  验证方式: `node --test tests/page-render.test.js`（T-04 改写后）+ 构建后 grep 产物确认
  `border` 已不在入口样式；视觉真机见 T-07。
  日志断言: 无（UI 渲染）

- [ ] T-03 卡片收起记忆与 Esc（R-04 / R-05 / R-06）
  依赖: T-02
  验收标准: `localStorage` 键 `dsh-note-taker:panel-open`；`useState` 初始化读记忆，缺省/读失败为
  `false`（收起）；每次都 toggle 后写回；读写均 `try/catch` 吞异常；`Esc` 仅在 `open` 时挂载、
  不 `preventDefault`/`stopPropagation`；点击外部关闭保持原行为。
  验证方式: `node --test tests/page-render.test.js` + 真机 T-07 的刷新验证；
  另在 Node 里直接调用 `readStoredOpen`/写路径的等价逻辑（用假 storage 注入）。
  日志断言: 无（方案 §四已豁免：UI 状态无副作用）

- [ ] T-04 同步渲染断言与阶段用例（R-07）
  依赖: T-02, T-03
  验收标准: `tests/page-render.test.js:191` 的 `/● 0:42/` 改为断言新结构（圆点元素 + `0:42` 文本，
  且 `●` 不再出现）；槽位注释（L162）仍成立；录音中/识别中/确认区三用例继续通过；
  新增一例：`open=false` 时入口仍渲染（R-05 入口常驻）。
  验证方式: `node --test tests/page-render.test.js`，贴真实输出。
  日志断言: 无

- [ ] T-05 重建客户端产物并提交
  依赖: T-04
  验收标准: `lib/client.js` 与源码一致；`npm run verify` 输出「构建校验: lib/client.js 可重复构建（<新哈希>）」；
  全量 `tests` 通过且 `fail 0`。
  验证方式: `npm run verify` 贴真实输出（结构检查项数、构建哈希、tests/pass/fail）。
  日志断言: 无

- [ ] T-06 README 入口描述同步
  依赖: T-02
  验收标准: `README.md` 第 52 行「有「会记」按钮」与第 106 行同类表述改为「图标 + 文字」的描述，
  与新入口一致；不新增与实现不符的说法。
  验证方式: `grep -n "按钮" README.md` 复核，贴输出。
  日志断言: 无

- [ ] T-07 真机验证（浅色/深色主题）
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