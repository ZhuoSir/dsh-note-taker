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

## L-10 插件进了 profile 配置，但 apply 从未执行

- 分类: 工具链
- 触发场景: 想让插件在 `dsh headless` 里跑起来，以便验证需要宿主 `ctx.llm` 的真实调用
- 坑: `dsh plugin --profile notetaker-verify add <本地目录>` 成功、`--dump-config` 里能看到
  `- id: note-taker / name: dsh-note-taker`、从 profile 目录也能 `import('dsh-note-taker')`
  拿到全部导出——但 headless 跑起来后：没有一条插件启动日志、数据目录没被创建（说明 `apply`
  根本没执行）、会话里也看不到 `meeting_*` 工具。把 `inject` 临时改成只剩 `['tools']` 同样如此。
  现象是「配置正确、模块可解析、静默不挂载」，没有任何报错可循。
- 根因: 未查明。已排除的：包解析失败、数据目录权限、`inject: llm` 缺失、json 损坏。
  未排除的：headless 模板下的 loader 挂载顺序、plugin 与 bundle patch 的合成差异。
- 防再犯规则: 用它验证「需要宿主服务」的插件时，先做一个**最小可观测探针**——
  在 `apply()` 第一行写一条日志或落一个标记文件，再跑一次；没有痕迹就说明不是业务代码问题，
  别再往下调业务。一次探针不通过就换路子（装进用户常用 profile / 让用户手工启用），
  不在 loader 行为上连续试错。
- 状态: active
- 复发: ×1
- 关联: T-11 验证受阻；临时 profile `~/.dsh/profiles/notetaker-verify` 保留为复现物

## L-11 tiny 档位的中文识别不可用：繁体 + 同音错字

- 分类: 验证盲区
- 触发场景: 用 `tiny` 档位转写一段中文会议口述（SAPI 合成，内容含「灰度」「张三负责」「11 月 15 日前」）
- 坑: 识别结果是繁体夹同音错字——「灰度」→「歸度」、「张三负责」→「張三副則」，
  「周会」→「週會」。段数与时间轴都对，但**内容层面不可用**，直接喂给纪要模型会产出错人名与错术语。
- 根因: **不是模型大小问题**，是 Whisper 对中文默认倾向输出繁体。换 `small` 症状完全一样；
  给一句简体提示（`initial_prompt='以下是普通话会议记录，请用简体中文输出。'`）后，
  `tiny` 与 `small` 都立刻输出简体且术语正确（周会/灰度/张三负责/11月15日前）。
- 防再犯规则: 中文转写必须带简体提示词（已固化为 `py/transcribe.py` 的 `DEFAULT_ZH_PROMPT`，
  调用方传 `--prompt` 时以调用方为准）；评估识别质量时**不能只看段数**，必须抽读正文。
- 状态: 退休（已升格为代码默认值：`transcribe.py` DEFAULT_ZH_PROMPT）
- 复发: ×1
- 关联: T-07/T-11；残留问题仅剩同音错字（决议→绝议），需靠 initial_prompt 里塞术语缓解

## L-12 云端 ASR 的词表上下文会破坏说话人分离

- 分类: 验证盲区
- 触发场景: 云端转写同时开启「词表上下文（input_text）」与「说话人分离（speaker_diarization_enabled）」
- 坑: 带 `input_text` 时 `output.sentences[].speaker_id` 全部是 `-1`（未识别），分人静默失效；
  去掉 `input_text` 后同一段音频立刻返回 `S0`/`S1`。两次请求都 HTTP 200，没有任何报错。
- 根因: 未查明（推测模型把上下文文本当成对话轮次，扰乱了说话人聚类）。
  已确认的是「两者互斥」这一事实，不是猜测。
- 防再犯规则: 同一请求里叠加多个增强参数时，必须逐项对照验证输出字段而不是只看 HTTP 200；
  本项目的处置是**分人优先**：开启分人时不再发送词表（`lib/asr/http.js` 有注释与单测锁定）。
- 状态: active
- 复发: ×1
- 关联: `lib/asr/http.js` 的 `if (!diarization && terms...)`；tests/asr-http.test.js 对应用例

## L-13 宿主工具契约会随版本变（output 必须带 render）

- 分类: 依赖漂移
- 触发场景: 把插件装进 web profile 后启动，得到的不是「页面看不到」而是整插件激活失败
- 坑: `ctx.tools.register()` 在 dsh-tools ≥ 0.2 强制要求
  `output = { schema, render, presentationMeta? }`；只写 `{ type: 'text' }` 会抛
  `TypeError: tool "xxx" must declare output { schema, render, presentationMeta? }`，
  且**一处失败连带整个插件不激活**（路由、客户端一起没了），表面症状却是「页面没有入口」。
- 根因: 我们的工具定义写于旧版契约，依赖宿主版本；升级宿主后契约收紧。
- 防再犯规则:
  1. 插件改动后先看启动日志里有没有 `warning: N entry did not activate`，不要只看 UI
  2. 发版前用**目标宿主版本**实跑一次激活，不只跑单测
  3. 需要同时兼容新旧宿主时，`output` 同时给 `type: 'text'`（旧版读）与 `schema/render`（新版读）
- 状态: active
- 复发: ×1
- 关联: `lib/tools.js` 的 `TEXT_OUTPUT`；tests/tools.test.js 对应用例

## L-14 用 PowerShell 给 JS/JSX 源码做批量替换会吃掉模板字符串反引号

- 分类: 工具链
- 触发场景: 用 `pwsh` 的 `-replace` / 字符串替换批量改 `src/client/*.jsx`
- 坑: 反引号在 PowerShell 双引号串里是转义符，`\`2px solid ${color}\`` 被替换成 `2px solid `，
  模板插值整段消失；esbuild 连报语法错，产物与源码一度对不上。一次会话内复发 4 次
  （meeting-console 3 次、本轮收尾 1 次把 4 份 tasks.md 写成 3 字节）。
- 根因: 两层转义叠加（PowerShell 字符串 + JS 模板字面量），且替换是**静默**的——不报错、只改坏。
- 防再犯规则: 改 JS/JSX/TS 源码一律用 `edit`（字面量替换）或 Node 脚本（`fs` + `String.replaceAll`），
  不用 PowerShell `-replace`；批量改文档同样用 Node，改完立刻 `git diff --stat` 核对行数，
  出现「整文件只剩几字节」立即 `git checkout --` 恢复。
- 状态: active
- 复发: ×4
- 关联: meeting-console changelog；本轮 tasks.md 事故（已从 HEAD 恢复）

## L-15 同一配置「展示值」与「执行值」分开读，会显示错引擎

- 分类: 判断
- 触发场景: 设置页/卡片显示当前引擎，而转写按每次请求重读配置执行
- 坑: 界面显示「本地」、实际走云端。`capabilities()` 读的是 **apply 时**从环境变量解析的
  `config.engine`（当时未设 → local），执行路径读的是「页面配置 > 环境变量 > 默认」的生效值
  （cloud）。两处都「没错」，只是数据源不同。
- 根因: 配置有两个生命周期——启动快照 vs 每请求解析；展示层误用了快照。
- 防再犯规则: 凡「展示值」，必须与执行路径共用同一个解析函数（本项目 `resolveDefaultEngine({source})`），
  并在返回值里带上来源字段（`engineSource: file/env/default`）便于自查。
- 状态: active
- 复发: ×1
- 关联: `lib/service.js` capabilities；tests 对应用例

## L-16 外部直接改产物文件会让状态位失真，真相要按文件推导

- 分类: 判断
- 触发场景: 纪要先由插件生成后改为「会话 agent 直接写进产物 md」，而列表按 `status.minutes` 过滤
- 坑: 文件里已有纪要，设置页历史列表仍显示 0——`status.minutes` 停在 pending，
  因为写文件的是 agent，没有任何代码去改状态位。
- 根因: 两套真相并存（文件内容 vs 索引里的状态缓存），外部改动只更新了前者。
- 防再犯规则: 只要存在「外部可直接修改」的产物，状态就必须从产物**推导**而不是缓存；
  需要缓存时加自愈：读取时发现不一致就修正并落盘，日志记一行 `状态自愈`。
- 状态: active
- 复发: ×2（meeting-workspace-output、meeting-agent-import 各一次）
- 关联: `detectMinutes()`；list 路由；设置页过滤条件 `hasMinutes || status==='done'`

## L-17 受限沙箱下 `npm run verify` 会因 spawn EPERM 假红

- 分类: 环境
- 触发场景: 在 workspace-write 沙箱里跑 `npm run verify`（或 `node --test`、`node scripts/build-client.mjs`）
- 坑: 全部用例报 `✖ ... spawn EPERM`、构建报 `构建校验: 构建失败`，看起来像代码或测试坏了；
  实际是沙箱禁止子进程用管道 stdio——esbuild 的服务进程、`node --test` 的每文件子进程、
  Python sidecar 读取输出，三者都走管道。
- 根因: 沙箱对命名管道/管道 stdio 的限制，与被测代码无关。结构检查（纯读文件）能过，
  所以「41 项通过 + 全部 ✖」这种组合基本就是这个坑。
- 防再犯规则: 看到「结构检查通过但所有测试/构建同时 EPERM」时，先判定为沙箱限制而不是代码问题；
  需要完整校验时在 `danger-full-access` 下跑，或 `node --test --test-isolation=none` 规避
  测试子进程（但 sidecar 与 esbuild 仍需要放行）。
- 状态: active
- 复发: ×1
- 关联: 本轮收尾首次完整 verify 时踩到；用户随后把会话策略改为 danger-full-access

## L-18 DashScope 实时 ASR 的音频格式只认 `pcm`，写 `pcm16` 直接 500

- 分类: 依赖漂移
- 触发场景: 按 OpenAI Realtime 的习惯写 `input_audio_format: 'pcm16'`
- 坑: 服务端不回「参数不合法」，而是回 `Internal service error: Audio format is not valid 'pcm16'!`，
  看起来像服务挂了；改成 `pcm` 立刻正常。采样率字段名是 `sample_rate`（数字），不是 `input_audio_format` 的一部分。
- 根因: 该端点借用了 OpenAI Realtime 的事件形状，但字段取值是自己的子集，且错误文案不指向我们的参数名。
- 防再犯规则: 接第三方「形似某协议」的接口，先用**最小帧**探一次真实取值（探针脚本留档到
  `.tmp/probe-*.mjs`，证据写进 plan/changelog），不要照抄协议文档的示例值。
- 状态: active
- 复发: ×1
- 关联: `lib/asr/stream.js` 的 `buildSessionUpdate`；tests/asr-stream.test.js 锁定 `pcm`

## L-19 实时识别的收尾顺序是 `speech_stopped → committed → completed`

- 分类: 判断
- 触发场景: 停录时发 `input_audio_buffer.commit`，想「收到 committed 就收工」
- 坑: 在 `committed` 收工会丢掉最后一句——真正带文本的 `completed` 在它之后约 0.15 秒才到。
  更隐蔽的是：commit 发出后如果按「距最后一个事件的静默时长」判定收工，而上一个事件早已过去，
  就会**立刻**判定安静，收尾拿到 0 段。
- 根因: 静默窗口的参照点选错了（应为「最后一次事件」与「commit 发出」里更晚的那个）。
- 防再犯规则: 异步协议的收尾判定，计时起点必须包含「我方最后一次动作」；并用**真实服务端**
  回放这类时序（本项目 `tests/stream-ws.test.js` 用本地 ws 服务端复刻该顺序）。
- 状态: active
- 复发: ×1
- 关联: `lib/asr/stream.js` 的 `maybeFinish()`/`commitSentAt`

## L-20 `qwen-audio-*-realtime-flash` 是 omni 对话模型，会对着音频「回话」

- 分类: 验证盲区
- 触发场景: 从模型清单里挑「名字里带 realtime + audio + asr 家族」的模型做流式转写
- 坑: `qwen-audio-3.1-realtime-flash` / `3.0` 连上后会给 `response.text.done`——
  内容是「哈哈，我猜你可能是想问…」这类对话回复，不是转写文本；纯 ASR 要用 `qwen3-asr-flash-realtime`。
- 根因: realtime 家族里混着「对话」和「识别」两种用途，命名不足以区分。
- 防再犯规则: 选模型时用**同一段已知语音**跑一次，断言输出等于语音内容而不是「像回答」的句子；
  选型结论写进 plan 的决策表，避免下个人再试一遍。
- 状态: active
- 复发: ×1
- 关联: plan.md 决策 1；changelog Phase 2 探针记录

## L-21 Node 内置 WebSocket 不能带 `Authorization` 头，实时接口必须用 `ws`

- 分类: 依赖漂移
- 触发场景: 想「零依赖」用 `globalThis.WebSocket` 连 DashScope 实时接口
- 坑: 内置实现只接受子协议（`new WebSocket(url, protocols)`），没有自定义 header 的位置；
  传 `{ headers }` 会被忽略，服务端 401/直接断开——表现为「连上了又立刻断」或彻底连不上，
  而错误信息只有 code=1006。
- 根因: WHATWG WebSocket 规范本身不支持自定义请求头，鉴权只能靠子协议或 cookie。
- 防再犯规则: 需要 Bearer 头的 WS 连接一律显式用 `ws` 包（本项目已加为运行时依赖，
  且 `resolveWebSocketImpl()` 优先取它，取不到才退内置实现并降级）。
- 状态: active
- 复发: ×1
- 关联: `lib/service.js` 的 `resolveWebSocketImpl()`；tests/stream-ws.test.js 断言鉴权头真实发出

## L-22 Windows 上 `execFileSync('dsh', …)` 拿不到输出，因为 `dsh` 是 .cmd 包装

- 分类: 平台差异
- 触发场景: 安装器里用 `execFileSync('dsh', ['--version'])` 读宿主版本，做兼容性告警
- 坑: 不报错也不给值（被 catch 吞掉后表现为「无法判定宿主版本」），兼容检查永远跳过——
  看起来像「没有告警」，实际是「检测从未跑成功」
- 根因: `dsh` 在 Windows 上是 `dsh.cmd`/`.ps1` 脚本，`execFile` 不走 shell 无法执行脚本包装
- 防再犯规则: Windows 上跑 CLI 包装用 `execSync('dsh --version', { shell: true })`，
  或显式指向 `dsh.cmd`；任何「拿不到版本就静默跳过」的分支都要在日志里说出来（本项目打
  `兼容检查 说明=无法判定宿主版本，跳过兼容告警`，正是这条日志暴露了问题）
- 状态: active
- 复发: ×1
- 关联: `scripts/desktop.mjs` 的 `readHostVersion()`；实测修好后读到 `0.1.7-rc.2`

## L-23 桌面版 profile 被 Electron 独占，只能靠脚本改文件，不能靠 CLI

- 分类: 环境限制
- 触发场景: 想把插件装进 `~/.dsh/profiles/desktop`
- 坑: `dsh plugin --profile desktop add …` 直接报
  `profile "desktop" is managed exclusively by the Electron application`；
  手改 `package.json` + 建 junction + `pnpm install --lockfile-only` 能成，但不可重复、不可回滚
- 根因: 宿主对 desktop profile 有独占守卫（这是 CLI 层的守卫，不是文件锁——文件可以改）
- 防再犯规则: 装桌面版一律走 `npm run install:desktop`（幂等 + 装前备份 + 失败回滚 + 五项自检）；
  不要临场手改 profile，也不要试图绕过 CLI 守卫
- 状态: active
- 复发: ×1
- 关联: `specs/20261111_desktop-adaptation`；`lib/desktop.js`、`scripts/desktop.mjs`

## L-24 PowerShell 的 `Add-Content` 默认按 GBK 落盘，会毁掉 UTF-8 的 md

- 分类: 工具链
- 触发场景: 用 `Add-Content -Path specs/_project/lessons.md -Value @'…'@` 追加中文段落
- 坑: 追加成功、内容看着也对，但文件变成「前段 UTF-8 + 后段 GBK」的混合编码；
  下一次 `mdtable_check.py` 直接报 `'utf-8' codec can't decode byte 0xc9`（不是表格不合格，是文件读不了），
  而且 `git diff` 里整段变乱码
- 根因: Windows PowerShell 5.1 的 `Add-Content`/-Value 默认用系统 ANSI（GBK）编码写文件
- 防再犯规则: 改文本文件一律用编辑工具或 Node 脚本（`writeFileSync(file, text, 'utf8')`）；
  必须用 PowerShell 时显式 `-Encoding utf8`。已经写坏时：按最后一段的起始标记切分，
  前半段按 UTF-8、后半段按 GBK 解码后重写为 UTF-8（见 `.tmp/fix-lessons-encoding.py`）
- 状态: active
- 复发: ×1
- 关联: 2026-11-11 追加 L-22/L-23 时踩到；与 L-14（PowerShell 改 JS 吃反引号）同源

## L-25 渲染测试读的是构建产物，改源码不重建会「假绿」

- 分类: 验证盲区
- 触发场景: 改 `src/client/QuickPanel.jsx` 的入口结构，随后只跑 `node --test tests/page-render.test.js`
- 坑: 8 个用例全绿，其中还有一条硬断言 `/● 0:42/`——而源码里 `●` 早已删掉。因为
  `page-render.test.js` 第 9 行 `const BUNDLE = join(ROOT, 'lib', 'client.js')`，加载的是**产物**，
  不是源码。先重建再跑，那条断言立刻红，才暴露真实差异
- 根因: 客户端测试的输入是产物（为了同时验证构建产物可用），源码改动对测试不可见
- 纠正: 改 `src/client/**` 后的正确顺序是 **build → test → 改断言**；`npm run verify` 里的
  「构建可重复」校验能兜住「忘了提交产物」，但兜不住「先测试后构建」的假绿
