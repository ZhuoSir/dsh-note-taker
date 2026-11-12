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

## §I 补记：web 版真机验证（2026-11-11）

用 `dsh --profile web --port 8099` 起了 web 宿主，再用 Chrome DevTools Protocol 无人值守驱动，
实测三个必须修的问题：

1. **`ctx.layout` 未声明注入 → main 插槽白屏**
   `Error: cannot get property "layout" without inject` / `slot entry crashed in 'main'`。
   改为 `resolveClose(ctx)` 里 try/catch 探，取不到就不显示「返回会话」。
2. **`inject` 对象形式不被支持 → 整个 web 壳启动失败**
   `web boot: 1 entry did not activate` + `pending (waiting for services: required, optional)`。
   退回数组 `['slots']`。
3. **页面模式不初始化 → 显示「云端未配置 / 开始录音禁用」**
   初始化 effect 挂在 `open` 上，页面里 `open` 恒为 false。改为 `visible = page || open`。

修复后的实测输出（CDP 驱动真浏览器）：

```json
{ "页面含会记页内容": true, "云端已配置": true, "开始录音可用": true, "状态词": ["空闲"] }
```

宿主侧接口实测：`GET /note-taker/record` → `200 {"ok":true,"running":false}`；
侧栏入口实测：`aria-label="会记"`、`y=200`，工作区分组标题在 `y=254`（入口在其上方）；
SVG 两个圆（外环 + 内点），空闲态取 `--dsw-alias-label-tertiary`。

## §I 补记二：切页面后字幕消失（2026-11-11 用户反馈）

用户原话：

> 录制开始后，能看到实时识别出来的内容，但是我切换到其他页面后，再回去，识别内容的框就没了

两处叠加：

1. **宿主**：`recordState()` 把 `streaming` 写成 `Boolean(recording.stream?.engine)`，
   而 `state.stream` 是 `{ session, tail, config }` —— 没有 `engine`，永远返回 `false`。
2. **客户端**：字幕框/当前会议/录音态只存在组件 state，切页面卸载即丢；
   重建时又因 `streaming=false` 不启轮询。

修法：宿主改 `Boolean(recording.stream)`；客户端在 useState 之后接入 `useRecordState()`，
用 `recording / liveMeetingId / liveStreaming` 三个派生量驱动字幕轮询，
并在 `externalRunning` 时把 `current`（含 meetingId、startedAt、streaming）补进组件状态。

CDP 实测（真录音，非模拟）：

```
录音中页面内   /live 每 0.5s 一条 ×18
切走           归零
切回后         +5.1s 恢复，此后每 0.5s 一条
切回后状态     {字幕框:true, 录制中:true, 停止按钮:true, 字数:5}
```

顺带修好一个隐藏问题：录制中侧栏图标内含计时文字，按钮的可访问文本会变成「0:05 会记」，
自动化按 `aria-label === '会记'` 精确匹配会找不到——测试脚本要按 `^会记` 前缀匹配。

## §I 补记三：交给会话拿不到当前会话 id（2026-11-11 用户反馈）

用户原话：

> 提交会话时候有问题，无法自动发送：拿不到当前会话 id，发给当前打开的会话

根因来自 CR-02 本身：`main` 槽的面板收到空 props，搬走之后就没有 `sessionId` 了
（原来靠 `conversation.input.right` 注入）。发送函数于是直接返回「拿不到当前会话 id」。

修法：

1. 新增 `currentSessionId()`：先问 `sessions` 服务有没有暴露当前选择，没有就读
   localStorage 的 `dsh.sessions.current`（`{"sessionId":"session-…"}`，实测可靠）。
2. `sendToSession` 改成两级：作用域已在就直连；不在（正在看会记页面，主区域被面板占用）
   就 `sessions.using(id, {source}, op)` 借一个，发完自动还。
3. 确认区标题显示「目标会话 …ee3c2e27」，发送成功提示里也带上这个尾巴，发错地方一眼能看出来。

web 版真机实测（有声音的录音，TTS 念一段中文）：

```
目标会话      …ee3c2e27
点击「交给会话生成纪要」
提示          已发送到会话 …ee3c2e27（全文，38 字）
会话存储      agent/inbox/spliced + turn/start  ← 消息真的进去了
```

顺带修：`【会记】会议 <id>（(未命名)，0:15）` 的双括号，改成 `（未命名，0:15）`。

## §I 补记四：session/writer-held（2026-11-11 用户反馈）

用户报错原文：

> 无法自动发送：发送失败：conversation.send failed: session/writer-held: session
> "session-6515609d-…" is already owned b…

两层原因：

1. **我自己埋的**：补记三加的 `sessions.using(id, …)` 兜底，回调里再调 `conversation.send`，
   等于先 retain 拿一个写句柄、再开一个——插件和自己抢锁。已删除该路径。
2. **环境**：桌面版和我为验证起的 `dsh web`（8099）是两个进程，同一会话谁先打开谁握写句柄。
   用户报错的那个会话 id，正是我宿主打开过的。

现在的行为：直连发送；遇到 `writer-held` 不再尝试借作用域，而是复制到剪贴板并明说
「该会话正被另一个客户端占着，文本已复制——打开这个会话粘贴发送即可」。

验证用的宿主已停（8099 无监听），测试会议已清（`meetings.json` 20 → 13）。

## §I 补记五：停止录制后切页面，刚录完那场消失（2026-11-12 用户反馈）

用户原话：

> 我点击结束录制之后，切换到了其他页面，再回到会记里，刚才结束录制的内容就没了，找不到了

数据和补记二同类（组件 state 即真相），但这次丢的是「用户以为已经保存的成果」。

现场（`20261112-1309-2625`，13:09–14:19，64 分 35 秒）：音频、转写 `.json`、转写 `.md`
都在盘上，只是没有产物文件、页面也不记得它 —— 用户看到的就是「没了」。

修法：

1. 新增 `src/client/lastMeeting.js`：停止/识别结束就 `rememberMeeting(id)`（localStorage，
   24 小时有效），`重新录` 时 `forgetMeeting()`；
2. `QuickPanel` 挂载时若空闲且有记忆，`GET /detail` 重取转写并按原样回到确认区；
   转写还没好就明确提示「上一场会议 <id> 还没出转写结果，可在 设置 → 会记 查看」，不硬造内容。

现场补救：把 `20261112-1309-2625` 补成标准产物 `meetings/20261112-1309-2625.md`
（24,912 字转写，`## 纪要` 待生成），并把产物位置写回 `meetings.json`，
使它能在设置页的会议记录里正常打开。

验证：新增 `tests/page-restore.test.js`（3 例，真跑 effect）+ `tests/last-meeting.test.js`（5 例）；
全量 tests 357 / pass 357 / fail 0。

