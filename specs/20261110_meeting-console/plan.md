> 版本: v0.1.0 | 状态: 已确认 | 更新: 2026-11-10 | 确认人: 陈卓 | 确认日期: 2026-11-10

# 技术方案：meeting-console

## 坑核对（门控节，确认②先审这一节）

核对了 `specs/_project/lessons.md` 的 13 条（L-04 休眠、L-11 退休不计），相交 3 条：

| 坑 | 相交 | 本方案如何避开 |
|---|---|---|
| L-09 环境结论会失效 | **是** | 「宿主提供 `conversation.send`」只是从包源码读到的**候选**，不是已证事实 → T-01 探针先验证，方案内置兜底路径 |
| L-10 headless 不挂载插件 | **是** | 配置写入后要能验证生效；验收只在真实宿主（web/desktop）里做，headless 只跑单测 |
| L-13 宿主契约随版本变 | **是** | 不新增工具，避免再碰 `output` 契约；新增能力全走 HTTP 路由 + 客户端插槽 |
| L-01/02/03/05/06/07/08/12 | 否 | 不碰 Python 依赖、不碰 HF、不碰录音设备、不碰云端协议 |

## 方案概述

四层，互不牵连：

```
lib/settings.js     配置读写与优先级（纯函数为主，可单测）
lib/service.js      改为「每次请求解析配置」→ 热生效
lib/routes.js       新增配置读写两条路由（共 9 条）
src/client/         SettingsPage（配置 + 历史纪要）、QuickPanel（录音→确认→交接）
src/client/handoff.js  交接消息构造（纯函数）
```

## 配置存储与优先级

**位置**：`<数据目录>/config.json`

```json
{
  "version": 1,
  "asr": { "engine": "cloud", "localModel": "small", "chunkSeconds": 300 },
  "cloud": { "apiKey": "sk-…", "endpoint": "https://…", "model": "qwen-audio-3.1-asr-flash" },
  "dataRoot": "D:\\workspace\\my_workspace\\dsh-note-taker\\.tmp\\cloud-e2e"
}
```

**优先级**：页面保存的 `config.json` > 环境变量 > 内置默认（R-02）

⚠️ **这里有个陷阱**：数据目录本身写在 `config.json` 里，但读 `config.json` 又需要知道数据目录——
所以「定位数据目录」只认 `NOTE_TAKER_DATA` 环境变量与默认路径（`~/.dsh/note-taker`），
`config.json` 里的 `dataRoot` 只用于**下次启动**生效并在页面上提示「需重启」。

**热生效边界**（R-02）：

| 字段 | 生效方式 |
|---|---|
| `cloud.apiKey` / `endpoint` / `model` | 每次请求重新读 → 立即生效 |
| `asr.engine` / `localModel` / `chunkSeconds` | 同上 → 立即生效 |
| `dataRoot` | 需重启（service 实例的 root 在创建时固定） |

**掩码**：`maskKey('sk-1234567890abcdef') === 'sk-…cdef'`；长度 < 8 时显示 `••••`。
**明文 Key 只进配置文件与请求头，不进任何响应与日志**（R-08）。

## 接口设计

在现有 7 条基础上新增 2 条，仍全部 `kind: 'exact'`：

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| GET | `/note-taker/config` | — | `{ok, config:{asr,cloud:{apiKeyMasked,endpoint,model},dataRoot}, envOverrides:{...}, restartRequired:[...]}` |
| POST | `/note-taker/config` | `{asr?, cloud?, dataRoot?}` | `{ok, saved:[...], ignored:[...], restartRequired:[]}` |

既有 7 条不变（`list` / `detail` / `health` / `transcribe` / `minutes` / `record` / `import`）。
历史纪要列表**复用** `list` + `detail`，页面侧按「有纪要」过滤（不新增路由）。

## 客户端结构

```
SettingsPage（settings.section）
  ├─ ConfigForm      读 /config → 表单 → 保存 → 校验错误就地显示（R-01）
  └─ MinutesList     读 /list（过滤 minutes=done）→ 点开 /detail 显示纪要正文（R-04）

QuickPanel（conversation.input.right）
  ├─ 录音控制        开始/停止 + 计时（复用 /record）
  ├─ 识别与确认      自动 /transcribe → 轮询状态 → 转写进 textarea（可编辑）（R-05）
  └─ 交接            buildHandoffMessage() → conversation.send() 或填入输入框（R-06）
```

## 会话交接（R-06）

**主路径**：客户端插件通过可选注入拿到 `conversation` 服务，调 `send(text)`。

**兜底路径**：拿不到时，把同样文本放进输入框并显示「宿主不支持自动发送，文本已填入输入框，请手动发送」。

**交接消息构造**（纯函数，可单测）：

```
【会记】会议 20261110-1530-abcd（周会，47:06）
请据此生成会议纪要：按背景/讨论要点/决议/行动项（负责人+截止）组织，写入 minutes/<id>.md。

<确认后的转写正文>
```

设计取舍：把会议 id 与标签写进消息，是为了让 agent 能调 `meeting_minutes` 找到同一场会议，
不必让用户在对话里再解释是哪一场。

## 共享面身份矩阵

| 对象 | 身份（方法 × 调用方） | 变更后预期行为 | 断言归属 |
|---|---|---|---|
| `/note-taker/config` GET | 页面配置表单 | 返回掩码 Key 与生效来源，**不含明文** | T-04、T-06 |
| `/note-taker/config` POST | 页面保存 | 白名单过滤、非法值拒绝并指名字段 | T-04 |
| `config.json` | 本插件（唯一写者） | 原子写、含 version 字段、权限尽力收窄 | T-03 |
| `service` 配置解析 | 转写/纪要/导入 | 页面配置优先生效，未配置时行为与改造前一致 | T-05、T-08 |
| `conversation.send` | 卡片交接 | 可用→发消息；不可用→填入输入框并提示 | T-07、T-09 |
| 既有 7 条路由 | 页面/工具 | 行为不变 | T-05 回归 |

矩阵外身份 = 未评估。上表 6 个身份都有断言。

## 关键日志点清单

| 场景 | 级别 | 触发点 | 必带字段 | 注意 |
|---|---|---|---|---|
| 配置读取 | INFO | GET /config | 生效来源（page/env/default）、哪些字段被覆盖 | 不含 Key |
| 配置保存 | INFO | POST /config | saved 字段名、ignored 键名 | 不含 Key 值 |
| 配置校验失败 | WARN | POST /config | 字段名、原因 | 值截断 30 字，Key 字段只记「格式不合法」 |
| 配置写入失败 | ERROR | settings.save | code、路径 | 不含内容 |
| 交接发送 | INFO | 客户端（浏览器控制台） | 会议 id、正文字数、路径（send/fallback） | 不记正文 |
| 交接失败 | WARN | 客户端 | code、原因 | — |

## 关键决策

### 决策 1：配置写文件 + 每次请求重新解析（而非改环境变量）

- 采用：`config.json` 持久化，`resolveEffectiveConfig()` 每次调用合并。
- 理由：环境变量改不了进程，页面没法让用户「改完立即生效」；文件 + 重解析最简单。
- 被拒：只读环境变量。理由：用户明确要「在页面里配」。
- 被拒：写进 profile 的 package.json。理由：那属于宿主配置，插件不该改。

### 决策 2：数据目录仍由环境变量/默认决定

- 采用：`config.json` 里的 `dataRoot` 只影响**下次启动**，页面明确标注「需重启」。
- 理由：service 的 root 在创建时固定，运行中换目录会让已有会议「消失」，比不给改更糟。
- 被拒：运行中切换。理由：状态一致性风险高，收益低。

### 决策 3：交接走客户端 `conversation.send`，带兜底

- 采用：可选注入 `conversation`；拿不到就填入输入框（DOM 输入框定位需实测，**若也拿不到就只提供「复制文本」**）。
- 理由：R-06 要求自动发送，但不能赌宿主一定有这个口。
- 被拒：服务端直接调 LLM 生成纪要（现状）。理由：用户要「交给会话」，纪要该在对话里可见可追问。

### 决策 4：历史纪要只读，不新增路由

- 采用：复用 `list` + `detail`，页面按 `minutes === 'done'` 过滤。
- 理由：`list` 已返回状态，`detail` 已返回正文，再加路由是重复。

### 决策 5：转写确认区允许编辑，但不回写原文件

- 采用：编辑只影响交接文本；`transcripts/<id>.md` 保持原文。
- 理由：原始转写是事实记录，纪要可以基于润色后的文本，两者不必一致；回写会污染留档。

## 风险与规避

| 风险 | 规避 |
|---|---|
| `conversation.send` 在插件上下文不可用 | T-01 探针先验；兜底三档（自动发送 → 填入输入框 → 复制文本），且界面始终说明当前用的是哪一档 |
| 输入框 DOM 定位不稳（宿主改版即失效） | 只在兜底路径使用，且加 `try/catch`；失败退到复制文本 |
| 配置里存明文 Key | 文件权限尽力收窄 + 文档写明「本机明文存储」；接口只回掩码（R-08） |
| 热生效被误认为「改了就一定生效」 | 页面标注「需重启」项；保存后立即用 `/health` 复验并回显实际生效值 |
| 改配置把插件改坏（如非法 endpoint） | 保存前校验 URL 与数值范围；非法直接拒绝，不落盘 |
| 会话消息过长（47 分钟转写 ~15k 字） | 交接时若超过 8000 字，先发摘要消息 + 提示「全文见 transcripts/<id>.md」，让 agent 自行读文件 |

## 依赖与前置

- 无新增 npm 依赖
- 需要宿主提供：`conversation` 服务（T-01 验证）、`slots`（已验证）
- 需要用户配合：装进 profile 后**新开会话**验证（L-10）
