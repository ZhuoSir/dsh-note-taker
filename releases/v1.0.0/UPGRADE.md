# 升级操作手册 v1.0.0

> 适用对象: 使用方与运维 | 部署形态: **DSH 插件**（不是独立服务，没有数据库）
> 部署基线: **tag `v1.0.0`**（2026-11-11 打于本版落账 tip）

## 一、部署前须知

| 项 | 本版情况 |
|---|---|
| SQL 升级件 | **无**（没有库表；数据全是文件，落 `~/.dsh/note-taker/`） |
| 部署配置变更 | **无强制项**（新增 3 个可选环境变量，默认关闭，见 `config/changes.md`） |
| 服务重启 | **必须**（插件由宿主加载，重启才激活） |
| 数据迁移 | **无**（首次发布；数据目录由插件首次运行时自建） |
| 回滚难度 | 低（切回旧提交 + 重启；卸载不删数据） |

## 二、部署顺序

### 1. 准备环境

| 依赖 | 要求 | 缺失影响 |
|---|---|---|
| Node | ≥ 20 | 插件无法加载 |
| Python | ≥ 3.10 | 本机录音/转写不可用（云端仍可用） |
| pnpm | 桌面版安装需要 | `install:desktop` 会在「PATH → profile 内 pnpm」之间降级，都没有则报 `E_DEP` |
| `DASHSCOPE_API_KEY` | 云端能力需要 | 云端转写与流式识别不可用（本机引擎照旧） |

### 2. 取得代码

```powershell
git fetch --tags
git switch -c 1.0.0 --track origin/1.0.0    # 或 git checkout v1.0.0（tag 打完后）
npm install                                  # 装运行时依赖（含 ws）
npm run verify                               # 结构检查 + 构建可重复 + 全量测试
```

`npm run verify` 期望输出（本版实测）：

```
结构检查: 41 项全部存在
构建校验: lib/client.js 可重复构建（9f3c81211fed）
ℹ tests 344 / pass 344 / fail 0
```

### 3a. 装进普通 profile（web 等）

```powershell
dsh plugin --profile web add <本仓库路径>
dsh web --port 8099                     # 重启宿主使插件激活
```

### 3b. 装进桌面版（Electron）

```powershell
# 先完全退出桌面版（安装器检测到在跑会拒绝，退出码 2）
npm run install:desktop
npm run verify:desktop                  # 期望五项全 ✓
# 再启动桌面版
```

### 4. 配置（可选）

- 云端引擎：设置页「会记 → 配置」填 `DASHSCOPE_API_KEY` 并选云端（**产线推荐用页面配置**，
  桌面版从图形界面启动时读不到终端环境变量）
- 流式识别：同一页面开启「流式」（等价 `NOTE_TAKER_STREAM_ENABLED=true`）；默认关闭

### 5. 验证部署

| 验证点 | 方法 | 期望 |
|---|---|---|
| 插件加载 | 宿主启动日志 | 含 `插件启动` 与 `路由注册完成 routes=10` |
| 接口健康 | `GET /note-taker/health` | 返回 `engine`、`cloud`、`stream` 三段状态 |
| 页面可用 | 设置 → 会记 | 能打开，两个 tab 有内容 |
| 端到端 | 会话卡片录 5 秒停录 | 出现转写，`transcripts/` 有产物 |
| 桌面版（若用） | `npm run verify:desktop` | 五项 ✓，退出码 0 |

## 三、SQL 执行顺序

**本版无 SQL**，本节不适用（`releases/v1.0.0/sql/` 未创建）。

## 四、配置变更步骤

1. （可选）新增 3 个流式相关环境变量或页面配置，明细见 `config/changes.md`
2. 无强制变更；不配置即按缺省运行（本机引擎 + 不带流式）
3. 改完需重启宿主（页面配置例外：流式开关热生效）

## 五、回滚步骤

按逆序执行，任一步失败即停：

1. （桌面版）`npm run uninstall:desktop` —— 摘掉接线，**数据目录保留**
2. 切回上一提交：`git switch --detach <上一 tag / 提交>` 或 `git switch 1.0.0 && git reset --hard <旧提交>`
3. `npm install`（若依赖有差异）
4. 重启宿主 / 桌面版
5. 验证: `GET /note-taker/health` 正常、设置页能打开

数据安全：录音 `recordings/`、转写 `transcripts/`、产物 `meetings/`、配置 `config.json` 全在
`~/.dsh/note-taker/`，回滚不动它们；如需彻底清理再手工删该目录。

## 六、常见问题

| 现象 | 原因 | 处置 |
|---|---|---|
| 桌面版里看不到「会记」 | 未装 / 未链接 / 未重启 | 跑 `npm run verify:desktop` 看是哪一项 ✗ |
| `install:desktop` 退出码 2 | 桌面版在运行 | 完全退出应用后重跑（不建议 `--force`） |
| 云端转写报 `E_DEP` / `ASR_RESPONSE_HAVE_NO_WORDS` | 缺 Key / 音频无有效人声 | 设置页填 Key；确认录音不是静音 |
| 流式没字幕 | 未开启 / 缺 Key / 网络不通 | 看 `health.stream.reason`；日志里会说明降级原因 |
| 本机转写不可用 | Python 依赖缺失 | 看日志的 sidecar 报错；装 `py/requirements.txt` |