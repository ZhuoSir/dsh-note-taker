# 项目坑台账（Lessons）

> L-xx 永久编号不复用 | 每条 ≤10 行 | active 条目在每次 Plan 被强制核对（bryanchen-spec §3）
> 边界：产品缺陷进 bugs.md，过程/工具/环境/判断跟头进这里，互相引用不混记

## L-01 sherpa-onnx 在 Python 3.14 上装得上但跑不起来

- 分类: 环境
- 触发场景: 在 Python 3.14 上 `import sherpa_onnx` 后加载分人模型
- 坑: 报 `The requested API version [28] is not available, only API versions [1,17] are supported`。
  先后试了 2.0.1 与 1.13.8 两个 cp314 轮子、也试过重新解包，现象完全相同，白折腾约一轮。
- 根因: 轮子内嵌的 onnxruntime 是 1.17.1，但库代码按更新的 ORT 头文件编译，属平台侧打包问题。
- 防再犯规则: 遇到「装成功但 import/初始化炸在 native 库版本」时，先查轮子内嵌后端版本，
  不再换同系列版本重试；分人一律走独立 Python 3.12 进程（`DSH_NOTE_TAKER_DIARIZE_PYTHON`）。
- 状态: active
- 复发: ×1
- 关联: 迁移自 `docs/dsh-note-taker-方案.md` §3.3 卡点 1；profile 技术债 2

## L-02 工作区 ACL 让 pip 装包失败

- 分类: 工具链
- 触发场景: 在 `D:\workspace\my_workspace\*` 下 `pip install`
- 坑: `Errno 13 Permission denied`，安装中断；表象像缺权限，实际是 pip 的临时文件原子 rename 被拦。
- 根因: 工作区目录带 `Everyone Deny DeleteSubdirectoriesAndFiles`，rename/删除类操作被拒。
- 防再犯规则: 该工作区装 Python 包一律走离线路径——`urllib` 下 wheel → `zipfile` 解到
  `pylibs`（或独立运行时目录）→ 用 `PYTHONPATH` 或 `.pth` 引入；不要反复重试 pip。
- 状态: active
- 复发: ×1
- 关联: 迁移自 `docs/dsh-note-taker-方案.md` §3.3 卡点 2

## L-03 工作区目录缺权限导致沙箱起不来（不是命令写错）

- 分类: 环境
- 触发场景: 在新的工作区目录里执行任何 shell 命令
- 坑: `SetNamedSecurityInfoW failed (Win32 5): grantWrite(<工作区>)`，连 `python --version` 都跑不了；
  文件读写工具却正常，容易误判成「命令语法问题」而去改命令。
- 根因: 沙箱启动时要给工作区授予写权限，而该目录的有效权限里缺 `WRITE_OWNER`。
- 防再犯规则: 出现 `grantWrite(...)` 类报错时，立刻判定为目录权限问题并用一条诊断脚本修
  （writes 备份 + 验证 + 恢复命令），不要去改被执行的命令本身。
- 状态: active（该工作区已修，机制仍在）
- 复发: ×1
- 关联: 2026-11-10 本仓库 init 时修复，恢复件在 `D:\workspace\my_workspace\dsh-note-taker-acl-logs\`

## L-04 造不出测试音频，导致分人精度只能估算

- 分类: 验证盲区
- 触发场景: 想用 Windows SAPI（`System.Speech`）合成一段多人对话来测 DER
- 坑: 能列出 Huihui / Zira 两个音色，但 `Speak` 时报「没有当前安全设置可用的语音」，
  合成失败；于是分人的准确率始终没有实测数据，只能给区间估算。
- 根因: 该环境下 SAPI 语音未安装/不可用（不是代码问题）。
- 防再犯规则: 涉及「音频/语音质量」的需求，先确认手上有真实样本再用真实样本定验收标准；
  拿不到样本时在 requirements 的假设节写明「指标为估算」，不得在完成报告里当实测值汇报。
- 状态: 休眠（前提已变：L-09 复现成功，SAPI 合成当日可用）
- 复发: ×1
- 关联: profile 技术债 5；结论已被 L-09 推翻

## L-05 起名前不查注册表会撞名

- 分类: 流程
- 触发场景: 给插件定 npm 包名
- 坑: 先想到的 `dsh-scribe`、`dsh-meeting-notes`、`dsh-meeting-minutes` 全被占用；
  其中 `dsh-meeting-notes` 与自己想要的 `dsh-meeting-note` 只差一个 `s`，装错不会报错，只是没功能。
- 根因: 先构思名字再验证可用性。
- 防再犯规则: 命名类决策必须先查注册表（npm/pypi）并同时查「相似名」（单复数、连字符变体），
  查到冲突再进方案。
- 状态: active
- 复发: ×1
- 关联: 迁移自上一轮会话；最终名 `dsh-note-taker`

## L-06 开发期写 `~/.dsh` 会被沙箱拒绝

- 分类: 环境
- 触发场景: 开发插件时让它把数据写到 `~/.dsh/note-taker/`
- 坑: `PermissionError: 拒绝访问`，插件一跑就失败，误以为是代码路径写错。
- 根因: 会话工作区之外的路径是只读的；生产环境里由宿主进程写入则不受此限。
- 防再犯规则: 开发期一律用 `NOTE_TAKER_DATA` 指向工作区内目录；数据根必须做成可配置，
  不允许硬编码 `homedir()`。
- 状态: active
- 复发: ×1
- 关联: 迁移自上一轮会话；`lib/index.js` 的 `DATA_ROOT` 需按此改造

## L-07 表检脚本在 GBK 控制台下崩溃，退出码 1 会被误读成「表格不合格」

- 分类: 工具链
- 触发场景: 在 Windows 默认控制台跑 `bryanchen-spec/scripts/mdtable_check.py`
- 坑: 脚本打印 `✓` 时抛 `UnicodeEncodeError: 'gbk' codec can't encode character '\u2713'`，
  退出码 1。一眼看去像表格有错，实际连一个文件都没检查完，差点因此去改没问题的表格。
- 根因: Windows 控制台默认 GBK，Python stdout 编码与实际输出字符不匹配。
- 防再犯规则: 跑带中文/符号输出的 Python 脚本前先设 `PYTHONUTF8=1`
  （或 `PYTHONIOENCODING=utf-8`）；判定表格闸以输出里的「✓ 全绿」为准，不单凭退出码下结论。
  多个文件要**逐个传参**，不要拼成 `a.md,b.md` 一个串——脚本按单一路径读，拼串会报
  `No such file or directory` 并被误当成表格缺陷（2026-11-10 踩过一次）。
- 状态: active
- 复发: ×2
- 关联: bryanchen-spec 铁律 8（表格闸）；2026-11-10 init 与 project-skeleton 确认① 各踩一次

## L-08 HuggingFace 直连不可用，hf_hub 下载器会静默卡死

- 分类: 环境
- 触发场景: 让 faster-whisper 自动下载模型（`WhisperModel('tiny')`）
- 坑: hf_hub 的下载进程卡在 0 字节，跑了 15 分钟零进展，既不报错也不退出，只能杀掉。
  同一条 model.bin 用 `urllib` 直连 hf-mirror 能下，稳定在 ~1 MB/s。另外 `huggingface.co`
  直连实测 12 秒超时，`hf-mirror.com` 0.8 秒返回 200。
- 根因: 直连被墙 + hf_hub 的元数据/xet 端点超时后表现为静默挂起，不是「慢」。
- 防再犯规则: 大模型文件不依赖运行时 Hub 下载——仓库自带 `py/fetch_model.py` 直连镜像下到
  本地目录，转写侧优先按本地目录加载；默认端点写死镜像，可用 `NOTE_TAKER_HF_ENDPOINT` 覆盖。
  等待下载必须有进度输出与上限，不设上限等于把会话挂死。
- 状态: active
- 复发: ×1
- 关联: commit 13726c9（本地模型目录）/ T-07

## L-09 「环境不支持」的结论会随时间失效

- 分类: 验证盲区
- 触发场景: 想用 Windows SAPI 合成一段中文测试语音
- 坑: 上一轮会话用同样思路失败（报「没有当前安全设置可用的语音」），于是把「造不出测试音频」
  写成了台账条目（L-04）并据此规划验收；这一轮同样的 PowerShell 命令一次成功，产出 533 KB wav，
  成了唯一可用的真实语音样本。差别原因至今不明。
- 根因: 未查明；可能是语音包加载状态、会话环境或系统设置变化。
- 防再犯规则: 「环境不支持 X」的结论必须同时记录**命令原文 + 发生时间 + 报错原文**；
  下次需要时先原样重试一次，再决定是否沿用旧结论。不要把一次失败写成永久事实。
- 状态: active
- 复发: ×1
- 关联: L-04（其「造不出测试音频」的结论本轮已被推翻，需重评）
