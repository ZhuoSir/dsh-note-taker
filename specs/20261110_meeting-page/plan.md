> 版本: v1.0.0 | 状态: 已确认 | 更新: 2026-11-10 | 确认人: 陈卓 | 确认日期: 2026-11-10

# 技术方案：meeting-page

## 坑核对（门控节，确认②先审这一节）

已核对 `specs/_project/lessons.md` 中 **10 条 active 坑**（L-04 休眠、L-11 退休，不计），相交 4 条：

| 坑 | 相交 | 本方案如何避开 |
|---|---|---|
| L-02 装包被 ACL 拦 | **是** | 新增依赖只有 `esbuild`（npm，不碰 pip）；安装走 `pnpm add -D`，若失败则退到 `npx esbuild` 直跑二进制，不阻塞实现 |
| L-06 `~/.dsh` 只读 | **是** | 页面只经宿主路由读数据根；路由内部用与工具相同的 `NOTE_TAKER_DATA` 解析，开发期指到工作区 |
| L-09 环境结论会失效 | **是** | 插槽能力结论来自已装插件源码（`dsh-vision-router` 的 `conversation.input.right`、`dsh-sessions-manager` 的 `settings.section`），不是猜测；但**仍先做探针**（T-01）再写页面 |
| L-10 headless 不挂载插件 | **是** | 页面必须在图形 profile 里才可见；开发验证用「装进 desktop profile + 新会话」这条路径，并把它写进 README |
| L-01 sherpa / L-03 权限 / L-05 命名 / L-07 GBK / L-08 HF / L-12 词表 | 否 | 本版不触碰这些面 |

## 方案概述

三块改动，**不动已有的转写/纪要逻辑**，只在其上加一层界面：

```
宿主侧（lib/routes.js）     新增 6 条精确路由，把 service 能力暴露成 JSON
客户端（src/client/）       React 18：一个设置区页面 + 一个输入框旁按钮
构建（scripts/build-client.mjs）  esbuild 打包 → lib/client.js
```

页面只做「展示 + 触发动作」，所有业务判断仍在 `lib/service.js`——**页面不重复实现状态机与错误码**。

## 模块与数据流

```
src/client/logic.js        纯函数：状态映射、时长格式化、排序过滤、错误文案、隐私提示判定
src/client/MeetingPage.jsx settings.section 页面：列表 + 详情 + 动作按钮 + 轮询
src/client/QuickPanel.jsx  conversation.input.right 悬浮面板：录音起停 + 最近 3 场
lib/routes.js              ctx.webServer.register 的 6 条路由，body 解析 + 参数校验 + 统一信封
lib/service.js             复用（只加一个只读的 describeMeeting 辅助方法，不改变既有行为）
scripts/build-client.mjs   esbuild → lib/client.js（external: react/react-dom/@deepseek-ai/*）
```

数据流（一次「云端转写」点击）：

```
页面点按钮 → POST /note-taker/transcribe {id, engine:'cloud'}
  → routes 校验 → service.transcribe()（既有逻辑，含分片/重试/落盘）
  → 立刻返回 {ok:true, accepted:true}（不阻塞请求）
页面每 2s 轮询 GET /note-taker/list → 行状态 running → done
打开详情 → GET /note-taker/detail?id= → 返回 md 正文与 json 统计
```

## 接口设计

全部 `kind: 'exact'`，参数走查询串或 JSON body（不依赖未验证的路由参数能力）：

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| GET | `/note-taker/list` | `limit`（1–100，默认 20） | `{ok, meetings:[{id,label,startedAt,durationSec,engine,status,stats,errors}]}` |
| GET | `/note-taker/detail` | `id` | `{ok, meeting, transcript, minutes, transcriptBytes, minutesBytes}` |
| GET | `/note-taker/health` | — | `{ok, cloud:{configured, model, host}, local:{models:[]}, recording:{available}}` |
| POST | `/note-taker/transcribe` | `{id?, engine?}` | `{ok, accepted:true, meetingId}` 或错误信封 |
| POST | `/note-taker/minutes` | `{id?, force?}` | `{ok, minutesPath, markdown}` |
| POST | `/note-taker/record` | `{action:'start'\|'stop', label?}` | `{ok, meetingId?, durationSec?}` |

约定（沿用既有 `lib/errors.js` 信封与错误码，不新增码）：

- 所有响应 `application/json; charset=utf-8`，成功 `{ok:true,...}`，失败 `{ok:false,code,message,detail}`
- 入参一律校验（`limit` 范围、`id` 格式、`engine` 枚举），非法 → `E_STATE` + `detail.field`
- `transcribe` 是**长任务**：路由立即返回 `accepted`，实际执行由 service 的队列承接；
  页面靠轮询看状态（与工具调用语义一致）
- 路径安全：只接受数据目录内的 `id`，不接受任何文件路径参数

## 客户端结构

```jsx
// settings.section
ctx.slots.inject('settings.section', () => ctx.slots.register(
  { name: 'settings.section', id: 'meeting-page', order: 120, label: '会记' },
  MeetingPage,
))

// conversation.input.right
scope.effect(() => scope.slots.inject('conversation.input.right', function* () {
  yield scope.slots.register({ name: 'conversation.input.right', id: 'meeting-quick', order: 60 }, QuickPanel)
}))
```

（两种注册式样分别取自已装插件 `dsh-sessions-manager` 与 `dsh-vision-router` 的真实源码。）

组件纪律：
- 所有 `fetch` 封装在 `src/client/api.js`，统一超时与错误 → 用户文案
- 轮询只在页面可见时进行（`document.hidden` 时暂停），最长 30 分钟后自动停
- 转写正文用「展开/收起 + 分块渲染」，默认只渲染前 100 段，避免 550 段卡死

## 数据模型

不改 `meetings.json` 结构；只读消费。`detail` 接口读 `transcripts/<id>.md|json` 与 `minutes/<id>.md`。

## 共享面身份矩阵

**这次真的新增共享面：6 条 HTTP 路由一旦发布就有外部消费者（页面、未来的第三方）。**

| 对象 | 身份（方法 × 调用方） | 变更后预期行为 | 断言归属 |
|---|---|---|---|
| `/note-taker/list` | GET × 页面列表、快捷面板 | 返回倒序会议数组，字段与 meetings.json 一致 | T-04、T-08 |
| `/note-taker/detail` | GET × 页面详情 | 缺转写/纪要时字段为 null 而非 500 | T-04 |
| `/note-taker/health` | GET × 页面能力探测 | 缺 key 时 `cloud.configured=false`，页面据此禁用云端按钮 | T-04、T-07 |
| `/note-taker/transcribe` | POST × 页面、快捷面板 | 立即返回 accepted，不阻塞；非法 engine → `E_STATE` | T-04、T-09 |
| `/note-taker/minutes` | POST × 页面 | 结构不合格返回 `E_STATE` 且不落盘（沿用既有校验） | T-04 |
| `/note-taker/record` | POST × 页面、快捷面板 | start 冲突 → `E_STATE`；stop 未录音 → `E_STATE` | T-04 |
| `meetings.json` / `transcripts/*` | 既有消费者：service、工具 | **只读**，本版不写新字段（`describeMeeting` 只做视图拼装） | T-03 |
| `meeting_*` 工具契约 | 既有 Agent 调用 | 不变 | T-02 回归 |

矩阵外的身份 = 未评估；上表 8 个身份都有对应断言。

## 关键日志点清单

| 场景 | 级别 | 触发点 | 必带字段 | runId |
|---|---|---|---|---|
| 路由注册完成 | INFO | `lib/routes.js` registerAll | 路由条数、host、port | — |
| 路由请求 | INFO | 统一 handler 入口 | method、path、query 摘要（不含音频内容） | requestId |
| 路由响应 | INFO | 统一 handler 出口 | status、耗时、ok | requestId |
| 路由错误 | ERROR | 统一 handler catch | code、message、耗时 | requestId |
| 非法入参 | WARN | 参数校验 | 字段名、非法值（截断 50 字） | requestId |
| 动作转发 | INFO | transcribe/minutes/record 路由 | meetingId、engine/action | meetingId |
| 云端未配置 | WARN | health 探测 | 缺的环境变量名 | — |
| 页面轮询被暂停 | DEBUG | 客户端（仅浏览器控制台） | 原因（hidden/timeout） | — |

敏感纪律：路由日志不记音频字节、不记转写正文、不记 API Key；`detail` 响应体是正文，但**不进日志**。

## 关键决策

### 决策 1：exact 路由 + 查询串，不用路由参数

- 采用：`/note-taker/detail?id=xxx` 这类精确路径。
- 理由：已装插件里只见到 `kind:'exact'` 的用法，带参数的 `path` 能力没有实证；用查询串零风险。
- 被拒：`/note-taker/detail/:id`。理由：未验证路由是否支持参数匹配，失败代价是整页不可用。
- 重新评估条件：确认 webServer 支持参数路由后。

### 决策 2：长任务立即返回 accepted，页面轮询

- 采用：`transcribe` 不 await 完成，立刻返回。
- 理由：47 分钟音频云端要 5 分钟，HTTP 请求挂 5 分钟会被浏览器/代理超时打断；且与工具语义一致（状态在服务端）。
- 被拒：SSE 推进度。理由：多一套协议与重连逻辑，收益是秒级进度；当前 2 秒轮询够用。
- 被拒：请求里同步等待。理由：浏览器默认超时 + 用户切页即断。

### 决策 3：esbuild 而非 vite/rollup

- 采用：单文件 esbuild 打包，`external: ['react','react-dom', /^@deepseek-ai\//]`。
- 理由：产物是一个 `lib/client.js`，不需要 dev server、HMR、分包；esbuild 是一个二进制依赖，装完即用。
- 被拒：vite。理由：为一个页面引入整套 dev server 与配置，收益为负。
- 重新评估条件：前端超过 5 个页面时。

### 决策 4：纯逻辑抽到 `logic.js`

- 采用：状态映射、格式化、排序过滤、错误文案、隐私判定全部放纯函数文件，组件只调它。
- 理由：无 DOM 环境下也能单测（R-09），避免为测试引入 jsdom。

### 决策 5：页面只读展示，不做编辑

- 采用：本版不支持删除/改名/说话人重命名。
- 理由：这些动作要碰数据模型与权限，属另一批需求；先保证「看得见、能发起」。

## 风险与规避

| 风险 | 规避 |
|---|---|
| 插槽能力与假设不符 | T-01 先做最小探针（一个 label + 一个按钮）验证两个插槽都能挂载；不符则退为「只做 settings.section」并回改本文件 |
| 页面看不到（L-10 挂载问题） | 装进 desktop profile 后**必须新开会话**验证；若仍看不到，先查 `apply` 是否执行（探针：启动日志）再改代码 |
| esbuild 装不上 | 退到 `npx esbuild` 或离线 wheel 式下载二进制；产物仍可手工构建 |
| 构建产物与源码不一致 | verify 里做「重建 + diff"，不一致即失败（R-08） |
| 550 段正文卡顿 | 默认只渲染前 100 段 + 展开更多；轮询只更新状态字段不重渲染正文 |
| 轮询打爆服务 | 2s 间隔 + 页面不可见暂停 + 30 分钟上限 |
| 路径穿越 | 路由只收 `id`，内部拼路径前用白名单正则校验 |

## 依赖与前置

- 新增 devDependency：`esbuild`（唯一）
- 运行时 peer：`react` / `react-dom`（宿主提供，打包时 external）
- `package.json` 新增：`dsh.client.{platform:'web', inject:[...]}` 与 `exports["./client"]`
- 需要你配合的验证：把插件装进 `desktop` profile 并**新开会话**（页面在设置区可见）
