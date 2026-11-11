# 发版检查单 v1.0.0

> M4 执行时逐项勾选。**演练项必须真做**（唯一人工留证项），演练踩的坑当场记 `specs/_project/lessons.md`。
> 台账在 tag 之前落账完毕（账不齐不打 tag）。

## 一、代码与构建

- [ ] `npm run verify` 全绿（结构检查 / 构建可重复 / 全量测试 0 失败）
- [ ] 工作树干净（`git status --porcelain` 为空）
- [ ] `lib/client.js` 构建哈希与上次一致（可重复构建）
- [ ] `package.json` 依赖无新增未登记项（本版仅 `ws`）

## 二、里程碑台账

- [ ] 8 个 spec 的 MILESTONE 状态能翻终态「已发布(v1.0.0)」
- [ ] `RELEASE-NOTES.md` 的「包含需求」覆盖纳入表 8 行
- [ ] `UPGRADE.md` 部署顺序/验证/回滚齐全（本版无 SQL，须注明）
- [ ] `config/changes.md` 已列新增配置项（3 条流式变量 + 页面配置说明）
- [ ] `version.md` 翻「已发版」+ 「最近已发: v1.0.0」
- [ ] 项目根 `CHANGELOG.md` 有条目（来源 = MILESTONE 升级项）
- [ ] `bugs.md` 本版「已验证」批量翻「已发布」（本版 0 行，注明无）
- [ ] `backlog.md` 本版已立项 spec 对应 BL 行翻「已交付(v1.0.0)」

## 三、演练（必须真做，留证）

- [ ] **演练一：宿主安装路径**——干净 profile 上 `dsh plugin add` + 重启，设置页出现「会记」
- [ ] **演练二：桌面版安装路径**——退出桌面版 → `npm run install:desktop` → `verify:desktop` 五项 ✓ → 启动可见
- [ ] **演练三：端到端**——录 5 秒 → 转写 → 产物落 `meetings/`，贴产物路径
- [ ] **演练四：回滚**——`npm run uninstall:desktop` + 切回旧提交 + 重启，确认插件消失且数据目录未丢
- 演练留证：验证人 ____ / 日期 ____ / 结论 ____

## 四、发布动作

- [ ] `git tag -a v1.0.0`（打在版本分支落账 tip 上）
- [ ] tag 后 **不改任何账**（tag 后修账 = 事故，须记 MILESTONE 审计节并回炉）
- [ ] 问用户是否合 `main`（口令才动）→ 合并后 `git diff v1.0.0 main -- releases/v1.0.0/ specs/_project/version.md` 应为空
- [ ] 问用户是否 `push`（含 tag）→ 推后 `git ls-remote` 复核
- [ ] 收口：悬空账登记（未合 main 则挂账）、施工分支清理

## 五、变更↔断言配对核验（共享面）

| 本版触碰的共享面 | 回归载体 | 状态 |
|---|---|---|
| 宿主 HTTP 路由 `/note-taker/*`（10 条） | `tests/routes.test.js` + 宿主冒烟 | 待核 |
| `desktop/package.json` 的依赖与 bundles 清单 | `tests/desktop-install.test.js`（8 个既有身份逐字断言） | 待核 |
| 工具契约 `meeting_*` / `meeting_import` | `tests/tools.test.js`（output 必带 render） | 待核 |
| 会话输入框插槽 `conversation.input.right` | 前端构建 + 页面回归 | 待核 |