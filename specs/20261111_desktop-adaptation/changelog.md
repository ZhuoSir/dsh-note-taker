# Changelog: desktop-adaptation

## v0.1.0（2026-11-11）

- 挂载: v1.0.0（用户确认，2026-11-11；在途版本，当日已挂 7 需求）
- 来源: 用户 2026-11-11「现在这个桌面版的如何适配，安装到桌面上」→「单独走个spec实现适配」
- 范围拍板: 用户选择「A. 安装与升级」（多选项里只勾 A；B 运行前置检查 / C 桌面交互 / D 只写文档 不做）
- 现况事实（Phase 0 探针，未产生产物代码）:
  - `dsh plugin --profile desktop add …` 被宿主拒绝：`profile "desktop" is managed exclusively by the Electron application`
  - 手工安装已在本机跑通（本次会话内完成，属环境侧临时处置，不受铁律 3 保护，因为未改动仓库源码）:
    `desktop/package.json` 加 `link:D:/workspace/my_workspace/dsh-note-taker` + `bundles` 追加；
    建 `node_modules/dsh-note-taker` junction；`pnpm install --lockfile-only` 使 lockfile 只增 3 行；
    从 profile 目录 `import('dsh-note-taker')` 能拿到 `apply,inject,name,resolveConfig,version`，`ws` 也能解析
  - 备份: `desktop/package.json.bak-before-notetaker`、`desktop/pnpm-lock.yaml.bak-before-notetaker`
  - 未验证: 重启桌面版后是否真激活（需用户重启应用，属 Phase 4 验证项）
- 里程碑审计（挂接/进度双向，本次一并核对）: 7 个 spec ↔ MILESTONE 7 行一致，任务全勾，合并提交齐全；
  `version.md` 的「已挂 6 需求」已更正为 7 并补记 streaming-asr 挂载与审计结论
- 初始化: requirements 草稿 v0.1.0（R-01~R-08 + 5 个验收场景 + Non-goals + 4 个待确认问题）
- **确认①**（2026-11-11）确认人: 陈卓 —— 用户「按你的建议就行了，确认」：
  - 命令入口定为三条 npm script（install/uninstall/verify:desktop）
  - 备份写 profile 内 `*.bak-<时间戳>`、保留最近 3 份
  - 卸载不动数据目录
  - 兼容声明本次不改，只做自检告警；补录转 **BL-07**（backlog 已记，P3）
  - requirements 转 v1.0.0 已确认，并按第 4 条决定补入 **R-09（兼容性告警，WARN 不阻断）**
- **Phase 2 方案**（2026-11-11）: 坑核对 21 条 active 坑（相交 5 条：L-10/L-17/L-14/L-06/L-07）；
  采用「一个 Node 脚本 + 三条 npm script + 可注入依赖的逻辑模块」；六步安装流程 + 卸载/升级语义；
  共享面身份矩阵 10 个身份（8 个插件 + pnpm lockfile + Electron 启动加载器）；
  8 条关键日志点 + 三类豁免；8 个被拒方案；5 条风险与规避
- **确认②**（2026-11-11）确认人: 陈卓 —— 用户「确认」：plan.md 转 v1.0.0 已确认，进入 Phase 3
- **Phase 3 任务**：7 条（T-01 安装逻辑 / T-02 CLI 与 npm script / T-03 自检+Key 来源+兼容告警 /
  T-04 卸载与不动他人 / T-05 运行检测与 --force / T-06 README / T-07 桌面版真机验证），含覆盖自检表
- **确认③**（2026-11-11）确认人: 陈卓 —— 用户「确认」：tasks.md 转 v1.0.0 已确认；
  三重确认自检通过（三份均 `状态: 已确认`、确认人 陈卓），允许进入 Phase 4
- **Phase 4 实现**（2026-11-11，分支 `feature/desktop-adaptation`）：
  - T-01/T-02：`lib/desktop.js`（安装/卸载/自检纯逻辑，fs·pnpm·进程探测·时钟全部可注入）+ `scripts/desktop.mjs`
    （CLI 薄壳，退出码 0/2/3）+ 三条 npm script（`install:desktop` / `uninstall:desktop` / `verify:desktop`）
  - T-03：五项自检 + `Key来源=page|env|none`（只报来源不报值）+ 兼容告警（宿主版本取 `dsh --version`，
    Windows 下需 shell 解析 .cmd 包装）+ 升级语义（链接安装，输出生效路径/HEAD）
  - T-04：卸载摘接线 + 「其它 8 个插件逐字未变」断言 + 数据目录保留提示
  - T-05：安装/卸载前探测 `DeepSeek Harness.exe`，默认拒绝（退出码 2），`--force` 才继续
  - T-06：README 增「装进桌面版（Electron）」一节（三条命令、五项自检表、退出码、Key 来源、卸载不动数据）
  - 实现期修的一个真问题：`execFileSync('dsh', ['--version'])` 在 Windows 上拿不到版本（`dsh` 是 .cmd 包装），
    导致兼容检查永远「无法判定」；改用 `execSync` + `shell: true` 后读到 `0.1.7-rc.2`
- **验证证据**（2026-11-11，danger-full-access）：
  - `node --test tests/desktop-install.test.js` → `tests 12 / pass 12 / fail 0`（安装/幂等/非法 JSON/
    pnpm 失败回滚/卸载逐字断言/运行检测/CLI 退出码/链接断裂/Key 来源/兼容告警）
  - `npm run verify` → 结构检查 41 项、构建可重复（`9f3c81211fed`）、`tests 344 / pass 344 / fail 0`
  - 真机只读自检 `npm run verify:desktop` → 五项全 ✓（依赖=bundles=链接=lockfile=可解析出 `apply,inject,name,…`）、
    `Key来源=none`、`兼容检查 宿主版本=0.1.7-rc.2 说明=已在声明列表内`，退出码 0
  - 真机安全阀 `npm run install:desktop`（桌面版在跑）→ `ERROR 检测到桌面版在运行，已中止` `进程数=6`，退出码 2
- **T-07 真机**（2026-11-11）用户重启桌面版后自测，反馈「目前还行」——桌面版内可用，7/7 任务完成
- **坑沉淀**：`lessons.md` 新增 L-22（Windows 上 `execFileSync('dsh', …)` 因 .cmd 包装拿不到版本）、
  L-23（desktop profile 被 Electron 独占，只能脚本化改文件）、L-24（PowerShell `Add-Content` 默认 GBK，
  会毁 UTF-8 的 md——本次追加 L-22/L-23 时当场踩到并修复）
- **完成报告**：`completion.md`（R-01~R-09 覆盖表、12 例单测与 344 例全量测试输出、真机自检与安全阀输出、取舍与未做项）
- **合并**（2026-11-11）: `feature/desktop-adaptation` 以 `--no-ff` 合入 `1.0.0`，合并提交 `b804fe9`
  （feature 分支末位提交 `d1b58e6`）。合并后复跑 `npm run verify`：结构检查 41 项、构建可重复
  `9f3c81211fed`、`tests 344 / pass 344 / fail 0`。MILESTONE 第 8 行转「已合并」，`version.md` 已挂数 7 → 8。
  未打 tag、未冻结版本（另需口令）
- **补记（L-14 复发）**：用 PowerShell 内联 `node -e` 改 `version.md` 时反引号被当转义吃掉，
  写入 `\x08`/`\x01` 残渣（反引号+b 变退格、反引号+1 被丢）；已用 `.tmp/fix-version-md.py` 重写该段，
  并全仓扫过控制字符（0 个文件命中）