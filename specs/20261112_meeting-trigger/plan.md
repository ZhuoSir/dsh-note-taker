# 技术方案：meeting-trigger

> 版本: v0.2.0 | 状态: 待重确认 | 更新: 2026-11-11 | 确认人: | 确认日期:
> 变更: CR-01（卡片定位与开合记忆，见 `changes/CR-01_panel-blocks-input.md`）
> 需求: `requirements.md` v0.1.0（已确认，陈卓 2026-11-12）

## 一、坑核对（门控节，确认②先审这一节）

已核对 `specs/_project/lessons.md` 中 **24 条坑**（L-01 ~ L-24，含休眠/退休项），相交 3 条：

| 坑 | 相交原因 | 本方案如何避开 |
|---|---|---|
| L-14 用 PowerShell 批量替换 JSX 会吃掉模板字符串反引号 | 本次要改 `src/client/QuickPanel.jsx` 与 `logic.js` | 一律用 `edit` 工具做定点替换，**不用** `pwsh -replace` / 字符串拼接写 JSX；改完立刻 `npm run build:client` + `node --test`，语法错会当场暴露 |
| L-17 受限沙箱下 `npm run verify` 因 spawn EPERM 假红 | 本会话要跑构建与全量测试 | 当前为 `danger-full-access`，无该限制；若将来在受限沙箱跑，先看是否 EPERM 再判红 |
| L-24 PowerShell 的 `Add-Content` 按 GBK 落盘会毁 UTF-8 | 本方案要写 md（spec 文档 + changelog） | md 一律用 `write`/`edit` 工具或 `.tmp/*.py`（`PYTHONUTF8=1`）；写完必跑 `mdtable_check.py` |

另核对**代码级已知约束**（不在 lessons.md，但会直接打红测试）：

| 约束 | 事实 | 影响 |
|---|---|---|
| `tests/page-render.test.js:191` 硬断言入口文案 `● 0:42` | 现有 DOM 在录制中渲染 `● mm:ss` | 改设计后该断言必须同步改写，否则全量测试红 |
| `tests/page-render.test.js:162` 记录了 QuickPanel 的 useState 槽位顺序（0=open … 9=elapsed），后续用例用 `withOverrides({0:true,5:'recording',8:42})` 注入 | 若新增 `useState` 会**整体错位**，测试以奇怪方式失败 | 方案**不新增 useState**：持久化靠 `useState(初始化函数)` 读记忆 + 切换时写记忆，`open` 仍是槽位 0 |
| `scripts/verify.mjs` 校验「提交的 `lib/client.js` == 重建结果」 | 改了 `src/client/*` 必须重建产物并提交，否则 `构建校验: 构建失败` | 任务里包含「重建 + 提交产物」，并附新哈希 |
| `tests/client-bundle.test.js` 断言产物里 `id: 'dsh-note-taker'`、`apply/inject`、注册 ≥2 插槽、非 ASCII 转义 | 构建脚本会做 ASCII 转义 | 不改入口名与插槽数量，产物断言不受影响 |

## 二、方案

### 2.1 纯逻辑：`src/client/logic.js` 新增 `triggerView`

```js
export function triggerView({ recording = false, seconds = 0, open = false } = {}) {
  const timing = recording ? formatDuration(seconds) : ''      // 复用已有 formatDuration → m:ss
  return {
    tone: recording ? 'success' : 'muted',        // 决定圆点颜色令牌
    label: '会记',
    timing,                                        // '' | '0:42'
    expanded: open,
    title: recording ? `会记 · 录制中 ${timing}` : '会记',
    ariaLabel: recording ? `会记，录制中 ${timing}` : '会记，打开面板',
  }
}
```

- 纯函数、无 DOM、无 React，可被 `tests/page-logic.test.js` 直接断言；
- 计时格式沿用 `formatDuration`（现状 `● 0:42` 也是它产出，**已有 `0:42` 这种分:秒格式**，不新造 `mm:ss` 补零格式，避免与卡片内时长显示不一致）；
- `aria-expanded` 由 `expanded` 派生，`title`/`aria-label` 承担 R-02 的「不只靠颜色」。

### 2.2 入口 DOM：`QuickPanel.jsx` 的 trigger

现状（3 行）→ 目标：

```js
createElement('button', {
  type: 'button',
  style: styles.trigger,                 // 无边框/无背景/无内边距
  'aria-expanded': view.expanded,
  'aria-label': view.ariaLabel,
  title: view.title,
  onClick: () => toggle(),
},
  createElement('span', { key: 'dot', style: styles.dot(view.tone), 'aria-hidden': 'true' }),
  createElement('span', { key: 'label' }, view.label),
  view.timing ? createElement('span', { key: 'time', style: styles.timing }, view.timing) : null,
)
```

样式改动（`styles` 对象内）：

| 键 | 现状 | 改为 |
|---|---|---|
| `trigger` | 函数式，带 `padding/border/background` | 常量对象：`display:inline-flex, alignItems:center, gap:6, padding:0, border:'none', background:'transparent', color:theme.textSecondary, cursor:pointer, fontSize:12, fontFamily:'inherit', lineHeight:'16px'` |
| `dot(tone)` | 无 | `width:8, height:8, borderRadius:999, background: tone==='success' ? theme.success : theme.textMuted, display:'inline-block'` |
| `timing` | 无（原先拼在文案里） | `color:theme.textSecondary, fontVariantNumeric:'tabular-nums'`（避免计时跳动时宽度抖） |

**删掉** 原 `styles.trigger(active)` 的布尔分支：开合状态现在只由 `aria-expanded` 表达，视觉上不再用边框高亮（R-01 要求无按钮外观；如果需要开合态视觉反馈，用圆点外的 1px 环，见 2.5 的被拒方案）。

### 2.3 开合与记忆（R-04 / R-05）

```js
const STORAGE_KEY = 'dsh-note-taker:panel-open'

function readStoredOpen() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return false
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch { return false }            // 隐私模式/被禁用 → 按收起处理（R-05）
}

const [open, setOpen] = useState(readStoredOpen)     // 仍是槽位 0，不新增 useState
const toggle = () => setOpen((prev) => { const next = !prev; writeStoredOpen(next); return next })
```

- `writeStoredOpen` 同样 `try/catch` 吞异常：写失败只是不记忆，不影响开合（R-05 不得阻塞）；
- `Esc` 收起：在现有 `useEffect`（监听 `mousedown`）里一并加 `keydown`，仅当 `open` 时挂载；**不 preventDefault**，避免与宿主自己的 Esc 行为打架（若宿主已用 Esc 做别的事，两边都响应也不算冲突，因为这里只关自己的面板）；
- 点击外部仍沿用现有 `rootRef.contains` 判断，不改。

### 2.3a 卡片定位：不与输入区重叠（CR-01 / R-10）

现状（已实测为缺陷）：`root` 只有入口那么大（约 16px 高），`panel` 用 `bottom: calc(100% + 8px)` 定位，
锚点算的是「入口上沿」而不是「输入行上沿」，于是卡片下沿压进输入行，点输入框时点击被卡片吃掉
（用户实测：收起卡片即可输入；缩放窗口可恢复）。

改法：

```js
root: {
  position: 'relative', display: 'inline-flex', alignItems: 'center',
  alignSelf: 'stretch',        // 撑满输入行高，使 bottom:100% 等于输入行上沿
},
panel: {
  position: 'absolute', bottom: '100%', right: 0, zIndex: 40,
  width: 380, maxWidth: 'min(380px, calc(100vw - 24px))',
  marginBottom: 8,             // 用 margin 换间距，不再用 calc(100% + 8px) 把锚点推进行内
  ...
},
```

- `alignSelf: 'stretch'` 让 root 与输入行等高，`bottom: 100%` 自然落在输入行上沿
- 间距用 `marginBottom` 表达，避免再次出现「偏移量吃掉行内空间」的错误
- `maxWidth` 兜窄窗口，防止 380px 在窄窗口溢出

### 2.3b 撤销跨会话开合记忆（CR-01 / R-05）

删除 `PANEL_STATE_KEY`、`readPanelOpen`、`writePanelOpen`；`open` 回到 `useState(false)`；
`close()` 与 toggle 不再写存储。理由：持久化让展开态跨会话常开，是本次「所有会话都打不了字」的放大器，
且用户明确要求默认收起。

### 2.4 主题安全（R-08）

只用 `theme.textMuted`、`theme.success`、`theme.textSecondary` 三个既有令牌，不新增常量、不写 `#xxxxxx`。
深色主题下 `textMuted`（`--dsw-alias-label-tertiary`）与 `success`（#2f9e63）都来自既有配色对，沿用 `theme.js` 的既有约定。

### 2.5 被拒方案（及原因）

| 方案 | 为什么不采用 |
|---|---|
| 直接改 `styles.trigger` 常量，不抽 `triggerView` | 无法满足 R-09 的可测要求；状态映射散在 JSX 里，后续加状态（如「识别中」）只能靠人工看 |
| 用麦克风图标（🎤 字符或 SVG） | 用户在 2026-11-12 问句中明确选了「圆形录制点」 |
| 计时补零成 `00:42` | 与卡片内 `formatDuration`（`0:42`）不一致，同一场会议出现两种格式；R-03 只要求「mm:ss」形态可读，沿用现有格式更稳 |
| 用 `border` 表达开合态（保留一点按钮味） | 与 R-01「不呈现按钮外观」冲突 |
| 记忆存 cookie / 服务端配置 | 纯前端偏好，服务端存储会引入同步与清理负担；cookie 还会随请求发给宿主 |
| 入口悬停才显形（隐藏入口） | 用户选的是「卡片可收，入口常驻」 |
| 卡片改为内联展开（撑开输入区） | 改动量远大于本需求，且会碰宿主输入区布局 |
| 用 `pointer-events: none` 让卡片不吃点击（CR-01 补） | 治标：卡片仍压在输入上方，用户看不见自己在打什么；R-10 要求不重叠 |
| 录制时自动收起卡片（CR-01 补） | 掩盖问题：录制中仍需看字幕，停止后再次遮挡 |
| 卡片 portal 到窗口右下角（CR-01 补） | 引入与宿主布局（滚动/缩放/多窗口）的耦合；本次只改锚点即可满足 R-10 |

## 三、共享面身份矩阵

| # | 共享面 | 身份 / 消费者 | 本方案是否触碰 | 回归载体 |
|---|---|---|---|---|
| 1 | 插槽注册 `conversation.input.right` | id `quick-panel`、组件 `QuickPanel` | 否（仍注册一个） | `client-bundle.test.js`（注册 ≥2 插槽） |
| 2 | `src/client/logic.js` 导出集合 | SettingsPage / QuickPanel / 单测 | **是**（新增 `triggerView`） | `page-logic.test.js` 既有断言 + 新增用例 |
| 3 | `src/client/QuickPanel.jsx` 内 DOM 结构 | 入口按钮（含 `● mm:ss` 文案） | **是** | `page-render.test.js:191` 需同步改写 |
| 4 | `styles.trigger` 形态 | 仅本组件 | **是**（函数 → 常量 + `dot`/`timing`） | 渲染用例看结构，不看样式值 |
| 5 | `theme.js` 令牌 | 全客户端 | 否（只读） | 不改即无风险 |
| 6 | `lib/client.js` 构建产物 | 宿主运行时 | **是**（哈希变化） | `verify.mjs` 可重复构建 + `client-bundle.test.js` |
| 7 | `localStorage` 键 `dsh-note-taker:panel-open` | 新增 | **是**（新键） | 单测模拟 storage；真机刷新验证（S-04） |
| 8 | 卡片内部结构与文案 | 用户可见 | 否 | 现有 `page-render.test.js` 三种阶段用例 |
| 9 | 服务端路由 `/note-taker/*` | 宿主 HTTP | 否 | 不动即无风险 |
| 10 | 工具契约 `meeting_*` | 宿主 agent | 否 | 不动即无风险 |

## 四、日志点

本需求**不新增日志点**，理由逐条（凑数也要写清）：

| 动作 | 为何不记日志 |
|---|---|
| 打开/收起卡片 | 纯前端 UI 状态，无副作用、无落盘、无网络；用户看得到结果，日志无诊断价值 |
| 记忆写入失败 | `try/catch` 静默降级为「不记忆」，属可接受退化；若记日志反而会在隐私模式下刷屏 |
| 圆点颜色变化 | 由 `recording` 派生，而录音启停本身已有日志（现有 `录音开始/停止`），不重复 |

## 五、风险

| 风险 | 可能性 | 影响 | 对策 |
|---|---|---|---|
| `useState` 槽位错位导致渲染测试奇怪失败 | 中（改组件时最容易踩） | 测试红且难定位 | 不新增 `useState`；`page-render.test.js:162` 的槽位注释保持成立 |
| 忘了重建 `lib/client.js` | 高 | `verify` 红，宿主跑旧 UI | 任务里把「重建 + 提交产物」列成独立任务，附新哈希 |
| 深色主题下绿点偏暗 | 中 | 录制态不明显 | `success` 是既有令牌；真机浅/深两主题各看一眼（S-02 实机验证） |
| 宿主也监听 Esc | 低 | 一次 Esc 关两处 | 不 `preventDefault`、不 `stopPropagation`，各自关自己的 |
| 已有的 `● 0:42` 断言被漏改 | 中 | 全量测试红 | 在任务里指名该文件与行号 |

## 六、任务拆解预告（Phase 3 细化）

| # | 任务 | 状态 |
|---|---|---|
| T-01 | `logic.js` 加 `triggerView` + 单测 | 已完成 |
| T-02 | `QuickPanel.jsx` 入口改造（样式 + DOM + aria） | 已完成（CR-01 改造） |
| T-03 | 记忆与 Esc | 已完成（CR-01 回退记忆部分 → T-09） |
| T-04 | 改 `page-render.test.js` 的入口断言 | 已完成（CR-01 拆分 → T-10） |
| T-05 | 重建 `lib/client.js` 并提交 | 已完成（T-08/T-09 后需再建） |
| T-06 | README 入口描述同步 | 已完成 |
| T-07 | 真机验证 | 由 T-10 重做 |
| T-08 | 卡片锚点改为输入行上沿、不遮挡（CR-01） | 待做 |
| T-09 | 撤销跨会话开合记忆（CR-01） | 待做 |
| T-10 | 断言改写 + 真机复验「录制中可打字」（CR-01） | 待做 |