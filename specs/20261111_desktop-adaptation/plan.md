# 方案: 桌面版适配（安装与升级）

> 版本: v0.1.0 | 状态: 草稿 | 更新: 2026-11-11 | 确认人: 待填

## 坑核对（先审这一节）

逐条过 `specs/_project/lessons.md` 全部 21 条 active/relevant 坑，与「写一个改 profile 文件的 Node 安装器」相交的有 5 条：

| 坑 | 相交点 | 本方案如何避开 |
|---|---|---|
| **L-10** 插件进了 profile 配置但 apply 从未执行 | 本需求的整个失败模式就是它：写了 `bundles` 却激活不了，表面「装好了」实际没挂上 | R-03 把「从 profile 目录真能 `import` 出 `apply/inject/name`」列为安装成功的前置校验，且 R-04 要求校验不过就报错退出；不接受「文件写了就算装好」 |
| **L-17** 受限沙箱下 `npm run verify` 因 spawn EPERM 假红 | 安装器要 spawn `pnpm`，测试里也会 spawn；沙箱下会是假失败，容易误判「安装器坏了」 | 安装器把 `pnpm` 调用抽象成可注入的 `runPnpm` seam，单测用假 runner（不 spawn）；只有 `install:desktop` 真跑才 spawn，且失败信息里写明「若在受限沙箱里，pnpm 子进程可能被拒（见 L-17）」 |
| **L-14** 用 PowerShell 给 JS 源码做批量替换会吃反引号 | 本次要改的正是 `package.json`/`pnpm-lock.yaml` 这类结构化文本 | 一律 Node `fs` + `JSON.parse/stringify`（锁文件只由 pnpm 自己写），全程不碰 PowerShell 文本替换 |
| **L-06** 开发期写 `~/.dsh` 会被沙箱拒绝 | 安装器要写 `~/.dsh/profiles/desktop/*` | 明确要求 `danger-full-access`（本会话已是）；脚本失败时把这个原因写进错误提示，不静默 |
| **L-07** 表检脚本在 GBK 控制台下崩溃，退出码 1 会误读 | 本 spec 产物是中文 markdown 表格 | 表检一律 `PYTHONUTF8=1` 跑，且「脚本崩溃」与「表格不合格」分开判读 |

已核对 21 条，其余 16 条（L-01~L-05、L-08~L-09、L-11~L-13、L-15~L-16、L-18~L-21）与本需求无相交：它们分别关于 Python 依赖、测试音频、命名、下载器、宿主工具契约、配置双读、状态自愈、实时 ASR 协议——安装器不碰这些路径。

## 采用方案

**一个 Node 脚本 + 三条 npm script + 一个可测的纯逻辑模块。**

```
scripts/desktop.mjs        CLI 薄壳：解析 install|uninstall|verify → 调 lib/desktop.js → 打印 → 设置退出码
lib/desktop.js             纯逻辑：planInstall / applyInstall / verifyInstallation / removeInstallation
                           （依赖注入：fs、runPnpm、now、execPath 探测，全部可替换 → 单测不 spawn、不碰真实 profile）
tests/desktop-install.test.js   临时目录里造假 profile，覆盖 5 个验收场景
```

`package.json` 增三条 script：

```json
"install:desktop": "node scripts/desktop.mjs install",
"uninstall:desktop": "node scripts/desktop.mjs uninstall",
"verify:desktop": "node scripts/desktop.mjs verify"
```

### 安装流程（六步，每步一条日志）

1. **定位**：`profileDir = 环境变量 NOTE_TAKER_DESKTOP_PROFILE || ~/.dsh/profiles/desktop`；
   `repoDir = 脚本所在仓库根`。桌面版进程在跑就提示「先关闭桌面版（或加 --force）」，默认退出——避免边跑边改 node_modules。
2. **读并校验**：`package.json` 解析失败 / 缺 `dsh.profile` / `bundles` 非数组 → 报错退出（不改任何文件）。
3. **判幂等**：`dependencies['dsh-note-taker'] === 'link:<repo>'` 且 `bundles` 含它 且 junction 指向 repo 且 lockfile 含该 specifier
   → 打印「已安装，跳过写入」并直接进第 6 步校验。
4. **备份**：`package.json` / `pnpm-lock.yaml` → `<名>.bak-<yyyyMMdd-HHmmss>`；清理同前缀旧备份，保留最近 3 份。
5. **写入**：① 改 `dependencies`（仅新增该键，不动既有键顺序）；② `bundles` 追加；③ 建
   `node_modules/dsh-note-taker` 链接（Windows 用 **junction**，无权限要求；POSIX 用 symlink）；
   ④ 调 `pnpm install --lockfile-only --ignore-scripts`（只改 lockfile，不重排 node_modules，
   避免动到另外 8 个插件）。任一步失败 → 用第 4 步的备份回滚 + 删掉刚建的链接 → 退出码 3。
6. **自检**：五项断言（解析出导出 / bundles 含 / 链接指向 repo / lockfile 含 specifier / 插件自己的 `ws` 可解析）
   + R-08 Key 来源报告 + R-09 兼容告警。全绿则打印「装好了，重启桌面版生效」。

### 卸载流程

同样备份 → 删 `dependencies` 键、删 `bundles` 条目、删链接 → `pnpm install --lockfile-only` →
自检「未安装」+ 断言 profile 里其它 8 个依赖键与 8 个 bundle 条目**逐字未变**（diff 快照）→ 数据目录原样保留并打印其路径。

### 升级语义（R-06）

链接式安装 ⇒ 仓库代码即生效代码：`git switch/pull` 后重启桌面版即换成新代码。
`verify:desktop` 输出「生效路径 / HEAD commit / 插件版本 / 是否已安装」，作为「我到底在跑哪份代码」的自查入口。

### 键位与格式细节

- `package.json` 用 `JSON.stringify(obj, null, 2) + '\n'`，保持 2 空格（与现值一致）；**不重排键**（就地增删）。
- `pnpm-lock.yaml` **绝不自己写**：只让 pnpm 写（避免手写 YAML 破坏 lockfileVersion 9.0 结构）。
- 链接目标用 `realpath` 比较，避免 `D:` 大小写/短名差异导致幂等误判。

## 模块与数据流

```
用户 → npm run install:desktop → scripts/desktop.mjs
                                    ↓
                            lib/desktop.js  ──读/写──→ ~/.dsh/profiles/desktop/package.json
                                    │                 ~/.dsh/profiles/desktop/node_modules/dsh-note-taker（链接）
                                    │                 ~/.dsh/profiles/desktop/pnpm-lock.yaml（经 pnpm 写）
                                    ↓
                              runPnpm(seam) → pnpm install --lockfile-only --ignore-scripts
                                    ↓
                            五项校验（createRequire 解析 / 链接 realpath / lockfile 文本 / ws 解析）
```

不改动：插件运行时代码（`lib/index.js`、路由、service）、`lib/client.js`、py sidecar、数据目录。
本需求**不产生任何运行时行为变化**——它只把「已经手工验证可行的安装动作」脚本化。

## 共享面身份矩阵

**共享面判据**：`~/.dsh/profiles/desktop/package.json` 与 `pnpm-lock.yaml` 是桌面版**所有**插件共用的清单文件
——「还有谁依赖这个文件？」答案是 8 个（以上），因此是共享面，必须逐个身份写预期行为。

| # | 身份 | 依赖方式 | 变更后预期行为 | 断言 |
|---|---|---|---|---|
| 1 | `dshmarket` | bundles 条目 | 插件市场列表/安装逻辑照旧；本插件作为普通第三方插件出现在列表 | 卸载后该条目逐字不变；安装后 bundles 顺序中它仍在原位 |
| 2 | `dsh-vision-router` | 依赖 + bundles | 版本号与条目不变 | 安装/卸载前后 `dependencies` 该值全等 |
| 3 | `dsh-context` | 依赖 + bundles | 同上 | 同上 |
| 4 | `dsh-image-generation` | 依赖 + bundles | 同上 | 同上 |
| 5 | `dsh-obsidian` | 依赖 + bundles | 同上 | 同上 |
| 6 | `dsh-sessions-manager` | 依赖 + bundles | 同上 | 同上 |
| 7 | `dsh-free-search` | 依赖 + bundles | 同上 | 同上 |
| 8 | `ds-bot` | 仅 dependencies（无 bundle） | 依赖值不变；安装器不得因它不在 bundles 而删它 | 安装/卸载后仍存在且版本全等 |
| 9 | pnpm（启动时可能校验 lockfile） | `pnpm-lock.yaml` | lockfile 只增加/删除本插件 3 行，`lockfileVersion` 与其余条目不变 | 安装前后 diff 行数 == 3（新增）或 == -3（卸载） |
| 10 | Electron 启动加载器 | 读 `dsh.profile.bundles` | 重启后多激活一个插件；其余插件激活顺序不变 | `verify:desktop` 报告 bundles 总数 9 → 10，且前 9 项与原文一致 |

矩阵没列的身份 = 未评估；Tasks 的断言与提交证据都以本矩阵为源（身份 1~8 的「没改坏」断言 + 身份 9 的 diff 行数断言）。

## 关键日志点清单

安装器是 CLI（无 web 请求、无 traceId），用「步骤号 + 结果」承担可追性；四类强制日志点中，本需求涉及「外部调用」一类（spawn pnpm），其余三类（服务启停/定时任务/安全事件）不涉及但在表里写明豁免理由。

| 场景 | 级别 | 触发点 | 必带字段 | traceId/runId |
|---|---|---|---|---|
| 安装开始 | INFO | `install` 入口 | `repoDir`、`profileDir`、`插件版本` | 无（单次 CLI）；用 `步骤=N` 代替 |
| 每步动作 | INFO | 备份/写入/链接/lockfile/校验 各步 | `步骤=2/6`、动作名、目标路径 | 同上 |
| 幂等跳过 | INFO | 判定已安装 | `已安装=true`、`repoDir`、`跳过写入原因` | 同上 |
| pnpm 外部调用（出） | DEBUG | 调 `runPnpm` 前 | `cmd`、`cwd`、`args` | 同上 |
| pnpm 外部调用（回） | INFO | pnpm 退出后 | `耗时ms`、`退出码`、`lockfile 增删行数` | 同上 |
| pnpm 调用失败 | ERROR | 非 0 退出或 spawn 失败 | `退出码`/`错误码`、`stderr 末 500 字`、`是否已回滚=true` | 同上；**不含任何密钥** |
| 回滚 | WARN | 备份恢复完成 | `恢复文件列表`、`回滚原因`、`链接是否已清理` | 同上 |
| 自检结果 | INFO | `verify` 五项断言完成 | 每项 `通过/未通过`、`repoDir`、`HEAD`、`插件版本` | 同上 |
| Key 来源报告 | INFO | 自检 R-08 | `来源=page/env/none`（**只报来源，不报值**） | 同上 |
| 兼容告警 | WARN | 版本不在声明内（R-09） | `检测版本`、`已声明列表`、`补声明方式` | 同上 |
| 卸载完成 | INFO | `uninstall` 结束 | `移除项列表`、`其它插件断言=逐字未变`、`数据目录已保留=路径` | 同上 |
| （豁免）服务启停 / 定时任务 / 安全事件 | — | — | 本需求是本地一次性 CLI，无常驻服务、无调度、无鉴权面 | 豁免，理由：不适用 |

## 被拒绝的替代方案

| 方案 | 拒绝理由 |
|---|---|
| 改宿主 `dsh` CLI 让 `--profile desktop` 可用 | 宿主行为，不属于本插件；改了下次宿主升级就失效（L-13 同类风险） |
| `pnpm add link:<repo>` 走完整安装 | 会重排 node_modules 并可能改动其它 8 个插件的解析结果；`--lockfile-only` + 手工 junction 的改动面小得多 |
| 只在文档里写手工步骤（用户已排除的 D 选项） | 每次升级都要人肉重做，且无法回滚；这正是本需求要消灭的成本 |
| 用 symlink 替代 junction | Windows 建 symlink 需管理员或开发者模式，普通用户会卡住；junction 对目录够用且无权限要求 |
| 复制插件源码进 profile `node_modules` | 升级即失效（违背 R-06），且会产生两份真相 |
| 发布到插件市场 | 范围外；市场安装是另一条链路（`dshmarket`），且需要发版与策展 |
| 在 `package.json` 加 `postinstall` 自动装 | 任何 `npm i` 都会触发副作用，污染开发流程；显式命令才符合「可审计」 |
| 把桌面版版本号写进 `dsh.compatibility` | 需要先拿到桌面版 DSH 版本且门禁行为未知，误判会直接让插件不激活；本次只告警（BL-07 再补） |

## 风险与规避

| 风险 | 影响 | 规避 |
|---|---|---|
| 桌面版启动时自己跑 `pnpm install`，把非 pnpm 管理的 junction 当 extraneous 清掉 | 插件「装好了又消失」 | lockfile 里已用 pnpm 自己写入该 `link:` 依赖，pnpm 认为它合法；`verify:desktop` 可随时复检；文档写明「若被清理，重跑 install:desktop」 |
| 安装时桌面版正在运行，`pnpm install` 改动 node_modules | 运行中的进程可能读到变动文件 | 安装器默认检测进程并拒绝（`--force` 可跳过），提示「关闭后重装」 |
| `pnpm` 不在 PATH（GUI 启动的终端环境更窄） | 安装中断 | 依次尝试：PATH 里的 `pnpm` → `~/.dsh/profiles/node_modules/pnpm/bin/pnpm.cjs` → 报 `E_DEP` 并提示 `npm i -g pnpm` |
| 用户机器上 profile 路径非默认 | 装错位置 | 支持 `NOTE_TAKER_DESKTOP_PROFILE` 覆盖，并在日志首行打印实际使用的路径 |
| `verify` 依赖插件能 import，而插件顶层若有副作用会误触发 | 假失败 | `import` 前先读 `package.json` 的 `exports`/`main`；插件 `apply` 只在宿主导入时执行，单独 import 无副作用（已在本机实测拿到 5 个导出） |