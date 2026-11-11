# 完成清单: meeting-agent-import（spec v1.0.0）

> 生成: 2026-11-11 | 全部 5 项完成，端到端由用户实机确认

## ✅ 已完成（5/5）

| 任务 | 验证证据 |
|---|---|
| T-01 导入规则（纯函数） | 7 用例：标签推导（去后缀 / 无后缀 / 时间回退）、扩展名后备 `.bin`、大小判定（通过 / 超限 / 0 字节 / 边界）、附件 id 与路径的提示区分 |
| T-02 importAudio 扩展 | 8 用例：正常导入返回产物路径、无后缀 `.bin` 落盘且时长正确、不存在/空文件/目录都不建会议、超限拒绝并带实际大小、`transcribe=false` 不转写、转写失败不回滚导入、显式 `workspaceDir` 生效、旧 `transcripts/<id>.md` 里的纪要能被 list 识别 |
| T-03 `meeting_import` 工具 | 契约断言：`output` 同时含 `type`/`schema`/`render`、`timeoutMs` 45 分钟、描述含 `outputFile` 与 `## 纪要`、缺省参数自动转写；另验证从 `execute(args, exec)` 取 `exec.agent.session.header.cwd` 与 `sessionId` 透传 |
| T-04 会话里导入并写纪要 | **用户 2026-11-11 实机验证通过**：会话内调用 `meeting_import` 成功，产物落工作区，agent 读文件并写回纪要 |
| T-05 文档与收尾 | README 增「在会话里导入音频」一节（参数、返回字段、纪要需自己写）；`npm run verify` 全绿 |

## 关键技术结论

**无扩展名可解码**（Phase 2 前就做了探针）：

```
python py/decode_pcm.py --audio .tmp/blob_noext --out .tmp/blob_noext.pcm
→ {"ok": true, "bytes": 1920000, "durationSec": 60.0}
```

宿主附件以无后缀 blob 落在 `~/.dsh/attachments/v1/objects/`，PyAV 靠内容嗅探容器，所以不需要猜格式或补假后缀。

**工具能拿到会话上下文**：

```js
execute: (args = {}, exec) => service.importAudio({
  ...,
  workspaceDir: exec?.agent?.session?.header?.cwd,
  sessionId: exec?.agent?.session?.id,
})
```

`header.cwd` 比「按 sessionId 去 workspace 注册表匹配」更直接——不必赌匹配得上。

## 过程记录

| # | 问题 | 真因 | 修复 |
|---|---|---|---|
| 1 | 分支开错 | 新 spec 从 `1.0.0` 开，但依赖的 `lib/output.js` 还在未合并的 `feature/meeting-workspace-output` 上，测试直接 `Cannot find module` | 先收口合并 workspace-output，再从新 `1.0.0` 重建分支 |
| 2 | 导入产物没落工作区 | `meeting_import` 只传参数、不传会话，转写走回落路径 | 从 `exec` 取 `cwd`/`sessionId` 透传 |
| 3 | 历史纪要列表显示 0 | agent 直接写文件，`status.minutes` 一直 pending，列表按状态过滤 | 改为按文件判断 + 状态自愈 |
| 4 | 界面显示「本地」实际走云端 | `capabilities()` 读启动时的 env，不读生效配置 | 改用 `resolveDefaultEngine({source})` 并回显 `engineSource` |
| 5 | 两个用例偶发失败 | 「导入后自动转写」真跑本机模型，并行执行时超时 | 注入假云端（`cloudFetch` + `cloudSource`），确定性 |

## 遗留

- 转写仍然「停录后整段识别」，实时流式见 BL-06。
- `transcribe` 缺省开启会自动消耗云端额度，已在工具描述里写明。
