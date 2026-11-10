> 版本: v0.1.0 | 状态: 草稿 | 更新: 2026-11-10

# 任务清单：meeting-workspace-output

## 1. 探针

- [ ] T-01 workspace 服务探针：会话工作目录到底能不能拿到
  关联: R-01
  依赖: 无
  验证方式: 在 `apply` 里用可选注入 `ctx.inject(['workspace'], …)` 取服务，打印 `list()` 的条数与
  每条 `{ id, path, sessionIds }`；再对当前会话 id 做一次命中查找，把结果写进启动日志
  与 `GET /note-taker/health`（新增 `workspace: { available, matched, path }`）
  验收标准: 明确得出「能按 sessionId 拿到目录」或「拿不到」，结论写进 completion.md
  备注: **不通过就只做手填目录的退化路径**，不带着假设往下写

- [ ] T-02 产物路径与单文件结构
  关联: R-01, R-02, R-05, R-06
  依赖: 无
  验证方式: `node --test tests/output.test.js` —— 覆盖：
  路径解析（workspace 模式 → `<dir>/meetings/<id>.md`；fallback → `<dataRoot>/meetings/<id>.md`）、
  单文件渲染（元信息四项 + `## 转写` + 空 `## 纪要`）、纪要合并（首次写入 / 覆盖已有纪要 / 转写段落逐字不变 /
  文件里始终只有一个 `## 纪要`）、目录不存在时创建、写入失败返回含目标路径的错误
  验收标准: 四类用例全绿；合并函数是纯函数（不直接碰 fs）

## 2. 宿主侧

- [ ] T-03 service 接入输出解析与单文件落盘
  关联: R-01, R-02, R-04, R-05
  依赖: T-02
  验证方式: `node --test tests/service-output.test.js` —— 注入假 resolver：
  返回目录 → 产物写进 `<dir>/meetings/<id>.md` 且 `transcripts/<id>.json` 仍在数据目录；
  返回 null → 写进数据目录 `meetings/` 并标记 `outputMode: 'fallback'`；
  写入抛错 → 返回 `E_STATE` 且错误里含目标路径，不产生半截文件；纪要二次写入不丢转写
  验收标准: 五类用例全绿；既有 224 个测试不回归

- [ ] T-04 路由透传 sessionId
  关联: R-01, R-04, R-06
  依赖: T-03
  验证方式: `node --test tests/output-routes.test.js` —— `POST /transcribe` 带 sessionId 时透传到 service；
  `GET /detail?sessionId=` 时从工作区读产物；**不传 sessionId 时行为与改造前一致**（回归断言）；
  sessionId 非法字符被拒
  日志断言: 出现「工作区解析」含 mode 与 sessionId；回落时出现 WARN
  验收标准: 四类用例全绿；日志断言通过

## 3. 客户端

- [ ] T-05 客户端带上 sessionId
  关联: R-01, R-04
  依赖: T-04
  验证方式: `node --test tests/page-api.test.js` 增补 —— `transcribe({id, engine, sessionId})` 与
  `detail({id, sessionId})` 的请求体/查询串包含 sessionId；不传时不出现该字段
  验收标准: 两类用例全绿

- [ ] T-06 交接消息改为引用文件
  关联: R-03, R-06
  依赖: T-02
  验证方式: `node --test tests/handoff.test.js` 重写 —— 消息含会议 id、标签、时长、产物路径
  （workspace 模式相对路径 + 工作区根；fallback 模式绝对路径）、含「读取该文件并写入 ## 纪要」指令；
  **消息长度 < 500 字且与转写长度无关**（47 分钟样本断言）；缺产物路径时回退为内联（兼容旧行为）
  验收标准: 五类用例全绿

- [ ] T-07 卡片接线：展示产物位置并走新交接
  关联: R-01, R-03
  依赖: T-05, T-06
  验证方式: 真实宿主里识别完成后，卡片显示「产物：meetings/<id>.md（工作区）」或
  「（回落）数据目录」；点「交给会话」后消息里只有路径与指令，不再贴全文
  验收标准: 两种模式都能显示；交接消息短且路径可点开

## 4. 收尾

- [ ] T-08 端到端：产物真的落在工作区并被 agent 读到
  关联: R-01~R-06
  依赖: T-01, T-07
  验证方式: 真实会话里录一段 → 识别 → 检查工作区 `meetings/<id>.md` 存在且结构正确 →
  点交给会话 → agent 能打开该文件并回写纪要 → 文件里出现 `## 纪要` 正文且转写仍在
  验收标准: 全链路在界面上完成
  备注: **需要用户配合新开会话**；探针未通过时本任务改为验证手填目录路径

## 自检

| R | 覆盖任务 |
|---|---|
| R-01 | T-01, T-03, T-04, T-07 |
| R-02 | T-02, T-03 |
| R-03 | T-06, T-07 |
| R-04 | T-03, T-04 |
| R-05 | T-02, T-03 |
| R-06 | T-02, T-04, T-05, T-06 |

- 每条 R 至少被一个 T 覆盖；无 T 找不到对应 R
- 依赖只指向更小编号，无循环（T-03→T-02；T-04→T-03；T-05→T-04；T-06→T-02；T-07→T-05/T-06；T-08→T-01/T-07）
- 任务数 8，在 3~20 区间
- 有日志断言的任务：T-04（工作区解析与回落）；T-07/T-08 为真实宿主验证
