# AGENTS.md —— 本项目的 spec 开发纪律

本项目使用 **bryanchen-spec** 四阶段规格开发流程（需求 → 方案 → 任务 → 实现）。
完整规则见已安装的 skill `bryanchen-spec`，本文件只固化最容易被违反的部分。

## 铁律

1. **三重确认门**：`specs/<目录>/requirements.md`、`plan.md`、`tasks.md` 三份版本头必须全部
   `状态: 已确认` 且确认人非空，才允许写生产代码。缺任何一份 → 停住并说明缺哪份。
2. **确认人是用户，不是 agent**。只有用户明确说「确认 / 通过 / OK」才可写入确认人姓名。
3. **三重确认之前只许写 `specs/` 下的文档**：禁改源码、禁升级依赖、禁动构建配置。
4. **已确认文档被修改** → 版本头改回 `状态: 待重确认` 并按规则 bump 版本，重新走确认。
5. **诚实性**：不得声称「测试通过 / 验证通过 / 完成」，除非贴出真实命令输出。
   lint / build 通过只是兜底，不是行为验证。
6. **需求本身要变** → 走 CR（`specs/<父目录>/changes/CR-xx_*.md`），不在施工中擅自改需求。

## 产物位置

```
specs/_project/              项目级台账（profile / version / lessons / bugs / backlog）
specs/<YYYYMMDD>_<功能名>/    每个需求的四件套 + changes/ + completion.md
releases/vX.Y.Z/             里程碑（首次「新建里程碑」时才创建）
docs/                        方案、设计等长期文档
```

## 项目特有约束

- **代码不在本仓库**：插件代码位于 `D:\workspace\my_workspace\ai_dsh_test\dsh-note-taker`
  （用户 2026-11-10 决定「只建机制，代码不动」）。本仓库只承载 spec 文档与台账。
  首次 Implement 前必须先解决代码侧无版本控制的问题，见
  `specs/_project/profile.md` §已知技术债。
- **运行数据永不入库**：录音、转写、模型（`note-taker-data/`、`*.wav`、`*.onnx`）。
- **方案基线**：`docs/dsh-note-taker-方案.md`（M0~M4 里程碑与关键决策的出处）。

---
详见 skill `bryanchen-spec`。
