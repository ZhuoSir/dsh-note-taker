import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { renderProduct } from '../lib/output.js'
import { createService } from '../lib/service.js'

const roots = []
after(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }) })

function tempRoot(prefix = 'note-taker-facts-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

const quietLogger = () => ({ debug() {}, info() {}, warn() {}, error() {} })
const fakeLlm = () => ({ stream: () => (async function* gen() {})() })

function seed(service, root) {
  const created = service.store.create({ label: '周会', startedAt: '2026-11-12T10:00:00+08:00' })
  const id = created.meeting.id
  service.store.patch(id, {
    status: { record: 'done', transcribe: 'done', minutes: 'pending' },
    durationSec: 42,
    engine: 'cloud',
    stats: { segments: 2, chars: 30, durationSec: 42 },
    audio: { path: join(root, 'a.wav'), sha256: 'x' },
  })
  return id
}

const SEGMENTS = [
  { start: 0, end: 9, text: '那这个里面变更的时候可能需要大量的沟通' },
  { start: 9, end: 15, text: '但是现在还有一个好处' },
]

test('detail 交出产物绝对路径、字节数与转写字数（BUG-05 R-01）', () => {
  const root = tempRoot()
  const workspace = tempRoot('note-taker-facts-ws-')
  const service = createService({
    config: { root, model: 'tiny', threads: 2, resolveWorkspaceDir: () => workspace },
    logger: quietLogger(),
    llm: fakeLlm(),
  })

  const id = seed(service, root)
  const product = join(workspace, 'meetings', `${id}.md`)
  mkdirSync(join(workspace, 'meetings'), { recursive: true })
  writeFileSync(product, renderProduct({
    meetingId: id, label: '周会', startedAt: '2026-11-12T10:00:00+08:00',
    durationSec: 42, engine: 'cloud', model: 'qwen-audio-3.1-asr-flash', segments: SEGMENTS,
  }), 'utf8')
  service.store.patch(id, {
    product: { path: product, mode: 'workspace', relative: `meetings/${id}.md`, workspaceRoot: workspace },
  })

  const detail = service.detail({ meetingId: id })
  assert.equal(detail.ok, true)
  assert.equal(detail.outputAbs, product, '绝对路径必须原样给出')
  assert.equal(existsSync(detail.outputAbs), true, '给出的路径必须真的存在')
  assert.equal(detail.outputRelative, `meetings/${id}.md`)
  assert.equal(detail.outputBytes, statSync(product).size)
  assert.equal(detail.transcriptChars, detail.transcript.length)
  assert.ok(detail.transcriptChars > 0, '转写字数应大于 0')
})

test('无产物时 detail 给出旧转写文件绝对路径（BUG-05 R-03）', () => {
  const root = tempRoot()
  const service = createService({
    config: { root, model: 'tiny', threads: 2 },
    logger: quietLogger(),
    llm: fakeLlm(),
  })

  const id = seed(service, root)
  mkdirSync(join(root, 'transcripts'), { recursive: true })
  const legacy = join(root, 'transcripts', `${id}.md`)
  writeFileSync(legacy, '# 转写\n\n[00:00:00] 只有这一句\n', 'utf8')

  const detail = service.detail({ meetingId: id })
  assert.equal(detail.ok, true)
  assert.equal(detail.outputAbs, null, '没有产物就该是 null，不许编路径')
  assert.equal(detail.transcriptAbs, legacy)
  assert.ok(detail.transcriptChars > 0)
})

test('两者都没有时字段为空，不伪造路径（BUG-05 R-03）', () => {
  const root = tempRoot()
  const service = createService({
    config: { root, model: 'tiny', threads: 2 },
    logger: quietLogger(),
    llm: fakeLlm(),
  })

  const id = seed(service, root)
  const detail = service.detail({ meetingId: id })
  assert.equal(detail.ok, true)
  assert.equal(detail.outputAbs, null)
  assert.equal(detail.transcriptAbs, null)
  assert.equal(detail.outputBytes, 0)
})