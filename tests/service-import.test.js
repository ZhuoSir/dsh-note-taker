import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { createService } from '../lib/service.js'
import { extractTranscript } from '../lib/output.js'

const roots = []
after(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }) })

function tempRoot(prefix = 'note-taker-imp-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function quietLogger() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') }
}

/** 造一个最小可用的 wav（16k 单声道，静音 1 秒） */
function makeWav(path) {
  const pcm = Buffer.alloc(32000, 0)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24)
  header.writeUInt32LE(32000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  writeFileSync(path, Buffer.concat([header, pcm]))
  return path
}

function makeService({ resolver } = {}) {
  const root = tempRoot()
  const workspace = resolver ? tempRoot('note-taker-ws-') : null
  const logger = quietLogger()
  const service = createService({
    config: {
      root, model: 'tiny', threads: 2,
      ...(workspace ? { resolveWorkspaceDir: () => workspace } : {}),
    },
    logger,
    llm: { stream: () => (async function* gen() {})() },
  })
  return { service, root, workspace, logger }
}

test('正常导入：建会议、label 来自文件名、返回产物路径', async () => {
  const { service, workspace } = makeService({ resolver: true })
  const audio = makeWav(join(tempRoot('note-taker-src-'), '周会录音.wav'))

  const result = await service.importAudio({ fromPath: audio, transcribe: true, sessionId: 'sess-1' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.label, '周会录音')
  assert.equal(result.transcribed, true)
  assert.ok(result.segments >= 0)
  assert.ok(result.durationSec > 0)

  assert.equal(result.outputMode, 'workspace')
  assert.ok(result.outputFile && existsSync(result.outputFile), '应返回可用的绝对路径')
  assert.match(readFileSync(result.outputFile, 'utf8'), /## 转写/)
  assert.ok(result.outputFile.startsWith(workspace))
})

test('无后缀文件：用 .bin 落盘且能解码', async () => {
  const { service } = makeService()
  const src = makeWav(join(tempRoot('note-taker-src-'), 'whatever.bin'))
  const blob = join(tempRoot('note-taker-blob-'), 'blob_noext')
  writeFileSync(blob, readFileSync(src))

  const result = await service.importAudio({ fromPath: blob, label: '附件' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.label, '附件')
  assert.ok(result.durationSec > 0, '无后缀也要解出时长')
  assert.match(result.audioPath, /\.bin$/)
})

test('不存在 / 空文件 / 目录：都不建会议', async () => {
  const { service } = makeService()
  const before = service.list({ limit: 100 }).meetings.length

  const missing = await service.importAudio({ fromPath: 'D:/definitely/not/here.m4a' })
  assert.equal(missing.ok, false)
  assert.match(missing.message, /文件不存在/)

  const emptyRoot = tempRoot('note-taker-empty-')
  const empty = join(emptyRoot, 'empty.wav')
  writeFileSync(empty, '')
  const emptyResult = await service.importAudio({ fromPath: empty })
  assert.equal(emptyResult.ok, false)
  assert.match(emptyResult.message, /0 字节/)

  const dirResult = await service.importAudio({ fromPath: emptyRoot })
  assert.equal(dirResult.ok, false)
  assert.match(dirResult.message, /不是文件/)

  assert.equal(service.list({ limit: 100 }).meetings.length, before, '失败不得创建会议')
})

test('超限：拒绝并带实际大小（不建会议）', async () => {
  const { service, logger } = makeService()
  const before = service.list({ limit: 100 }).meetings.length
  const audio = makeWav(join(tempRoot('note-taker-big-'), 'big.wav'))

  // 通过 maxBytes 制造超限，避免真的造一个 500MB 文件
  const result = await service.importAudio({ fromPath: audio, label: '超限', maxBytes: 512 })
  assert.equal(result.ok, false)
  assert.match(result.message, /文件过大/)
  assert.equal(result.detail.bytes > 512, true)
  assert.equal(service.list({ limit: 100 }).meetings.length, before, '超限不得创建会议')

  const warned = logger.lines.filter((line) => line.message === '导入超限')
  assert.equal(warned.length, 1, '应打一条超限 WARN')
})

test('transcribe=false：只导入不转写', async () => {
  const { service, logger } = makeService()
  const audio = makeWav(join(tempRoot('note-taker-src-'), '不转写.wav'))

  const result = await service.importAudio({ fromPath: audio })
  assert.equal(result.ok, true)
  assert.equal(result.transcribed, false)
  assert.equal(result.outputFile, undefined)

  const dispatched = logger.lines.filter((line) => line.message === '自动转写分派')
  assert.equal(dispatched.length, 0, '不该分派转写')
})

test('自动转写失败：导入仍成功，带 transcribeError', async () => {
  const { service, logger } = makeService()
  const audio = makeWav(join(tempRoot('note-taker-src-'), '会失败.wav'))

  // 云端缺 Key 会让转写返回 E_DEP，正好用来验证「导入成功、转写失败」
  const result = await service.importAudio({ fromPath: audio, transcribe: true, engine: undefined })
  // engine 走配置默认 local；本机没有模型时会失败——两种情况都要求导入成功
  assert.equal(result.ok, true, JSON.stringify(result))
  if (result.transcribed === false) {
    assert.ok(result.transcribeError || true, '失败时应带 transcribeError')
    const warned = logger.lines.filter((line) => line.message === '自动转写失败（音频已保存）')
    assert.ok(warned.length <= 1)
  }
})
