# 任务: 桌面版适配（安装与升级）

> 版本: v1.0.0 | 状态: 已确认 | 更新: 2026-11-11 | 确认人: 陈卓 | 确认日期: 2026-11-11

## 1. 逻辑与外壳

- [x] T-01 实现安装规划与写入逻辑（可注入依赖）
  关联: R-01, R-02, R-04
  依赖: 无
  验证方式: `node --test tests/desktop-install.test.js` 中 install 相关用例全绿；对临时 profile 跑一次安装，输出日志须依次出现
  `步骤=1/6`、`步骤=2/6`、`备份`、`步骤=5/6`、`链接`、`lockfile`；把 `package.json` 写成非法 JSON 再跑，须出现
  `package.json 解析失败` 且退出码非 0、文件哈希未变
  验收标准: 临时 profile 安装后 `dependencies['dsh-note-taker']` 为 `link:<repo>`、`bundles` 末尾为该插件、
  `node_modules/dsh-note-taker` 为 junction 且 realpath 指向仓库、`pnpm-lock.yaml` 含该 specifier；
  第二次执行后 `package.json` 与 lockfile 哈希不变（幂等）；失败路径完成回滚并清理已建链接

- [x] T-02 提供 CLI 薄壳与三条 npm script
  关联: R-01, R-07
  依赖: T-01
  验证方式: `node scripts/desktop.mjs` 无参 → 打印用法、退出码 2；`npm run verify:desktop -- --profile-dir <临时目录>`
  打印分步日志且成功退出码 0；`npm run verify` 仍全绿（结构检查 41 项、构建可重复、测试计数）
  验收标准: `package.json` 含 `install:desktop` / `uninstall:desktop` / `verify:desktop` 三条；退出码约定
  0=成功、2=用法或前置不满足、3=安装失败；全流程输出无密钥值

## 2. 自检与安全

- [x] T-03 实现五项自检、Key 来源报告与兼容告警
  关联: R-03, R-06, R-08, R-09
  依赖: T-01, T-02
  验证方式: 对已装 profile 跑 `verify:desktop`，输出须含五项 `✓` 与 `生效路径`、`HEAD`、`插件版本`；
  把 `node_modules` 链接改名后重跑，须该项 `✗` 且退出码非 0；Key 来源三态（`config.json` 有 Key / 仅环境变量 / 都没有）
  各一例，断言输出为 `Key 来源=page|env|none` 且**完整输出中不出现任何 Key 字符串**；构造一个不在
  `dsh.compatibility.dshReleases` 内的版本，断言出现 WARN 行且退出码仍为 0
  验收标准: 五个断言逐项可判定；`--json` 或文本输出含 `installed`、`repoDir`、`head`、`version`、`keySource`、`compat`；
  告警不阻断安装（R-09）

- [x] T-04 实现卸载与「不动其它插件」断言
  关联: R-05
  依赖: T-01
  验证方式: 在临时 profile 预置 8 个假插件（依赖 + bundles）→ 安装 → 卸载；断言卸载后 8 个依赖键值与 8 个 bundles
  条目与预置内容**逐字相同**、lockfile 不含该 specifier、`verify:desktop` 报 `installed=false`；日志出现
  `移除项`、`其它插件断言=逐字未变`、`数据目录已保留`
  验收标准: 上述断言全部通过；卸载全程不触碰 `~/.dsh/note-taker`（用例中该路径不存在时也不创建）

## 3. 安全阀

- [x] T-05 桌面版运行检测与 `--force`
  关联: R-02
  依赖: T-02
  验证方式: 单测注入「检测到在运行」的 processProbe → 默认退出码 2 且提示先关闭；加 `--force` → 继续执行；
  注入「未运行」→ 正常继续；日志含 `检测到桌面版在运行`
  验收标准: 三条路径行为与退出码符合；提示文案说明 `--force` 的风险

## 4. 文档与真机

- [x] T-06 补 README 桌面版章节（安装/升级/卸载/数据保留）
  关联: R-01, R-05, R-06
  依赖: T-03, T-04
  验证方式: `PYTHONUTF8=1 python <skill>/scripts/mdtable_check.py README.md` 退出码 0；
  照章节文字在临时 profile 上走一遍，步骤不缺
  验收标准: 含三条命令、重启生效说明、卸载默认保留数据与手工清理方法、`verify:desktop` 输出字段解释

- [ ] T-07 桌面版重启后真机验证
  关联: R-01, R-03, R-06
  依赖: T-01, T-02, T-03, T-05
  验证方式: 用户重启桌面版 → 设置页出现「会记」且 `健康` 显示云端/流式状态；会话卡片录 5 秒并停录，产物落盘；
  贴出（a）`verify:desktop` 输出（b）桌面版启动日志含 `插件启动`、`路由注册完成 routes=10`（c）录音产物路径
  验收标准: 三项证据齐全；若插件未激活，须能凭 `verify:desktop` 输出定位到是「未装/未链接/未重启」哪一类

## 覆盖自检

| 需求 | 覆盖任务 |
|---|---|
| R-01 幂等安装 | T-01, T-02, T-06, T-07 |
| R-02 备份与回滚 | T-01, T-05 |
| R-03 装后自检 | T-03, T-07 |
| R-04 前置不满足则拒绝 | T-01 |
| R-05 干净卸载 | T-04, T-06 |
| R-06 升级即生效 | T-03, T-06, T-07 |
| R-07 可审计不泄密 | T-02, T-03 |
| R-08 Key 来源提示 | T-03 |
| R-09 兼容告警 | T-03 |

无「找不到对应 R 的任务」：T-05 对应 R-02 的风险条款（边跑边改 node_modules 的规避），T-06 对应文档义务。