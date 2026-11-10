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

本仓库自 2026-11-10 起承载全部源码（旧脚手架归档、仅作参考）。计划分层：

```
package.json            dsh.bundle.patch + dsh.client（浏览器侧）
cordis.patch.yml        宿主侧注册行
lib/index.js            宿主侧：工具注册 + webServer 路由
lib/client.js           浏览器侧产物（由 src/client 构建，React 18 + 插槽）
src/                    源码（宿主侧逻辑、解析/纪要核心、页面组件）
py/                     Python sidecar（转写；录音与分人本版本留契约）
README.md               目录树、分层职责、安装与调试命令
```

参考实现（已装插件 `dsh-sessions-manager` 3.7.10）给出的机制事实：宿主侧
`inject=['webServer',…]` + `ctx.webServer.register({kind,path,handler})`；浏览器侧
`inject=['slots']` + `ctx.slots.inject('settings.section', () => ctx.slots.register({name,id,order,label}, Component))`；
`package.json` 的 `dsh.client.inject` 声明客户端运行时包、`platform: 'web'`。

外部旧脚手架（归档，不参与构建）：`ai_dsh_test\dsh-note-taker`，含
`package.json` / `cordis.patch.yml` / `lib/index.js` / `py/{rec,asr}/`。

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

**已测**（2026-11-10 实现期实测）：

```
npm test  →  tests 75 / pass 75 / fail 0
（logger 9、errors 7、meetings 8、parse 8、minutes-validate 10、minutes-generate 10、service 11、tools 6、index 6）
npm run verify  →  结构检查 20 项全部存在 + 单测 75 通过
```

既有失败清单：无。

手工冒烟（不在 `npm test` 里，需要真实设备/模型）：`scripts/smoke-record.mjs`、
`scripts/smoke-transcribe.mjs`、`scripts/e2e.mjs`。

## 已知技术债

> 纪律：不得顺手改；改需另立 spec 并先考古原因。

1. **旧脚手架无版本控制（归档，不再维护）**：`ai_dsh_test\dsh-note-taker` 及其父目录都不是
   git 仓库。2026-11-10 用户决定「重建，旧的不动」，本仓库自建骨架后此债即消；
   旧目录只作参考，任何改动都不再发生在那里。
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
