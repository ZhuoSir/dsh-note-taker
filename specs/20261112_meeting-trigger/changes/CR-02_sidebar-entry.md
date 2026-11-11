> 编号: CR-02 | 档位: minor（用户「继续做」拍板） | 状态: 处理中 | 提出: 2026-11-11 | 提出人: 陈卓
> 父 spec: specs/20261112_meeting-trigger v0.2.0 → 目标 v0.3.0 | 挂载版本: v1.1.0
> §S: 已确认 | 确认人: 陈卓 | 日期: 2026-11-11
> §P: 已确认 | 确认人: 陈卓 | 日期: 2026-11-11
> §T: 已确认 | 确认人: 陈卓 | 日期: 2026-11-11 | 八动作: 8/8

# CR-02 入口搬到侧栏全局面板行

## §S 需求变更

### 触发

用户 2026-11-11 真机反馈（原话）：

> 现在这个不能输入问题解决了，但是我觉得当前会话中的会记位置还是不合适，
> 录制毕竟是一个全局的事情，把它放到工作区上面，插件自动化任务那里是否可以

并附截图指明位置：侧栏 `⊕ 新会话 / 插件 / 自动化任务 / 上下文观察` 那一排，
要求会记作为同级第 4 行，**在工作区分组标题之上**，明确「不是设置里的会记入口」。

### 判断

真问题：入口挂在 `conversation.input.right`（**session 作用域**），而录音是宿主级行为。
作用域挂错会连带三个后果：

1. 切会话 → 控制点消失，录音停不掉（BUG-02）
2. 空会话被回收 → 会话本身消失（用户实测）
3. 卡片在输入区旁边 → 遮挡/抢焦点风险（BUG-01/BUG-03）

宿主提供的 `sidebar.panellist` 是 **root 作用域**，正是为全局面板入口设计的，
「插件 / 自动化任务 / 上下文观察」都用它。

### 条款变更

| 条款 | 处置 | 说明 |
|---|---|---|
| R-01 入口构成 | 改 | 位置从「会话输入框右侧」改为「侧栏全局行」；仍是图标 + 文字「会记」 |
| R-02 录制状态色彩 | 保留 + 限定 | 色彩规则不变，作用对象改为侧栏图标与页面状态 |
| R-03 录制计时 | 改 | 侧栏展开态在图标旁显示 `mm:ss`，折叠态不塞文字；页面内同样显示 |
| R-04 卡片的打开与收起 | 改 | 改为「页面的进入与返回」；Esc/点外部收起不再适用 |
| R-05 默认收起/不记忆 | 作废 | 不再有卡片，默认收起语义消失 |
| R-06 可访问性 | 改 | 侧栏行由宿主渲染（键盘可达 + `label` 作无障碍名）；我们只负责图标 `aria-hidden` |
| R-10 卡片不得遮挡输入区 | 作废（结构保证） | 入口不在输入区、卡片不存在，遮挡不可能发生 |
| R-11 全局入口 | 增 | 侧栏 `sidebar.panellist`，order 30，标签「会记」 |
| R-12 单一入口 | 增 | 不再注册 `conversation.input.right`，避免双入口 |
| R-13 会记页面 | 增 | `main` keyed = `meeting-panel`，无会话时也可用 |
| R-14 全局录音状态 | 增 | `GET /note-taker/record` 返回 running/startedAt/seconds，含进程意外退出的自愈 |

## §P 方案

宿主契约（从 app.asar 与已装插件 dsh-context 读出）：

```js
ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'meeting-panel', inject: () => ({ close }) }, MeetingPanel))
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
  { name: 'sidebar.panellist', id: 'meeting-panel', order: 30, label: '会记' }, RecordIcon))
```

- `id` 与 `main` 的 `key` 必须一致，否则点击抛错
- 图标组件 props 为 `{ size, active }`：展开态 16、折叠态 18
- order 现占用 0/10/20（插件 / 自动化任务 / 上下文观察），取 30 落第 4 行
- 客户端新增 `recordState.js`：模块级共享订阅 + 单轮询，只有订阅者存在时才轮询

## §T 任务

| # | 任务 | 状态 |
|---|---|---|
| T-11 | 宿主 `recordState()` + `GET /record`（含自愈） | 已完成 |
| T-12 | `QuickPanel` 支持 `page` 模式 | 已完成 |
| T-13 | 注册 `main` + `sidebar.panellist`，新增图标 `RecordIcon` | 已完成 |
| T-14 | 删除 `conversation.input.right` 入口，重写渲染测试 | 已完成 |
| T-15 | 真机验证（侧栏位置、录制中跨会话仍可停） | 待用户 |

## §I 影响面

| 面 | 变化 |
|---|---|
| 宿主路由 | `/record` 增加 GET = 状态查询 |
| 宿主服务 | 新增 `recordState()`；`state` 补 `label`/`startedAt` |
| 客户端 | 新增 `MeetingPanel.jsx`、`RecordIcon.jsx`、`recordState.js`；`QuickPanel` 支持页面模式 |
| 注册点 | `settings.section` 保留；删 `conversation.input.right`；增 `main`、`sidebar.panellist` |
| 测试 | `page-render` 改为渲染页面模式 + 注册表断言；`page-live` 改用模块导出 |
| 缺陷 | BUG-02 结构性解决；BUG-01/BUG-03 不再可能发生 |
