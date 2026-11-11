> 版本: v1.0.0 | 状态: 已确认 | 更新: 2026-11-10 | 确认人: 陈卓 | 确认日期: 2026-11-10

# 技术方案：meeting-agent-import

## 坑核对（门控节，确认②先审这一节）

核对了 `specs/_project/lessons.md` 的 13 条（L-04 休眠、L-11 退休不计），相交 2 条：

| 坑 | 相交 | 本方案如何避开 |
|---|---|---|
| L-13 宿主工具契约随版本变 | **是** | 新工具必须带 `{ type, schema, render }`；双版本兼容写法已沉淀在 `TEXT_OUTPUT`，直接复用，并在真实宿主确认「无 `entry did not activate`」 |
| L-09 环境结论会失效 | **是** | 「无扩展名能解码」用真实文件探针验证过（见下），不是从文档推断 |
| 其余 | 否 | 不碰模型下载、录音设备、云端协议、页面构建 |

## 探针结果（Phase 2 前已验）

```
python py/decode_pcm.py --audio .tmp/blob_noext --out .tmp/blob_noext.pcm
→ {"ok": true, "bytes": 1920000, "sampleRate": 16000, "durationSec": 60.0}
```

把 60 秒 wav **去掉扩展名**后，PyAV 仍按内容嗅探容器并解出 60 秒。
结论：**宿主附件的无后缀 blob 可以直接交给解码器**，不需要猜格式或补后缀。

## 方案概述

```
lib/import.js          纯函数：标签推导、扩展名后备、大小判定规则
lib/service.js         importAudio 扩展：上限、标签推导、可选自动转写、返回产物路径
lib/tools.js           新增 meeting_import 工具（复用 TEXT_OUTPUT）
```

导入本来就存在（`importAudio`），这次是补齐「上限、命名、自动转写、返回路径」四件事，并暴露成工具。

## 工具契约（agent 看到什么）

```js
{
  name: 'meeting_import',
  description: '导入一段已有音频（本地路径或附件路径，可以没有扩展名）并转写成文字。'
    + '返回会议 id、时长、段数，以及产物文件的绝对路径 outputFile——'
    + '纪要请直接读取该文件、把内容写进它的「## 纪要」一节。',
  parameters: {
    path: { type: 'string', description: '音频文件路径；宿主附件路径也可以，可无扩展名' },
    label: { type: 'string', description: '可选标签，缺省用文件名' },
    transcribe: { type: 'boolean', description: '是否导入后立即转写，缺省 true' },
  },
  output: TEXT_OUTPUT,
  timeoutMs: 45 * 60 * 1000,
}
```

**为什么单独给 `timeoutMs`**：默认超时撑不住长音频转写；超时会让 agent 以为失败并重试，叠加负载。

## 返回值

```js
{
  ok: true,
  meetingId, label, durationSec, audioPath,
  transcribed: true, segments, chars,
  outputPath: 'meetings/<id>.md',                 // 给人看（相对工作区）
  outputFile: 'D:/work/demo/meetings/<id>.md',    // 给工具用（绝对）
  outputMode: 'workspace' | 'fallback',
}
```

`outputFile` 是本 spec 的核心交付——agent 拿着它就能读写文件，不需要拼路径。

## 关键决策

### 决策 1：只接受路径，不做浏览器上传

- 采用：工具接收 `path`（本地路径或附件 blob 路径）。
- 理由：用户明确要「会话里上传/引用本地文件」；宿主已把附件落到本地，agent 有路径。
- 被拒：multipart 上传路由。理由：不做界面导入，传输层用不上；45 MB 大文件还要分块，成本高。

### 决策 2：`transcribe` 默认 true

- 采用：缺省自动转写。
- 理由：导入音频的目的就是转写；关掉是少数场景。
- 风险：只想导入时被意外消耗云端额度 → 描述里写明「缺省会立即转写」，返回值标记 `transcribed`。

### 决策 3：无后缀落盘用 `.bin`

- 采用：无扩展名保存为 `<id>.bin`，解码靠内容嗅探（已验）。
- 被拒：按魔数猜后缀。理由：多写一段代码做同一件事，收益为零。

### 决策 4：大小上限 500 MB，超限直接拒

- 采用：`statSync().size > 500MB` → `E_AUDIO`，错误带实际大小。
- 理由：避免拖垮磁盘与解码；截断会引出更诡异的问题。

### 决策 5：标签推导 = 文件名（去后缀），不可用时用时间

- 采用：`deriveLabel()` 纯函数。
- 理由：拖进来的文件名通常就是会议名；无意义名字也不至于让列表空着。

### 决策 6：转写失败不回滚导入

- 采用：导入成功即返回 `transcribed: false` + 原因，会议保留。
- 理由：音频已安全落盘，重跑转写廉价；整体失败会让用户以为文件没进来。

## 共享面身份矩阵

| 对象 | 身份（方法 × 调用方） | 变更后预期行为 | 断言归属 |
|---|---|---|---|
| `meeting_import` 工具 | Agent 调用 | 返回 ok/字段齐全；失败给可读原因 | T-03、T-05 |
| `service.importAudio` | 工具 + 既有路由 `/import` | 新增上限与自动转写；路由调用时不转写（保持旧行为） | T-02 回归 |
| `outputFile` | Agent 读 + 写 | 绝对路径、文件存在、含 `## 转写` | T-04、T-05 |
| `POST /note-taker/import` | 既有调用方 | 行为不变（不自动转写） | T-02 回归 |
| 既有 6 个工具 | Agent 调用 | 不变 | T-02 回归 |

5 个身份都有断言。

## 关键日志点清单

| 场景 | 级别 | 触发点 | 必带字段 | 注意 |
|---|---|---|---|---|
| 导入请求 | INFO | 工具入口 | path 尾段、大小、label | 不记完整路径（可能含用户名） |
| 导入成功 | INFO | 拷贝+解码后 | meetingId、durationSec、bytes | — |
| 自动转写分派 | INFO | 转写前 | meetingId、engine | — |
| 导入失败 | WARN | 校验失败 | reason、字段 | 不建会议 |
| 转写失败（导入成功） | WARN | 转写返回 | meetingId、code、reason | 明确「音频已保存」 |
| 大小超限 | WARN | 校验 | bytes、limit | — |

## 风险与规避

| 风险 | 规避 |
|---|---|
| agent 拿到的「附件路径」不是真实文件 | 工具先 `statSync`；不存在时提示「请确认是文件路径而不是附件 id」 |
| 47 分钟音频转写超工具默认超时 | `timeoutMs: 45min`，描述里说明会等待 |
| 用户误以为导入会自动出纪要 | 返回值带 `transcribed` 与 `outputFile`，描述写明纪要需自己写进 `## 纪要` |
| 非音频被当音频 | 解码失败给「不是可识别的音频」，不创建 0 秒会议 |
| 无后缀文件难辨认 | 原始文件名保留在会议 label 里 |

## 依赖与前置

- 无新增 npm 依赖
- 已具备：产物单文件与工作区落点（上一 spec）、`TEXT_OUTPUT` 双版本工具契约
- 需要用户配合：装进 profile 后新开会话验证工具可见
