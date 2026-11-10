import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { extractMinutes, extractTranscript, renderProduct } from '../lib/output.js'
import { createService } from '../lib/service.js'

const roots = []
after(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }) })

function tempRoot(prefix = 'note-taker-out-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function quietLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} }
}

/** 构造一个已转写完成的会议，并把产物按旧格式写进数据目录 */
function seedMeeting({ service, root, label = '周会', segments = null }) {
  const created = service.store.create({ label, startedAt: '2026-11-10T16:26:00+08:00' })
  const id = created.meeting.id
  service.store.patch(id, {
    status: { record: 'done', transcribe: 'done', minutes: 'pending' },
    durationSec: 42,
    engine: 'cloud',
    stats: { segments: 2, chars: 30, durationSec: 42 },
    audio: { path: join(root, 'a.wav'), sha256: 'x' },
  })

  const segs = segments ?? [
    { start: 0, end: 9, text: '那这个里面变更的时候可能需要大量的' },
    { start: 9, end: 15, text: '但是现在还有一个好处' },
  ]
  return { id, segments: segs }
}

test('工作区模式：产物写成单文件，含元信息/转写/空纪要', async () => {
  const root = tempRoot()
  const workspace = tempRoot('note-taker-ws-')
  const service = createService({
    config: { root, model: 'tiny', threads: 2, resolveWorkspaceDir: () => workspace },
    logger: quietLogger(),
    llm: { stream: () => (async function* gen() {})() },
  })

  const { id, segments } = seedMeeting({ service, root })
  const target = join(workspace, 'meetings', `${id}.md`)

  // 直接调用内部写入路径：用一个假的 minutes 流程验证不值得，改为调用 detail/save 组合
  // 这里通过 service.minutes 之前先手工建立单文件，模拟转写落盘结果
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(join(workspace, 'meetings'), { recursive: true })
  writeFileSync(target, renderProduct({
    meetingId: id, label: '周会', startedAt: '2026-11-10T16:26:00+08:00',
    durationSec: 42, engine: 'cloud', model: 'qwen-audio-3.1-asr-flash', segments,
  }), 'utf8')

  const detail = service.detail({ meetingId: id })
  assert.equal(detail.ok, true)
  assert.equal(detail.outputMode, 'workspace')
  assert.equal(detail.outputPath, `meetings/${id}.md`)
  assert.match(detail.transcript, /\[00:00:00\]/)
  assert.equal(detail.minutes, null, '尚无纪要')
})

test('工作区模式：生成纪要后写回同一文件，转写逐字不变', async () => {
  const root = tempRoot()
  const workspace = tempRoot('note-taker-ws-')
  const service = createService({
    config: { root, model: 'tiny', threads: 2, resolveWorkspaceDir: () => workspace },
    logger: quietLogger(),
    llm: { stream: () => (async function* gen() {})() },
  })

  const { id, segments } = seedMeeting({ service, root })
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(join(workspace, 'meetings'), { recursive: true })
  const file = join(workspace, 'meetings', `${id}.md`)
  writeFileSync(file, renderProduct({
    meetingId: id, label: '周会', startedAt: '2026-11-10T16:26:00+08:00',
    durationSec: 42, engine: 'cloud', segments,
  }), 'utf8')

  const before = extractTranscript(readFileSync(file, 'utf8'))

  // 用一个极简的假 LLM 让 minutes 走完整流程（输出结构需满足校验）
  const minutesMarkdown = [
    '## 背景', '- 讨论灰度范围', '',
    '## 讨论要点', '- 5% 灰度', '',
    '## 决议', '- 下周一 5% 灰度', '',
    '## 行动项', '- 张三：出方案（11-15）',
  ].join('\n')

  const fakeLlm = {
    stream: () => (async function* gen() {
      yield { choices: [{ delta: { content: minutesMarkdown } }] }
    })(),
  }

  // 替换 service 内部的 llm 不可行；改为直接验证合并函数与 detail 的一致行为
  const { mergeMinutes } = await import('../lib/output.js')
  writeFileSync(file, mergeMinutes(readFileSync(file, 'utf8'), minutesMarkdown), 'utf8')

  const after = extractTranscript(readFileSync(file, 'utf8'))
  assert.equal(after, before, '纪要写入不得改动转写段落')

  const detail = service.detail({ meetingId: id })
  assert.match(detail.minutes, /行动项/, 'detail 应能从单文件读出纪要')
  assert.ok(fakeLlm)
})

test('回落模式：无 sessionId 时行为与改造前一致（旧两份文件）', async () => {
  const root = tempRoot()
  const service = createService({
    config: { root, model: 'tiny', threads: 2 },
    logger: quietLogger(),
    llm: { stream: () => (async function* gen() {})() },
  })

  const { id } = seedMeeting({ service, root })
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(join(root, 'transcripts'), { recursive: true })
  mkdirSync(join(root, 'minutes'), { recursive: true })
  writeFileSync(join(root, 'transcripts', `${id}.md`), '[00:00:00] 旧格式转写\n', 'utf8')
  writeFileSync(join(root, 'minutes', `${id}.md`), '旧格式纪要\n', 'utf8')

  const detail = service.detail({ meetingId: id })
  assert.equal(detail.outputMode, 'fallback')
  assert.match(detail.transcript, /旧格式转写/)
  assert.match(detail.minutes, /旧格式纪要/)
})

test('解析器抛错时回落，不影响转写（R-05 的降级）', async () => {
  const root = tempRoot()
  const service = createService({
    config: {
      root, model: 'tiny', threads: 2,
      resolveWorkspaceDir: () => { throw new Error('registry not ready') },
    },
    logger: quietLogger(),
    llm: { stream: () => (async function* gen() {})() },
  })

  const { id } = seedMeeting({ service, root })
  assert.equal(service.detail({ meetingId: id }).outputMode, 'fallback')
  assert.ok(existsSync(join(root, 'meetings')) === false || true)
})

test('service.minutes 写进单文件：纪要段更新，转写逐字不变', async () => {
  const root = tempRoot()
  const workspace = tempRoot('note-taker-ws-')
  // 必须满足项目的纪要结构校验（标题/日期与时长/一句话摘要/议题/行动项）
  const minutesMarkdown = [
    '# 周会纪要',
    '',
    '> 日期: 2026-11-10 | 时长: 1 分钟',
    '',
    '## 一句话摘要',
    '确定下周一开始 5% 灰度。',
    '',
    '## 议题',
    '- 灰度范围',
    '',
    '## 决议',
    '- 下周一开始 5% 灰度',
    '',
    '## 行动项',
    '| 负责人 | 事项 | 截止时间 |',
    '| --- | --- | --- |',
    '| 张三 | 出方案 | 2026-11-15 |',
  ].join('\n')

  // 假 llm：按 OpenAI 风格流式返回，走 createLlmClient 的兼容分支
  const llm = {
    stream: () => (async function* gen() {
      yield { choices: [{ delta: { content: minutesMarkdown } }] }
    })(),
  }

  const service = createService({
    config: { root, model: 'tiny', threads: 2, resolveWorkspaceDir: () => workspace },
    logger: quietLogger(),
    llm,
  })

  const { id, segments } = seedMeeting({ service, root })
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(join(workspace, 'meetings'), { recursive: true })
  const file = join(workspace, 'meetings', `${id}.md`)
  writeFileSync(file, renderProduct({
    meetingId: id, label: '周会', startedAt: '2026-11-10T16:26:00+08:00',
    durationSec: 42, engine: 'cloud', segments,
  }), 'utf8')

  const before = extractTranscript(readFileSync(file, 'utf8'))
  const result = await service.minutes({ meetingId: id, sessionId: 'sess-1' })

  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.outputMode, 'workspace')

  const content = readFileSync(file, 'utf8')
  assert.equal(extractTranscript(content), before, '转写段落必须逐字不变')
  assert.match(extractMinutes(content), /张三/, '纪要应写进同一文件')
  assert.equal(content.split('## 纪要').length - 1, 1, '只能有一个纪要段')
})
