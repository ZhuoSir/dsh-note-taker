# 需求: 桌面版适配（安装与升级）

> 版本: v1.0.0 | 状态: 已确认 | 更新: 2026-11-11 | 确认人: 陈卓 | 确认日期: 2026-11-11

## 背景与目标

会记现在只能装进「CLI 可管理」的 profile（`web` 等）。桌面版（Electron，`desktop` profile）由应用独占，
`dsh plugin --profile desktop add …` 直接拒绝：

```
$ dsh plugin --profile desktop add D:\workspace\my_workspace\dsh-note-taker
node.exe : error: required option '--profile <name>' not specified   ← 不带 profile 时
node.exe : error: profile "desktop" is managed exclusively by the Electron application   ← 带 desktop 时
```

结果是：想在桌面版里用会记，只能手工改 `~/.dsh/profiles/desktop/package.json`（加 `link:` 依赖与 bundles）、
手工建 `node_modules` 链接、手工跑 `pnpm install --lockfile-only`。2026-11-11 这次适配就是这么做的，
能跑，但是**不可重复、不可回滚、换机器就要重新摸索**，而且没人记得改过哪几个文件。

目标：把「装进桌面版」变成一条可重复执行的命令——**幂等安装、装前备份、装后自检、可干净卸载**；
仓库代码更新后无需重装即生效（链接式安装）；换机器照同一条命令能复现。

成功长什么样：新机器上 `npm run install:desktop` 一条命令 → 重启桌面版 → 设置页出现「会记」、
会话卡片能录音；升级仓库代码后重启即可生效；`npm run uninstall:desktop` 能把 profile 恢复原样。

## 需求条款

- **R-01 幂等安装**：WHEN 用户执行安装命令，系统 SHALL 在不询问的情况下把插件装进 `desktop` profile：
  `package.json` 的 `dependencies` 增加 `link:<仓库绝对路径>`、`dsh.profile.bundles` 追加 `dsh-note-taker`、
  `node_modules/dsh-note-taker` 指向仓库、`pnpm-lock.yaml` 与该依赖保持一致。重复执行 SHALL 不产生重复条目、
  不重复写入文件内容（第二次执行后 `git`/文件哈希不变）。
- **R-02 装前备份与失败回滚**：WHEN 安装开始，系统 SHALL 先备份将被修改的 profile 文件（`package.json`、
  `pnpm-lock.yaml`）；IF 任一安装步骤失败，系统 SHALL 回滚到备份并如实报告失败步骤与原因，且不得留下「改了一半」的 profile。
- **R-03 装后自检**：WHEN 安装成功，系统 SHALL 逐项校验并打印结果：① 从 profile 目录能解析到 `dsh-note-taker`
  并拿到 `apply/inject/name` 导出；② `dsh.profile.bundles` 含该插件；③ `node_modules/dsh-note-taker` 指向本仓库；
  ④ `pnpm-lock.yaml` 含该 `link:` 依赖；⑤ 插件自身运行时依赖（`ws`）可从 profile 解析。
- **R-04 前置不满足则拒绝**：IF 目标 profile 目录不存在、`package.json` 结构异常（非 JSON / 缺 `dsh.profile`）、
  或安装后无法解析，系统 SHALL 以可读错误说明并退出，且不改动任何 profile 文件。
- **R-05 干净卸载**：WHEN 用户执行卸载命令，系统 SHALL 移除该依赖、bundles 条目与 `node_modules` 链接，
  并把 `pnpm-lock.yaml` 恢复到不含该依赖的状态；MUST NOT 改动 profile 中其它插件与依赖。
- **R-06 升级即生效**：WHERE 以链接方式安装，WHEN 仓库代码更新（切分支 / pull / 新提交），系统 SHALL 无需重装即可在重启桌面版后生效；
  安装器 SHALL 提供只读自检模式，输出「当前生效的仓库路径 + HEAD commit + 插件版本」。
- **R-07 可审计且不泄密**：WHEN 安装器运行，系统 SHALL 逐步打印动作（备份 / 写入 / 链接 / lockfile / 校验）；
  MUST NOT 在任何输出中出现 API Key 等密钥（含从环境变量读到的值）。
- **R-08 桌面版配置来源提示**：WHEN 自检运行，系统 SHALL 报告云端 Key 的当前来源（页面配置 `config.json` /
  环境变量 / 未配置），并在仅有环境变量时提示「桌面版从图形界面启动，终端里的环境变量不会传进去，建议在设置页填写」。
- **R-09 兼容性告警**：IF 桌面版实际 DSH 版本不在插件 `dsh.compatibility.dshReleases` 声明内，系统 SHALL 输出
  WARN 级告警（写明「检测到的版本 / 已声明版本 / 如何补声明」），且 MUST NOT 因此中断安装。

## 验收场景

**S-01 首次安装（正常）**
GIVEN 机器上存在 `~/.dsh/profiles/desktop` 且未装过会记
WHEN 执行 `npm run install:desktop`
THEN 输出五步校验全部 ✓，`package.json` 出现 `link:` 依赖与 bundle 条目，`node_modules` 链接指向仓库，
重启桌面版后设置页出现「会记」

**S-02 重复安装（幂等）**
GIVEN 已装过会记
WHEN 再次执行 `npm run install:desktop`
THEN 输出「已安装」并跳过写入，`package.json` 与 `pnpm-lock.yaml` 内容哈希不变

**S-03 安装失败回滚（异常）**
GIVEN 人为把 profile 的 `package.json` 改成非法 JSON
WHEN 执行安装命令
THEN 退出码非 0，报错指明「package.json 解析失败」，且文件内容与执行前一致（未被改写）

**S-04 卸载**
GIVEN 已装会记，且 profile 里还有其它 8 个插件
WHEN 执行 `npm run uninstall:desktop`
THEN 该依赖与 bundle 条目消失、链接删除、lockfile 恢复，其它 8 个插件条目逐字不变，`--verify` 报「未安装」

**S-05 升级即生效**
GIVEN 以链接方式安装
WHEN 在仓库里 `git switch` 到另一个含新提交的分支后重启桌面版
THEN 运行行为即为新分支代码（自检输出的 HEAD 与新分支一致），无需重装

## Non-goals（范围外）

- 桌面交互适配：托盘图标、系统通知、窗口失焦时的字幕轮询策略、Electron 麦克风权限申请——本次不做
- 发布到插件市场 / 打包成分发包（`dshmarket` 的策展与签名流程）
- 宿主动自更新、跨机器同步 profile、Windows 服务或开机自启
- 让 `dsh plugin --profile desktop` 这个 CLI 守卫放开（那是宿主行为，不是本插件能决定的）
- 运行期前置检查的自动化修复（缺 Python/依赖时自动安装）——本次只在自检里报告，不代装

## 正在做的假设

1. 桌面版与 `web` profile 使用同一套 profile 目录结构与同一种 `link:` 依赖写法（2026-11-11 已实测可解析、可 export 出 `apply`）。
2. 「Electron 独占」是 CLI 层的守卫，不是文件锁——直接改 profile 文件是可行且被应用接受的（本次手工安装已验证应用能读）。
3. 插件激活仍需重启桌面版；本需求不实现热加载。
4. 安装器用仓库内 Node 脚本（`scripts/`）+ npm script 暴露，不修改宿主 CLI。
5. 数据目录 `~/.dsh/note-taker` 与 web profile 共用，本次不改变。
6. 卸载默认**不动**数据目录（录音/转写/配置都保留），只在文档里写明如何手工清理。

现在纠正，否则按此执行。

## 已确认的决定（2026-11-11，确认人 陈卓，「按你的建议就行了」）

1. **命令入口**：三条 npm script
   `npm run install:desktop` / `npm run uninstall:desktop` / `npm run verify:desktop`，
   全部薄封装同一个 Node 脚本（不新增任何依赖，不引入第三方 CLI）。
2. **备份策略**：备份写在 profile 内 `*.bak-<时间戳>`，**只保留最近 3 份**，更旧的自动清理；
   备份路径与清理结果都打印出来。
3. **卸载不清数据**：默认不动 `~/.dsh/note-taker`（录音、转写、产物、配置都是用户资产）；
   文档里给出手工清理方式，脚本不代删。
4. **兼容声明**：本需求**不改** `package.json` 的 `dsh.compatibility`，只做 R-09 自检告警；
   补录桌面版实际版本号转为 **BL-07**（已记入 `specs/_project/backlog.md`，P3）。

另：R-09 是本轮确认时按第 4 条决定补入的条款（用户「按你的建议」涵盖此项），与 R-01~R-08 一并确认。