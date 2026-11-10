> 版本: v1.0.0 | 状态: 已确认 | 更新: 2026-11-10 | 确认人: 陈卓 | 确认日期: 2026-11-10

# 技术方案：meeting-workspace-output

## 坑核对（门控节，确认②先审这一节）

核对了 `specs/_project/lessons.md` 的 13 条（L-04 休眠、L-11 退休不计），相交 3 条：

| 坑 | 相交 | 本方案如何避开 |
|---|---|---|
| L-09 环境结论会失效 | **是** | 「宿主能给出会话工作目录」目前只是从 `dsh-workspace` 声明读到的**候选**（`Workspace.sessionIds` + `Workspace.path`），不是已证事实 → T-01 探针先验证，并内置回落 |
| L-10 headless 不挂载插件 | **是** | 产物路径依赖真实会话；验证只能在真实宿主里做，单测用注入的 resolver 覆盖 |
| L-13 宿主契约随版本变 | **是** | 不新增工具；只加路由参数与一个可选注入，失败即回落，不赌宿主行为 |
| 其余 | 否 | 不碰 Python/模型/录音设备/云端协议 |

## 关键前提与探针（T-01）

需要「给定 sessionId → 会话工作目录」。候选路径（宿主侧）：

```js
// 宿主插件 apply 里（可选注入，拿不到就不启用）
ctx.inject(['workspace'], (inner) => {
  const service = inner.workspace
  // Workspace 上有 path 与 sessionIds
  const ws = service.list().find((item) => item.sessionIds.includes(sessionId))
  const dir = ws?.path          // canonical 目录
})
```

依据：`dsh-workspace` 的 `Workspace` 接口暴露 `path`（canonical 目录）与 `readonly sessionIds: readonly SessionId[]`；
注册表另有内部 `sessionPath(id)`（`WorkspaceEntityHost`）。**探针要回答：宿主插件上下文里 `workspace` 服务能否注入、
`list()` 的 `sessionIds` 是否真的包含当前会话。**

若探针失败 → 退化为「设置页手填输出目录」（配置项 `asr.outputDir`），产品形态不变，只是路径来源换成配置。

## 方案概述

```
lib/output.js        产物布局与单文件结构（纯函数 + 可注入 IO，可单测）
lib/service.js       接收 sessionId，经 outputResolver 定位目录；转写/纪要写入该目录
lib/index.js         用 workspace 服务实现 outputResolver（可选注入，失败返回 null）
lib/routes.js        transcribe / detail / minutes 增加 sessionId 透传
src/client/          卡片与页面带上 sessionId；交接消息改为引用文件路径
```

## 产物布局

**正常路径（会话有工作区）**

```
<工作区>/meetings/<会议id>.md        ← 单文件：元信息 + 转写 + 纪要
```

**回落路径（拿不到工作区 / 写入失败）**

```
<数据目录>/meetings/<会议id>.md      ← 与上面同样的结构
```

**始终保留在数据目录的元数据**

```
<数据目录>/transcripts/<会议id>.json    ← segments 与 stats
```

理由：R-04 只要求「不出现两份不同内容的 md」；JSON 是插件自己的索引，放数据目录更稳定（工作区可能被用户删改）。

## 单文件结构

```markdown
# <会议id> · <标签或时间>

- 开始：2026-11-10 16:26
- 时长：47:06
- 引擎：cloud（qwen-audio-3.1-asr-flash）
- 段数 / 字数：551 / 15613

## 转写

[00:00:00] 那这个里面变更的时候…
[00:00:09] 但是现在还有一个好处…

## 纪要

（由会话生成后回写；重新生成时只替换本节）
```

**合并规则（R-02）**：写纪要及时只替换最后一个 `## 纪要` 之后的内容，`## 转写` 段落逐字保留；
文件里始终只有一个 `## 纪要` 段。

## 接口变更

| 路由 | 变更 |
|---|---|
| `POST /note-taker/transcribe` | body 增加 `sessionId`（可选）；响应增加 `outputPath` 与 `outputMode: 'workspace' \| 'fallback'` |
| `GET /note-taker/detail` | 查询串增加 `sessionId`（可选）：定位工作区产物；找不到回落数据目录 |
| `POST /note-taker/minutes` | body 增加 `sessionId`；纪要写回同一文件 |

既有 9 条路由的路径不变；新参数可选，**不传时行为与改造前一致**（回落数据目录）。

## 会话交接（R-03）

消息从「贴全文」改为：

```
【会记】会议 20261110-1626-3d64（周会，47:06）
产物文件：`meetings/20261110-1626-3d64.md`
请读取该文件，生成会议纪要并写入同一文件的「## 纪要」一节。
```

回落时路径换成绝对路径（agent 直接可开）。

## 共享面身份矩阵

| 对象 | 身份（方法 × 调用方） | 变更后预期行为 | 断言归属 |
|---|---|---|---|
| `<工作区>/meetings/<id>.md` | 文件 × agent 读 + 插件写 | 结构固定、纪要可覆盖、转写不丢 | T-03、T-06 |
| `<数据目录>/meetings/<id>.md` | 文件 × 回落场景 | 与上面结构完全一致 | T-03、T-05 |
| `transcripts/<id>.json` | 文件 × 插件列表统计 | 位置与格式不变 | T-04 回归 |
| `POST /transcribe` 的 `sessionId` | 参数 × 卡片/页面 | 不传等价于旧行为 | T-05 |
| 交接消息 | 文本 × 会话 agent | 只含路径与指令，< 500 字 | T-07 |
| `meeting_*` 工具 | Agent 调用 | 行为不变，返回路径指向实际产物 | T-04 回归 |

6 个身份都有断言。

## 关键日志点清单

| 场景 | 级别 | 触发点 | 必带字段 | 注意 |
|---|---|---|---|---|
| 工作区解析 | INFO | outputResolver 返回 | sessionId、mode（workspace/fallback）、目录 | 目录不敏感，可记 |
| 解析失败回落 | WARN | resolver 返回 null | sessionId、原因 | — |
| 产物写入 | INFO | 写 md 后 | meetingId、mode、字节数 | 不记正文 |
| 纪要合并 | INFO | 合并后 | meetingId、是否首次、旧节长度 | — |
| 写入失败 | ERROR | 捕获异常 | 目标路径、code | 不产生半截文件 |

## 关键决策

### 决策 1：用 workspace 服务解析目录（而非让用户手填）

- 采用：`workspace.list()` 找 `sessionIds` 命中的工作区，取其 `path`。
- 理由：用户要「会话工作空间」，手填会出现「配错就写丢」。
- 被拒：直接读 `NOTE_TAKER_OUTPUT_DIR`。理由：与「当前会话」无关，回到割裂状态。
- 兜底：探针失败 → 设置页手填，写进退化路径，不静默。

### 决策 2：单文件承载转写 + 纪要

- 采用：一个 `<id>.md`，`## 转写` 与 `## 纪要` 两节。
- 理由：agent 一次读完有全部上下文；交接只给一条路径。
- 被拒：两份文件。理由：路径翻倍、agent 得读两次、易只读到一份。

### 决策 3：JSON 元数据留数据目录

- 采用：`transcripts/<id>.json` 不动。
- 理由：工作区是用户/agent 的地盘，可能被改动；插件索引需要稳定。

### 决策 4：参数可选、缺省回落

- 采用：`sessionId` 可选，缺失时行为与改造前一致。
- 理由：`meeting_*` 工具与既有调用方不传 sessionId，不能因此坏掉（R-04）。

## 风险与规避

| 风险 | 规避 |
|---|---|
| workspace 服务不可注入 / 不含当前会话 | T-01 探针；失败走手填目录的退化路径 |
| 工作区目录被删 | 写入前 `mkdir -p`；失败按 R-05 报错并保留 JSON |
| 纪要覆盖把转写吃掉 | 合并函数纯函数 + 「转写段落逐字不变」断言（T-03） |
| 同一会议被两个会话识别 | 后写覆盖并在日志 WARN，提示产物已迁移 |
| 路径含空格/中文 | 交接消息用反引号包裹路径 |
| 相对路径 agent 打不开 | 工作区模式给相对路径并附「工作区根：<path>」；回落模式给绝对路径 |

## 依赖与前置

- 无新增 npm 依赖
- 需要宿主：`workspace` 服务（T-01 验证）、`sessions`（上一 spec 已验证可用）
- 需要用户配合：真实宿主复验
