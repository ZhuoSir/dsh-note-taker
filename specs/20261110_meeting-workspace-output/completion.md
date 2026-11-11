# 完成清单: meeting-workspace-output（spec v1.0.0）

> 生成: 2026-11-10 | 补验: 2026-11-11

## ✅ 已完成（8/8）

| 任务 | 验证证据 | commit |
|---|---|---|
| T-01 workspace 探针 | 真实宿主：`workspace 服务就绪, available=true, workspaces=29`；health 返回 `{available:true, workspaces:29, resolver:true}`；本地 2 用例覆盖命中/未命中/不可用 | `7d1b08a`、`14338c0` |
| T-02 产物路径与单文件 | 7 用例（workspace/fallback 路径、元信息、纪要合并、**转写逐字不变**） | `d12d254` |
| T-03 service 接产物解析 | 7 用例（工作区单文件、回落旧行为、resolver 抛错降级、minutes 写回单文件） | `366335b`、`b033b08` |
| T-04 路由透传 sessionId | 6 用例（transcribe/detail/minutes 透传、不传等价旧行为、非法 sessionId 拒绝） | `366335b` |
| T-05 客户端带 sessionId | 1 用例（仅在该传的地方出现） | `b5915a8` |
| T-06 交接改引用文件 | 6 用例（只给路径与指令、长度与转写无关、回落给绝对路径、无路径退化为内联） | `b5915a8` |
| T-07 卡片接线 | 渲染用例断言显示「产物：meetings/<id>.md（工作区）」；实测卡片显示产物位置 | `b5915a8` |
| T-08 端到端 | **用户 2026-11-11 实机验证通过**：导入后产物落在会话工作区 `meetings/<id>.md`，agent 读到该文件并把纪要写回「## 纪要」段 | — |

## 补验说明

**T-08 原记为「未在用户侧走完一轮」**：识别后卡片已显示产物位置、交接消息已改为引用路径，
但「agent 打开文件并回写纪要」未在真实会话中验证。2026-11-11 用户实机验证通过后解除。

## 关键技术结论（探针）

```
super(ctx, "workspaceRegistry")   ← 宿主注册名不是 workspace
workspaceRegistry.list() → [{ id, path, sessionIds }]
按 sessionIds.includes(sessionId) 命中 → 取 path
```

第一次注错成 `workspace` 导致 `available=false`；改名后真实宿主立刻返回 `available=true, workspaces=29`。

## 过程记录

| # | 问题 | 真因 | 修复 |
|---|---|---|---|
| 1 | 探针 available=false | 服务注册名是 `workspaceRegistry`，我注成 `workspace` | `14338c0` |
| 2 | 设置页历史纪要显示 0 | agent 直接写文件，`status.minutes` 一直是 pending，而列表按状态过滤 | `b033b08`（按文件判断 + 状态自愈） |
| 3 | PowerShell 写回 JSX 吃掉模板字符串 | `-replace` 把反引号当转义符 | 改用编辑工具（复发 ×3，见 lessons 待补） |

## 遗留与风险

1. **分支依赖**：`meeting-agent-import` 依赖本 spec 的产物能力，已通过先合并本 spec 解决。
2. **会议记录新增 `product` 字段**：产物位置持久化，便于设置页无 sessionId 时也能读到。
