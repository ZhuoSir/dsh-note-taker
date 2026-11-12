# 技术方案：fix-handoff-delivery

> 版本: v1.0.0 | 状态: 已确认 | 更新: 2026-11-12 | 确认人: 陈卓 | 确认日期: 2026-11-12
> 需求: `requirements.md` v0.1.0（已确认）
> 缺陷: BUG-05

## 坑核对

已核对 `specs/_project/lessons.md` 全部 active 坑，与本次方案相交的三条：

- **L-38（组件状态不是持久化）**：本方案不引入任何新的界面状态，交付内容由服务端返回的事实
  组装，避开。
- **L-35（zstd 多帧）**：诊断阶段用到会话存储解码，本次不改那条链路，避开。
- **L-30 类（相对路径跨工作区失效）**：正是本次要修的坑本身——方案改为「绝对路径 + 存在性
  自证」，并把该坑的防再犯规则落到 R-01/R-03。

## 一、方案概述

问题不在产物，在**交付描述**。产物文件一直存在、内容完整，但消息只给相对路径，
或直接把长正文截断。方案三句话：

1. **服务端把绝对路径与文件大小一起交出去**（`detail` 增加三字段），让客户端不必猜；
2. **消息模板改为「绝对路径优先 + 相对路径备查 + 字数/字节数交代」**，删掉 800 字截断；
3. **组装前自证**：产物存在 → 走文件；产物无但旧转写文件存在 → 走旧转写；
   两者都无 → 明确报「无内容可交付」，不发明摘要。

## 二、数据流

```
QuickPanel.generateMinutes(row)
  → GET /detail?id=<id>
       ← { outputAbs, outputRelative, outputBytes, transcriptAbs, transcriptChars }
  → buildHandoffMessage({ outputAbs, outputRelative, outputBytes, transcriptAbs, transcriptChars, transcript })
       ├─ 有 outputAbs        → mode='file'      （绝对路径 + 相对路径 + N 字节 + 转写 M 字）
       ├─ 无 outputAbs 有 transcriptAbs → mode='legacy'（旧转写文件绝对路径）
       └─ 都无                → mode='inline'    （转写 ≤8000 字内联；>8000 字报错，不截断）
  → deliver(text)
```

## 三、接口变更（`GET /note-taker/detail`，只增字段）

| 字段 | 类型 | 含义 |
|---|---|---|
| `outputAbs` | string \| null | 产物文件的绝对路径（存在时） |
| `outputRelative` | string \| null | 产物相对工作区路径（`meetings/<id>.md`） |
| `outputBytes` | number | 产物文件字节数，缺失为 0 |
| `transcriptAbs` | string \| null | 旧转写文件 `transcripts/<id>.md` 的绝对路径（存在时） |
| `transcriptChars` | number | 交付用转写的字数 |

既有字段（`transcript` / `minutes` / `outputPath` / `outputMode` / `workspaceRoot`）语义不变，
旧客户端不受影响——这是**只增不改**的兼容变更。

## 四、消息模板（新）

有产物时：

```
【会记】会议 <id>（<标签>，<时长>）
产物文件（绝对路径）：`D:\...\meetings\<id>.md`
相对路径：`meetings/<id>.md`  工作区根：`D:\...`
该文件 <M> 字节，含 `## 转写`（<N> 字）与 `## 纪要` 两节。
请直接读取上面的绝对路径，生成会议纪要并写入同一文件的 `## 纪要` 一节；结构要求：…
信息不足处标注「待确认」，不要编造。
```

仅旧转写时：同上，但路径指向 `transcripts/<id>.md`，并说明「该文件只有转写，
纪要请另存并回填」。

## 五、被拒绝的替代方案

| 方案 | 拒绝理由 |
|---|---|
| 无脑内联全文（不截断） | 65 分钟会议 3 万字，塞进对话费 token、易被截断，且丢失 `## 转写` 结构；产物文件本来就在磁盘上 |
| 提升内联上限到 5 万字 | 只是把阈值推远，问题性质不变；长会议照样超 |
| 让 agent 自己「猜」路径 | 不可靠，跨工作区必失败；本次要修的就是这个假设 |
| 另立新 spec | 缺陷原因单点（消息组装），走 fix spec 足够；跨模块才值得另立 |

## 六、风险与规避

| 风险 | 规避 |
|---|---|
| 旧客户端收到新字段但不用 | 只增字段，无破坏；旧逻辑仍按 `outputPath` 工作 |
| 绝对路径过长影响阅读 | 绝对路径与相对路径并列，指令指向绝对路径 |
| 产物文件被外部删除 | `outputAbs` 仅在文件存在时返回；不存在则回落旧转写或明确报错 |
| 消息模板改动影响确认区交接 | 确认区与历史行共用同一 `buildHandoffMessage`，两边同步受益，测试需覆盖两处 |