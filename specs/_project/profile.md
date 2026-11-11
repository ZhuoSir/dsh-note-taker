# 项目画像

> init 生成于 2026-11-10 | 最近刷新: 2026-11-10 | 事实变更时更新（Implement 中发现不符顺手更新）

## 基本事实

**技术栈**

| 层 | 事实 |
|---|---|
| 插件宿主 | DSH 插件（Cordis）：`cordis.patch.yml` + `lib/index.js`（`export name / inject / apply`），Node.js ESM（`"type": "module"`） |
| 运行时 | Node v24.16.0、npm 11.13.0、pnpm 11.8.0、git 2.54.0 |
| sidecar | Python 3.14.5（`C:\Users\KypCa\AppData\Local\Python\pythoncore-3.14-64`） |
| 已装依赖（2026-11-11 实测） | 运行时依赖: `ws ^8.22.2`（实时 ASR 要带 Authorization 头，内置 WebSocket 做不到，见 L-21）；devDependencies: `esbuild ^0.28.2`（构建 `lib/client.js`）。Python 侧：faster-whisper 1.2.1、ctranslate2 4.8.1、PyAV(av)、onnxruntime 1.29.0、numpy、scipy、sounddevice 0.5.6（`pylibs/`） |
| 缺失依赖 | `sherpa-onnx`（cp314 轮子不可用，见技术债）、`soundcard`（loopback 录音） |
| 计划引入 | 无（原「独立 Python 3.12 跑 sherpa 分人」已取消：分人改由云端 3.1 提供，BL-02 关闭） |

**模块**

本仓库自 2026-11-10 起承载全部源码（旧脚手架归档、仅作参考）。当前结构（2026-11-11 实际）：

```
package.json            dsh.bundle.patch + dsh.client（platform=web，inject runtime/ui-slots）
cordis.patch.yml        宿主侧注册行
lib/index.js            宿主侧入口：工具注册 + 可选注入 webServer/workspaceRegistry
lib/tools.js            7 个 meeting_* 工具（output 同时带 type 与 schema/render，见 L-13）
lib/service.js          业务编排：录音/转写/导入/纪要/产物/状态自愈
lib/routes.js           /note-taker/* 共 10 条精确路由（list/detail/health/config/transcribe/minutes/record/import/label…）
lib/asr/                双引擎：local(faster-whisper) / cloud(百炼 HTTP，含分片与分人)；stream.js 是流式实时 ASR 客户端（默认关，失败降级回 HTTP）
lib/output.js           产物单文件（工作区 meetings/<id>.md，回落数据目录）
lib/settings.js         配置读写与优先级（页面 > 环境变量 > 默认，掩码回显）
lib/client.js           浏览器侧产物（esbuild 打包，`window.__ModuleLoader__.load` 格式）
src/client/             React 18 源码：SettingsPage（配置/历史纪要两 tab）、QuickPanel（录音→确认→交会话）、logic/api/host/handoff
py/                     Python sidecar：record.py（录音）/ transcribe.py（本地 ASR）/ decode_pcm.py / fetch_model.py
tests/                  node --test 单测（331 个）
scripts/                verify.mjs（结构 41 项 + 构建可重复 + 单测）/ build-client.mjs / e2e.mjs / smoke-*.mjs
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
| 构建页面产物 | `npm run build:client`（esbuild → `lib/client.js`，宿主要求 `__ModuleLoader__` 格式） |
| 全量校验 | `npm run verify`（结构 41 项 + 构建可重复校验 + 全量单测） |
| 单测 | `npm test`（= `node scripts/verify.mjs --tests-only`） |
| 端到端 | `node scripts/e2e.mjs [--audio <文件>] [--model small] [--seconds N]` |
| 冒烟 | `node scripts/smoke-record.mjs`、`node scripts/smoke-transcribe.mjs` |
| 装 Python 依赖 | `node scripts/install-py.mjs` |
| 装进宿主 | `dsh plugin --profile <profile> add D:\workspace\my_workspace\dsh-note-taker`（desktop 由 Electron 独占，验证用 web profile + `dsh web --port 8099`） |

**SQL / 迁移**：无。转写与纪要走文件，不落地数据库。

**CI**：无（无 `.github/workflows`、无 Jenkinsfile、无 `.gitlab-ci.yml`）。

## 既有约定（权威来源，摘录关键条目）

- **未发现既有约定文件**：无 `AGENTS.md`（本仓库的 AGENTS.md 由 spec init 于 2026-11-10 新建）、无 `CLAUDE.md`、无 `.cursorrules`、无 `docs/conventions/`、无 `docs/standards/`。
- 唯一既有文档是 `docs/dsh-note-taker-方案.md`（实施方案，非强制规范；其中「关键决策」表可作为需求辩论的输入）。
- 会话 catalog 中无覆盖「代码风格」的规范类 skill（`api-design`、`code-review`、`python`、`javascript` 等是角色型助手，不构成团队代码标准）→ `.specrc.yml` 对应领域取 `global` / `none`。

## 测试基线

**已测**（2026-11-11 `npm run verify` 实测）：

```
结构检查: 41 项全部存在
构建校验: lib/client.js 可重复构建（9f3c81211fed）
tests 331 / pass 331 / fail 0
```

既有失败清单：无。

手工冒烟（不在 `npm test` 里，需要真实设备/模型）：`scripts/smoke-record.mjs`、
`scripts/smoke-transcribe.mjs`、`scripts/e2e.mjs`。

真实数据基线：47 分钟 m4a → 本地 `small` 903 段/8141 字/540s；云端 3.1 551 段/15613 字/312s。

## 已知技术债

> 纪律：不得顺手改；改需另立 spec 并先考古原因。

1. **旧脚手架无版本控制（归档，不再维护）**：`ai_dsh_test\dsh-note-taker` 及其父目录都不是
   git 仓库。2026-11-10 用户决定「重建，旧的不动」，本仓库自建骨架后此债即消；
   旧目录只作参考，任何改动都不再发生在那里。
2. **sherpa-onnx 在 Python 3.14 不可用**：cp314 轮子内嵌 ORT 1.17 与编译头（API 28）不一致，
   换版本无效。**影响已降到零**：分人改由云端 3.1 提供，本地方案按用户 2026-11-11 决定不做（BL-02 关闭）。
3. ~~录音全程缓存在内存~~（已消）：现行 `py/record.py` 每 0.1 秒一块写入 WAV，内存不随会议时长增长。
4. **录音索引未实现**：会议一律按 `meetingId` 引用，没有 `recordings/index.json`；
   工具侧用「最近一场会议」兜底，不足以支撑「挑某一段历史录音重转写」。
5. **分人精度只做过定性验证**：云端 3.1 在 2 分钟双人样本上分出 S0/S1（7 句 / 40 句），
   但 DER 未量化，短插话归属不稳定；正式纪要需人工核对发言人。

## git 现状

- 主分支：`main`；版本分支：`1.0.0`（在途，六个 spec 已合并，未打 tag）
- 远端：`origin` = https://github.com/ZhuoSir/dsh-note-taker.git（公开仓库；推送走本机代理 `127.0.0.1:7897`）
- 保护：无
- 最近 tag：无
- 提交风格：`<type>(<scope>): 中文描述` + footer `Spec:` / `Task:` / `Bug:`
- 分支模型：feature/<功能名> 从版本分支切、`--no-ff` 合回版本分支；合 main 与 push 需用户口令

## 规范路由

见项目根 `.specrc.yml`（本表不重复维护）。
