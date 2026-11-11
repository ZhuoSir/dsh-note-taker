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