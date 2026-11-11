# 完成报告: desktop-adaptation（桌面版适配：安装与升级）

> 状态: 已实现并验证，已合并进 v1.0.0
> 分支: `feature/desktop-adaptation`
> 版本: 挂载 v1.0.0（spec 文档 v1.0.0，三重确认已完成）

## 一句话

把「装进桌面版」从手工改 profile 变成三条命令：`install:desktop` 幂等安装（装前备份、失败回滚）、
`verify:desktop` 只读自检（五项断言 + Key 来源 + 兼容告警）、`uninstall:desktop` 干净摘除（不动录音数据）。

## 交付内容

| 层 | 文件 | 说明 |
|---|---|---|
| 逻辑 | `lib/desktop.js` | 安装/卸载/自检纯逻辑；fs·pnpm·进程探测·时钟全部可注入，因此单测不 spawn、不碰真实 profile |
| 外壳 | `scripts/desktop.mjs` | CLI：`install`/`uninstall`/`verify`，`--profile-dir`/`--force`/`--json`；退出码 0/2/3 |
| 入口 | `package.json` | 三条 npm script；未新增任何依赖 |
| 文档 | `README.md` | 新增「装进桌面版（Electron）」：三条命令、五项自检表、退出码、Key 来源、卸载保留数据 |
| 测试 | `tests/desktop-install.test.js` | 12 例：安装/幂等哈希/非法 JSON/pnpm 失败回滚/卸载逐字断言/运行检测/CLI 退出码/链接断裂/Key 来源/兼容告警 |

## 关键技术点

- **改 `package.json` 用 JSON 读写，不手写 lockfile**：`pnpm-lock.yaml` 只让 pnpm 自己写
  （`pnpm install --lockfile-only --ignore-scripts`），避免破坏 lockfileVersion 9.0 结构，也避免重排 `node_modules`
  把另外 8 个插件的解析结果动掉。
- **链接用 junction**（Windows 建 symlink 需管理员/开发者模式），realpath 比较判定幂等，
  `D:` 大小写与短名差异不会误判成「没装」。
- **五项自检就是 L-10 的正面防守**：「配置写了但 apply 从没执行」这类假成功，靠「从 profile 目录 `import`
  能拿到 `apply/inject/name`」这一项挡住，任一 ✗ 退出码 3。
- **边跑边改的保护**：安装/卸载前探测 `DeepSeek Harness.exe`，默认拒绝（退出码 2），`--force` 才继续。

## 需求覆盖（R-01~R-09）

| 需求 | 证据 |
|---|---|
| R-01 幂等安装 | 单测「第二次安装两份清单 sha256 不变」+ 真机已装态 `verify:desktop` 五项 ✓ |
| R-02 备份与回滚 | 单测「非法 JSON 文件哈希未变」「pnpm 失败后清单回到安装前、链接已清」 |
| R-03 装后自检 | 五项断言；单测「删掉链接 → 该项 ✗ 且退出码 3」 |
| R-04 前置不满足则拒绝 | 单测「缺 dsh.profile 直接拒绝」「JSON 坏不改任何文件」 |
| R-05 干净卸载 | 单测断言其余 8 个依赖与 bundles 逐字不变、lockfile 摘掉、数据目录未被创建 |
| R-06 升级即生效 | 链接安装 + `verify` 输出生效路径/HEAD/版本；`--json` 可机读 |
| R-07 可审计不泄密 | 逐步日志（步骤=1/6…6/6）；单测断言「完整输出里不出现 Key 值」 |
| R-08 Key 来源提示 | `Key来源=page\|env\|none`；env 时提示「桌面版从图形界面启动，建议设置页填」 |
| R-09 兼容告警 | 宿主版本取 `dsh --version`；不在声明列表 → WARN 且退出码仍 0（单测锁定不阻断） |

## 验证证据

```
$ node --test tests/desktop-install.test.js
✔ 安装：写入依赖与 bundles、建链接、lockfile 有 specifier，自检五项全绿
✔ 幂等：第二次安装不写文件，两份清单哈希不变
✔ 非法 JSON：报错退出且文件内容未变（不留改一半）
✔ pnpm 失败：回滚清单并清掉链接
✔ 卸载：其它 8 个插件逐字未变、lockfile 摘掉依赖、数据目录不动
✔ 桌面版在运行：默认拒绝（退出码 2），--force 才继续
✔ readProfile：缺 dsh.profile 直接拒绝
✔ keySource：设置页 > 环境变量 > 都没有
✔ 自检：链接被改名后该项 ✗，退出码 3
✔ 自检：Key 只在环境变量里 → 提示去设置页填，且输出不含 Key 值
✔ 自检：宿主版本不在声明列表 → WARN 但不阻断
✔ CLI：无参退出 2；未装时 verify 退出 3；装好后 verify 退出 0（--json 可机读）
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

```
$ npm run verify
结构检查: 41 项全部存在
构建校验: lib/client.js 可重复构建（9f3c81211fed）
ℹ tests 344
ℹ pass 344
ℹ fail 0
```

真机只读自检（desktop profile，插件已链接）：

```
$ npm run verify:desktop
INFO 自检 ✓ 依赖条目 值=link:D:/workspace/my_workspace/dsh-note-taker
INFO 自检 ✓ bundles 条目 值=共 10 项
INFO 自检 ✓ node_modules 链接 值=ok
INFO 自检 ✓ lockfile 条目 值=已读取
INFO 自检 ✓ 可解析出宿主导出 值=apply,inject,name,resolveConfig,version
INFO 配置来源 Key来源=none
INFO 兼容检查 宿主版本=0.1.7-rc.2 说明=已在声明列表内
exit=0
```

真机安全阀（桌面版运行中执行安装）：

```
$ npm run install:desktop
INFO 步骤=1/6 定位 profileDir=C:\Users\KypCa\.dsh\profiles\desktop repoDir=D:\workspace\my_workspace\dsh-note-taker
ERROR 检测到桌面版在运行，已中止（边跑边改 node_modules 有风险） 进程数=6
exit=2
```

T-07 真机（用户执行）：用户 2026-11-11 重启桌面版后自测「目前还行」，确认桌面版内可用。

## 取舍与代价

- **不做托盘/通知/失焦轮询**（用户在多选项里只勾了 A「安装与升级」）：这些属交互层适配，另立项再说。
- **不补 `dsh.compatibility` 的桌面版版本**：先只告警不阻断，避免误判门禁导致插件不激活；转 BL-07。
- **安装器不一键代装 Python/依赖**：只在自检里报告，缺什么由用户决定怎么补（代装有副作用，且不同机器差异大）。
- **`--lockfile-only` 而非 `pnpm add`**：代价是链接要自己建（junction），好处是不动其它 8 个插件的解析结果。

## 未做 / 后续

- 桌面版进程探测只认 Windows 的 `DeepSeek Harness.exe`；其它平台恒判「未运行」（`defaultProcessProbe` 直接返回 false），
  侵入性更低的方案（应用锁文件）等有需求再说。
- `verify:desktop` 的 HEAD 目前由 CLI 侧从子进程读，未在 `--json` 里单列字段；如需 CI 消费再补。
- BL-07：把桌面版实际版本补进兼容声明。