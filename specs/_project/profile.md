# 项目画像

> init 生成于 2026-11-10 | 最近刷新: 2026-11-10 | 事实变更时更新（Implement 中发现不符顺手更新）

## 基本事实

**技术栈**

| 层 | 事实 |
|---|---|
| 插件宿主 | DSH 插件（Cordis）：`cordis.patch.yml` + `lib/index.js`（`export name / inject / apply`），Node.js ESM（`"type": "module"`） |
| 运行时 | Node v24.16.0、npm 11.13.0、pnpm 11.8.0、git 2.54.0 |
| sidecar | Python 3.14.5（`C:\Users\KypCa\AppData\Local\Python\pythoncore-3.14-64`） |
| 已装依赖（2026-11-10 实测） | faster-whisper 1.2.1、ctranslate2 4.8.1、PyAV(av)、onnxruntime 1.29.0、numpy、scipy |
| 缺失依赖 | `sherpa-onnx`（cp314 轮子不可用，见技术债）、`soundcard`（录音） |
| 计划引入 | 独立 Python 3.12（免安装 embeddable，仅供 sherpa-onnx 分人进程） |

**模块**

本仓库当前**无源码**。插件代码位于外部目录 `D:\workspace\my_workspace\ai_dsh_test\dsh-note-taker`：

```
package.json            dsh.bundle.patch → cordis.patch.yml
cordis.patch.yml        insert: id=note-taker
lib/index.js            注册 4 个工具（record_start/stop、transcribe、doctor）
py/rec/record.py        录音 sidecar（soundcard，mic/system/both）
py/asr/transcribe.py    faster-whisper 转写 + 段落对齐
py/asr/diarize.py       sherpa-onnx 音色分人
py/doctor.py            环境体检
py/get_models.py        分人模型下载
```

用户于 2026-11-10 决定「只建机制，代码不动」，故未复制进本仓库（见 §已知技术债第 1 条）。

**命令**

| 用途 | 命令 |
|---|---|
| 构建 | 无（无 package.json，插件由 DSH 宿主按 `dsh.bundle.patch` 加载） |
| 测试 | 无（仓库内无测试文件） |
| Lint | 无 |
| 本地启动 | 无（插件尚未安装进任何 DSH profile） |
| 环境体检（外部） | `python py/doctor.py`（在外部代码目录下） |

**SQL / 迁移**：无。转写与纪要走文件，不落地数据库。

**CI**：无（无 `.github/workflows`、无 Jenkinsfile、无 `.gitlab-ci.yml`）。

## 既有约定（权威来源，摘录关键条目）

- **未发现既有约定文件**：无 `AGENTS.md`（本仓库的 AGENTS.md 由 spec init 于 2026-11-10 新建）、无 `CLAUDE.md`、无 `.cursorrules`、无 `docs/conventions/`、无 `docs/standards/`。
- 唯一既有文档是 `docs/dsh-note-taker-方案.md`（实施方案，非强制规范；其中「关键决策」表可作为需求辩论的输入）。
- 会话 catalog 中无覆盖「代码风格」的规范类 skill（`api-design`、`code-review`、`python`、`javascript` 等是角色型助手，不构成团队代码标准）→ `.specrc.yml` 对应领域取 `global` / `none`。

## 测试基线

**未测**（init 时用户选择跳过。原因：仓库内无测试文件、无测试命令；代码在外部目录且无版本控制）。

既有失败清单：暂无（无测试可列）。首次建立测试后用「补测基线」重跑本节。

## 已知技术债

> 纪律：不得顺手改；改需另立 spec 并先考古原因。

1. **插件代码无版本控制**：`ai_dsh_test\dsh-note-taker` 及其父目录都不是 git 仓库 →
   spec 流程要求的 commit footer（`Spec:` / `Task:`）在代码侧没有落点，Task 追溯链会断。
   首次 Implement 前必须二选一：把代码纳入本仓库，或为代码另建仓库并在 profile 记录路径。
2. **sherpa-onnx 在 Python 3.14 不可用**：cp314 轮子内嵌 ORT 1.17 与编译头（API 28）不一致，
   换版本无效 → 分人功能依赖独立 3.12 运行时（方案 §5.4）。
3. **录音全程缓存在内存**：`py/rec/record.py` 收尾才一次性写 WAV，1 小时会议峰值约 115 MB；
   本机可用内存仅 3.1–3.3 GB → 需改分块落盘。
4. **录音索引未实现**：`meeting_transcribe(audio="latest")` 直接抛错，`recordings/index.json` 缺失。
5. **分人精度从未验证**：无真实会议音频，SAPI 合成被环境拒绝（见 lessons L-04），
   DER 与 RTF 均为估算值。

## git 现状

- 主分支：`main`（2026-11-10 `git init -b main` 新建，无远端）
- 保护：无
- 最近 tag：无
- 提交风格：无历史，首个 commit 即 init 基线（`chore(spec): 接入 bryanchen-spec 机制…`）
- 分支模型建议：**A 档**（单人项目，无 `release/*` 痕迹，无服务端发布节奏；
  版本分支体系按 `standards/git-workflow.md` 在首次「新建里程碑」时启用）

## 规范路由

见项目根 `.specrc.yml`（本表不重复维护）。
