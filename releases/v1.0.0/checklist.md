# 发版检查单 v1.0.0

> M4 执行时逐项勾选。**演练项必须真做**（唯一人工留证项），演练踩的坑当场记 `specs/_project/lessons.md`。
> 台账在 tag 之前落账完毕（账不齐不打 tag）。

## 一、代码与构建

- [x] `npm run verify` 全绿（结构检查 / 构建可重复 / 全量测试 0 失败）
- [x] 工作树干净（`git status --porcelain` 为空）
- [x] `lib/client.js` 构建哈希与上次一致（可重复构建）
- [x] `package.json` 依赖无新增未登记项（本版仅 `ws`）

## 二、里程碑台账

- [x] 8 个 spec 的 MILESTONE 状态能翻终态「已发布(v1.0.0)」
- [x] `RELEASE-NOTES.md` 的「包含需求」覆盖纳入表 8 行
- [x] `UPGRADE.md` 部署顺序/验证/回滚齐全（本版无 SQL，须注明）
- [x] `config/changes.md` 已列新增配置项（3 条流式变量 + 页面配置说明）
- [x] `version.md` 翻「已发版」+ 「最近已发: v1.0.0」
- [x] 项目根 `CHANGELOG.md` 有条目（来源 = MILESTONE 升级项）
- [x] `bugs.md` 本版「已验证」批量翻「已发布」（本版 0 行，注明无）
- [x] `backlog.md` 本版已立项 spec 对应 BL 行翻「已交付(v1.0.0)」

## 三、演练（必须真做，留证）

- [x] **演练一：宿主安装路径**——新建 profile `m4drill` → `dsh plugin --profile m4drill add <repo>`（输出 `+ dsh-note-taker link:…`，pnpm 466ms）→ 宿主启动日志出现 `插件启动 tools=7` → `GET /note-taker/health` 200、`/list` 200、`/config` 200。**偏差（如实记）**：`页面 401` 是宿主的 browser-trust fence（需浏览器会话），未做浏览器截图；「设置页可见」由路由与快照证据代替
- [x] **演练二：桌面版安装路径**——以用户 T-07 实测为准（2026-11-11 重启桌面版后自测通过），并由本会话旁证：`meeting_*` 工具正是该插件在桌面版内注册的，`meeting_import` 调用成功。**偏差（如实记）**：本轮未重复「退出应用重装」（退出即中断当前会话），`install:desktop` 的运行中拒绝路径已在实现期验过（退出码 2）
- [x] **演练三：端到端**——`meeting_import` 导入 28.8s 真实录音（`20261111-1117-3478.wav`）→ 云端转写完成（4 段 / 50 字）→ 产物 `meetings/20261111-1137-df60.md`。**偏差（如实记）**：未现场「录 5 秒」——麦克风听不到本机扬声器（T-07 前一轮已实证得到静音），故用真实录音走同一条链路
- [x] **演练四：回滚**——`dsh plugin --profile m4drill remove dsh-note-taker` → 清单只剩 `@deepseek-ai/dsh-base`、启动日志不再出现 `插件启动`（对照移除前有）→ `~/.dsh/note-taker` 仍在、`meetings/` 8 个产物未动。演练 profile 已删除（用完即弃）。**偏差（如实记）**：桌面版卸载路径因应用在运行无法重复演练
- 演练留证：验证人 陈卓（演练二以用户实测为准；一/三/四由 agent 执行并留真实输出） / 日期 2026-11-11 / 结论 通过（4 项均留证，3 项有偏差说明）

## 四、发布动作

- [ ] `git tag -a v1.0.0`（打在版本分支落账 tip 上）
- [x] tag 后 **不改任何账**（tag 后修账 = 事故，须记 MILESTONE 审计节并回炉）
- [ ] 问用户是否合 `main`（口令才动）→ 合并后 `git diff v1.0.0 main -- releases/v1.0.0/ specs/_project/version.md` 应为空
- [ ] 问用户是否 `push`（含 tag）→ 推后 `git ls-remote` 复核
- [ ] 收口：悬空账登记（未合 main 则挂账）、施工分支清理

## 五、变更↔断言配对核验（共享面）

| 本版触碰的共享面 | 回归载体（实核） | 状态 |
|---|---|---|
| 宿主 HTTP 路由 `/note-taker/*` | `tests/routes.test.js` 断言 8 条路径 + `routes-stream.test.js` + `output-routes.test.js` + `config-routes.test.js`；本次演练实测 `/health` `/list` `/config` 均 200 | ✓ 有配对 |
| `desktop/package.json` 依赖与 bundles 清单 | `tests/desktop-install.test.js`：卸载后 8 个既有依赖与 bundles 逐字断言 + lockfile 摘除断言 | ✓ 有配对 |
| 工具契约 `meeting_*` / `meeting_import` | `tests/tools.test.js`：7 个工具注册 + `output.render` 必须是函数 + 执行路径断言 | ✓ 有配对 |
| 会话输入框插槽 `conversation.input.right` | `tests/client-bundle.test.js`（产物可重复构建/模块格式）+ `page-render.test.js`；**未做真实浏览器渲染回归**（宿主首页需浏览器会话，直接 HTTP 401） | ✓ 有配对（渲染回归为偏差项，如实记） |