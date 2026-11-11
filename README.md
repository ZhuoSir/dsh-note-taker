# 会记 · dsh-note-taker

[![dsh-plugin](https://img.shields.io/badge/DSH-plugin-4f8cff)](https://github.com/ZhuoSir/dsh-note-taker)
[![node](https://img.shields.io/badge/node-%E2%89%A520-3c873a)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

> DeepSeek Harness 插件：**录音 → 转写 → 会议纪要**。
> 转写支持本机 faster-whisper 与阿里云百炼（含说话人分离）两条路；纪要在会话里生成，
> 产物直接落在**当前会话的工作区**，agent 读得到、你能改得动。

<!-- 说明：本 README 只写实测过的能力；未验证的部分统一放在「已知限制」。 -->

## 它解决什么问题

开完会，录音在手机里、转写在某个网站里、纪要在另一份文档里——最后还得手工粘一遍。

会记把它收进 DSH：**边开会边录，散会点一下，转写出来、你扫一眼改错字、交给会话，纪要就写进你项目的 `meetings/` 目录。**

关键是三件事都发生在你能控制的地方：

| 环节 | 在哪 |
|---|---|
| 录音 | 本机麦克风，落盘到数据目录 |
| 转写 | 本机 faster-whisper（离线）或阿里云百炼（联网） |
| 纪要 | **你当前的会话**，由你在 DSH 里配置的模型生成 |

## 功能

- **双转写引擎**：本机 faster-whisper（离线、免费）／阿里云百炼 `qwen-audio-3.1-asr-flash`（联网、更准、支持说话人分离）
- **说话人分离**：云端引擎可输出 `S0 / S1`，产物里带标签
- **会话内驱动**：丢一段音频给 agent，说「整理成纪要」，剩下它自己走
- **产物单文件**：`meetings/<id>.md` 里同时有元信息、`## 转写`、`## 纪要`，agent 读写同一份
- **配置页**：模型、Key、接口地址、数据目录、引擎选择都在设置里，改完热生效
- **长音频分片**：47 分钟会议按 5 分钟切片串行识别，失败自动重试一次
- **不静默失败**：错误信息透传服务端原文，不把「路由 500」敷衍成「识别失败」

## 安装

要求：Node ≥ 20、Python ≥ 3.10（本机转写才需要），以及一个可用的 DSH profile。

```powershell
# 装进某个 profile（profile 名按你自己的来）
dsh plugin --profile web add D:\path\to\dsh-note-taker

# 重启宿主，让插件激活（工具与页面要重启才生效）
dsh web --port 8099 --no-open
```

安装后确认两处：

1. **设置 → 会记**：能打开，看到「配置 / 历史纪要」两个 tab
2. **会话输入框右侧**：有「会记」按钮

> 桌面版（Electron）的 `desktop` profile 由应用独占，CLI 不能改；请在应用内安装或使用可 CLI 管理的 profile。

## 快速开始

### 方式一：在会话里导入音频（推荐）

把音频路径给 agent，直接说：

```
导入 D:\会议\周会.m4a 并整理成纪要
```

agent 会调 `meeting_import`，你拿到的是产物文件路径，它自己读文件、写纪要。

### 方式二：录音

会话输入框右侧「会记」→ 开始录音 → 停止 → 等识别 → **检查转写、改错字** → 「交给会话生成纪要」。

确认这一步是有意留的：语音识别一定有错字，让机器直接写纪要，错的地方会一路错到底。

## 工具

插件向 agent 暴露 7 个工具：

| 工具 | 作用 | 关键点 |
|---|---|---|
| `meeting_import` | 导入音频并转写 | 接受本地路径或附件路径，**可无扩展名**；返回 `outputFile` 绝对路径 |
| `meeting_transcribe` | 对已有会议重跑转写 | 可指定引擎 / 本机档位 |
| `meeting_minutes` | 生成纪要（插件侧调模型） | 结构不合格不落盘 |
| `meeting_record_start` / `meeting_record_stop` | 录音起停 | 落盘 16 kHz 单声道 |
| `meeting_list` / `meeting_status` | 查看会议与状态 | — |

`meeting_import` 的返回示例：

```json
{
  "ok": true,
  "meetingId": "20261110-1725-d532",
  "label": "XXX 会议",
  "durationSec": 2826.52,
  "transcribed": true,
  "segments": 507,
  "chars": 16597,
  "outputPath": "meetings/20261110-1725-d532.md",
  "outputFile": "D:/work/demo/meetings/20261110-1725-d532.md",
  "outputMode": "workspace"
}
```

`outputFile` 是给工具用的绝对路径；`outputPath` 是给人看的相对路径。

## 页面

### 设置 → 会记

**配置 tab**：默认引擎（本地/云端）、本地模型档位、分片秒数、云端 API Key（只回掩码）、接口地址、云端模型名、数据目录（注明需重启）。

保存后立即生效（下次请求就读取新配置），并在提示里回显实际生效值。

**历史纪要 tab**：只列**有纪要**的会议，点开看正文。

### 会话输入框旁的卡片

```
会记                        云端可用 · qwen-audio-3.1-asr-flash
[开始录音]                                    [刷新]
识别中… 已等待 0:12
[ 11-10 16:26          ]  0:42        ← 会议名可就地改，空着显示时间
产物：meetings/20261110-1626-3d64.md（工作区）
┌──────────────────────────────┐
│ 识别结果（可改错字）· 674 字    │
│ [可编辑的转写文本]              │
│ [交给会话生成纪要] [重新录]      │
└──────────────────────────────┘
```

## 配置

配置文件：`<数据目录>/config.json`。优先级：**页面保存的配置 > 环境变量 > 内置默认**。

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `NOTE_TAKER_DATA` | `~/.dsh/note-taker` | 数据目录（改这里才需重启；页面里的改动下次启动生效） |
| `NOTE_TAKER_ASR_ENGINE` | `local` | 默认引擎 |
| `NOTE_TAKER_MODEL` | `small` | 本机模型档位 `tiny/base/small/medium` |
| `DASHSCOPE_API_KEY` | — | 云端 Key（也可在页面里填） |
| `NOTE_TAKER_CLOUD_ASR_URL` | DashScope 公共地址 | 业务空间专属域名改这里 |
| `NOTE_TAKER_CLOUD_ASR_MODEL` | `qwen-audio-3.1-asr-flash` | 支持说话人分离的型号 |
| `NOTE_TAKER_ASR_TERMS` | — | 领域词表（与分人互斥，见下） |
| `NOTE_TAKER_ASR_DIARIZATION` | 关 | 设 `1` 开启说话人分离 |
| `NOTE_TAKER_ASR_CHUNK_SECONDS` | `300` | 长音频分片秒数 |
| `NOTE_TAKER_MODEL_DIR` | `<数据目录>/models` | 本机模型目录 |

### 说话人分离的两个事实

1. **只有 `qwen-audio-3.1-asr-flash` 支持**。`3.0` 会静默忽略该参数（`speaker_id` 恒为 `null`）。
2. **与词表上下文互斥**：开启分人时不再发送 `input_text` 词表——实测带着词表请求，`speaker_id` 会全部退化成 `-1`。代码里以分人优先。

## 产物与数据

```
<会话工作区>/meetings/<id>.md        ← 单文件：元信息 + ## 转写 + ## 纪要（正常路径）
<数据目录>/meetings/<id>.md          ← 回落路径（拿不到会话工作区时）
<数据目录>/transcripts/<id>.json     ← 段与统计（插件索引，始终在数据目录）
<数据目录>/recordings/<id>.<ext>     ← 音频
<数据目录>/config.json               ← 页面保存的配置
```

单文件结构：

```markdown
# 20261110-1626-3d64 · 周会

- 开始：2026-11-10 16:26
- 时长：47:06
- 引擎：cloud（qwen-audio-3.1-asr-flash）
- 段数 / 字数：551 / 15613

## 转写

[00:00:00] 那这个里面变更的时候…
[00:00:09] 但是现在还有一个好处…

## 纪要

（由会话生成后回写；重新生成只替换本节，转写逐字保留）
```

> `meetings/`、`*.wav`、`*.m4a`、`*.tmp` 都在 `.gitignore` 里——会议内容不进版本控制。

## 实测数据

同一台机器、同一份 47 分钟现场录音（`2026-11-10`）：

| 指标 | 本机 `small` | 云端正线 |
|---|---|---|
| 段数 / 字数 | 903 / 8141 | 551 / 15613 |
| 耗时 | 540 s | 312 s |
| 相对实时比 | 0.19 | 0.11 |
| 术语准确度 | 错字较多（决议→绝议） | 基本正确 |
| 联网 | 不需要 | 需要（音频上传） |

2 分钟样本的质量对照：

```
本机：这个里面的变更的时候可能会需要用啥样的 比如说 我们战队是行业的 把它给限量化
云端：这个里面变更的时候可能需要大量的，比如说我们针对行业的把它给现场化，或者说把它变成流程化的这么一个方式
```

## 开发

```powershell
npm install                # 只有 esbuild 一个开发依赖
npm run build:client       # 构建浏览器侧产物 lib/client.js
npm run verify             # 结构清单 + 构建可重复校验 + 全部单测
npm test                   # 只跑单测
```

### 结构

```
lib/            宿主侧（Node ESM）——工具注册、状态机、路由、产物落盘
src/client/     浏览器侧（React）——设置页与卡片，esbuild 打成一个文件
py/             Python sidecar——录音、解码、faster-whisper 转写
tests/          单测（node --test）
specs/          需求 / 方案 / 任务 / 台账（四阶段 spec 流程）
releases/       里程碑
docs/           方案与设计文档
```

两侧契约只有「文件路径 + 一行 JSON」，不共享内存、不互相 import。

### 浏览器侧产物是特殊格式

DSH 的 web 壳不用原生 ESM 加载客户端插件，而是：

```js
window.__ModuleLoader__.load({ id: 'dsh-note-taker', factory: (require) => { ... } })
```

所以 `lib/client.js` 由 esbuild 打成 CJS 再套这层外壳，`react` 与 `@deepseek-ai/*` 走 `require`。
直接产 ESM 会在页面里报 `import failed`。

## 隐私

- 本机引擎：**音频与转写都不出本机**，零联网
- 云端引擎：音频会上传阿里云百炼；首次调用会在返回值与日志里各给一次明确提示
- Key 只在配置文件与请求头里；接口只回掩码（`sk-…cdef`），日志不记明文
- 产物与录音默认不入库

## 已知限制

- **流式识别未支持**（BL-06）：目前是「停录后整段识别」，不是边说边出字
- **说话人分离质量有限**：短插话归属不稳定，偶尔同一句被拆到两人
- **本机麦克风**：部分机器录音为静音（无真实语音输入），这种情况用导入路径
- **界面端到端验证**：最近一次工具签名变更后，尚未在真实会话完整复验（`specs/20261110_meeting-agent-import` T-04/T-05）

## 相关文档

- `docs/dsh-note-taker-方案.md` —— 方案与里程碑
- `specs/_project/lessons.md` —— 踩过的坑（14 条，含宿主契约漂移、PowerShell 吞模板字符串等）
- `specs/_project/backlog.md` —— 待办（流式、音色分人、loopback 录音、长会议分块）

## Spec 流程

本项目用四阶段 spec 开发：**需求 → 方案 → 任务 → 实现**，三重人工确认后才写代码；
需求变更走 CR，坑与教训进台账。目录见 `specs/`，纪律见 `AGENTS.md`。

## License

MIT
