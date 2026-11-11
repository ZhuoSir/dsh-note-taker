# 配置变更汇总 v1.0.0

> 汇总日期: 2026-11-11 | 判据: 逐 spec 读 `artifacts.md`（8 个 spec 均无 → 0 条登记）
> 结论: **本版无部署配置文件变更**（无 Nacos / 无 nginx / 无应用 yaml）

## 一、部署配置

| # | 类型 | 位置 | key | 旧值 | 新值 | 来源 spec | 需重启 |
|---|---|---|---|---|---|---|---|
| — | — | — | （本版无部署配置变更） | — | — | — | — |

## 二、运行期配置（v1.0.0 首次发布，相对「无」全部为新增）

仅列**本版新增**的 3 项（流式识别，默认关闭）；其余运行期变量（`NOTE_TAKER_DATA` / `NOTE_TAKER_PYTHON` /
`NOTE_TAKER_ASR_ENGINE` / `NOTE_TAKER_CLOUD_ASR_*` / `NOTE_TAKER_MODEL*` / `NOTE_TAKER_THREADS` /
`NOTE_TAKER_HF_ENDPOINT` / `NOTE_TAKER_LLM_*` / `DASHSCOPE_API_KEY` 等）以 `README.md` 的「环境变量」表为准，
不由版本文件复制维护（避免两处真相）。

| # | 类型 | 位置 | key | 旧值 | 新值 | 来源 spec | 需重启 |
|---|---|---|---|---|---|---|---|
| 1 | 环境变量（可选） | 宿主进程 env | `NOTE_TAKER_STREAM_ENABLED` | （无） | `false`（默认关闭） | streaming-asr | 是 |
| 2 | 环境变量（可选） | 宿主进程 env | `NOTE_TAKER_STREAM_MODEL` | （无） | `qwen3-asr-flash-realtime` | streaming-asr | 是 |
| 3 | 环境变量（可选） | 宿主进程 env | `NOTE_TAKER_STREAM_URL` | （无） | `wss://dashscope.aliyuncs.com/api-ws/v1/realtime` | streaming-asr | 是 |

## 三、页面配置文件（非版本控制）

| # | 类型 | 位置 | key | 旧值 | 新值 | 来源 spec | 需重启 |
|---|---|---|---|---|---|---|---|
| 1 | JSON 文件 | `~/.dsh/note-taker/config.json` | `asr.stream.enabled` / `asr.stream.model` | （无） | 缺省不写（稀疏落盘） | streaming-asr | 否（热生效） |

说明: 该文件由设置页写入、运行期读取，属用户数据（不入库、不进版本）。优先级：页面配置 > 环境变量 > 缺省。

## 四、验证与回滚（配置侧）

- 验证: `GET /note-taker/health` 的 `stream.enabled` / `stream.available` / `stream.reason` 反映实际生效值
- 回滚: 删除页面配置里的 `asr.stream` 段或把 `NOTE_TAKER_STREAM_ENABLED` 置 `0`，重启后回到非流式（无需改文件）