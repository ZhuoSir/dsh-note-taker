import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { CLOUD_NOTICE, createService } from '../lib/service.js'
import { pcmToWav } from '../lib/asr/wav.js'

const roots = []
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

function loggerSpy() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') }
}

/** 生成 3 秒 16k 单声道 wav */
function writeWav(path, seconds = 3) {
  const pcm = Buffer.alloc(seconds * 32000, 1)
  writeFileSync(path, pcmToWav(pcm, { sampleRate: 16000 }))
  return path
}

const OK_RESPONSE = {
  request_id: 'req-test',
  sentence: {
    sentence_id: 1,
    begin_time: 0,
    end_time: 3000,
    text: '周会开始。今天谈灰度。',
    words: [
      { begin_time: 0, end_time: 500, text: '周会', punctuation: '' },
      { begin_time: 500, end_time: 900, text: '开始', punctuation: '。' },
      { begin_time: 1000, end_time: 1500, text: '今天', punctuation: '' },
      { begin_time: 1500, end_time: 2000, text: '谈', punctuation: '' },
      { begin_time: 2000, end_time: 2800, text: '灰度', punctuation: '。' },
    ],
  },
  usage: { duration: 3 },
}

function fakeFetch({ status = 200, body = OK_RESPONSE } = {}) {
  const calls = []
  const impl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
  }
  impl.calls = calls
  return impl
}

function makeService({ sourceEntries = {}, fetchImpl = fakeFetch(), configExtra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'note-taker-cloud-'))
  roots.push(root)

  const source = {
    name: 'test',
    get(key) {
      return sourceEntries[key] ?? null
    },
  }

  const logger = loggerSpy()
  const config = {
    root,
    model: 'tiny',
    threads: 2,
    engine: 'local',
    cloudSource: source,
    ...configExtra,
  }
  const service = createService({ config, logger, llm: { stream: () => (async function* gen() {})() }, cloudFetch: fetchImpl })

  const audioPath = writeWav(join(root, 'a.wav'), 3)
  const created = service.store.create({ label: '云端用例', startedAt: '2026-11-10T10:00:00+08:00', audio: { path: audioPath, sha256: 'abc', sampleRate: 16000, channels: 1 } })
  service.store.patch(created.meeting.id, { status: { record: 'done' }, durationSec: 3 })

  return { service, logger, root, fetchImpl, meetingId: created.meeting.id, audioPath }
}

test('engine=cloud：走 HTTP 识别、落盘同构产物、记录 engine', async () => {
  const ctx = makeService({
    sourceEntries: { DASHSCOPE_API_KEY: 'sk-test', NOTE_TAKER_ASR_CHUNK_SECONDS: '60' },
  })

  const result = await ctx.service.transcribe({ meetingId: ctx.meetingId, engine: 'cloud' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.engine, 'cloud')
  assert.ok(result.segments >= 2, `按标点切分后应有多段，实际 ${result.segments}`)

  const mdPath = join(ctx.root, 'transcripts', `${ctx.meetingId}.md`)
  const jsonPath = join(ctx.root, 'transcripts', `${ctx.meetingId}.json`)
  assert.ok(existsSync(mdPath))
  assert.ok(existsSync(jsonPath))

  const json = JSON.parse(readFileSync(jsonPath, 'utf8'))
  assert.equal(json.engine, 'cloud')
  assert.ok(Array.isArray(json.segments) && json.segments.length >= 2)
  assert.match(readFileSync(mdPath, 'utf8'), /^\[\d{2}:\d{2}:\d{2}\]/m)

  const meeting = ctx.service.store.get(ctx.meetingId)
  assert.equal(meeting.status.transcribe, 'done')
  assert.equal(meeting.engine, 'cloud')
})

test('首次云端调用返回外发提示，第二次不再返回', async () => {
  const ctx = makeService({ sourceEntries: { DASHSCOPE_API_KEY: 'sk-test' } })

  const first = await ctx.service.transcribe({ meetingId: ctx.meetingId, engine: 'cloud' })
  assert.equal(first.notice, CLOUD_NOTICE)
  assert.ok(ctx.logger.lines.some((line) => line.message === '云端外发告知'))

  const second = await ctx.service.transcribe({ meetingId: ctx.meetingId, engine: 'cloud' })
  assert.equal(second.notice, null)
})

test('缺密钥 → E_DEP，且状态置 failed、不产生产物', async () => {
  const ctx = makeService({ sourceEntries: {} })
  const result = await ctx.service.transcribe({ meetingId: ctx.meetingId, engine: 'cloud' })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_DEP')
  assert.equal(ctx.service.store.get(ctx.meetingId).status.transcribe, 'failed')
  assert.ok(!existsSync(join(ctx.root, 'transcripts', `${ctx.meetingId}.md`)))
})

test('HTTP 401 → E_DEP，且不覆盖既有产物', async () => {
  const ctx = makeService({
    sourceEntries: { DASHSCOPE_API_KEY: 'sk-test' },
    fetchImpl: fakeFetch({ status: 401, body: { message: 'bad key' } }),
  })
  // 先造一份既有产物
  writeFileSync(join(ctx.root, 'transcripts', `${ctx.meetingId}.md`), '既有内容', 'utf8')

  const result = await ctx.service.transcribe({ meetingId: ctx.meetingId, engine: 'cloud' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_DEP')
  assert.equal(readFileSync(join(ctx.root, 'transcripts', `${ctx.meetingId}.md`), 'utf8'), '既有内容')
  assert.equal(ctx.service.store.get(ctx.meetingId).status.transcribe, 'failed')
})

test('非法 engine → E_STATE 且指名字段', async () => {
  const ctx = makeService({ sourceEntries: { DASHSCOPE_API_KEY: 'sk-test' } })
  const result = await ctx.service.transcribe({ meetingId: ctx.meetingId, engine: 'magic' })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_STATE')
  assert.equal(result.detail.field, 'engine')
})

test('默认引擎 local：不触发云端请求', async () => {
  const fetchImpl = fakeFetch()
  const ctx = makeService({ sourceEntries: { DASHSCOPE_API_KEY: 'sk-test' }, fetchImpl })
  const { service } = ctx

  // 本地引擎会去跑 python sidecar；这里只断言「没有云端请求」这一点，
  // 本地是否成功取决于环境，不在此用例断言。
  await service.transcribe({ meetingId: ctx.meetingId })
  assert.equal(fetchImpl.calls.length, 0, '默认引擎不应触发云端请求')
})

test('长音频按 chunkSeconds 分片，每片一次请求', async () => {
  const fetchImpl = fakeFetch()
  const ctx = makeService({
    sourceEntries: { DASHSCOPE_API_KEY: 'sk-test', NOTE_TAKER_ASR_CHUNK_SECONDS: '10' },
    fetchImpl,
  })
  // 造 25 秒音频 → 10s 一片 → 3 片
  const audioPath = writeWav(join(ctx.root, 'long.wav'), 25)
  const long = ctx.service.store.create({ label: '长音频', startedAt: '2026-11-10T11:00:00+08:00', audio: { path: audioPath, sha256: 'def', sampleRate: 16000, channels: 1 } })
  ctx.service.store.patch(long.meeting.id, { status: { record: 'done' }, durationSec: 25 })

  const result = await ctx.service.transcribe({ meetingId: long.meeting.id, engine: 'cloud' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(fetchImpl.calls.length, 3, `25 秒按 10 秒切片应有 3 次请求，实际 ${fetchImpl.calls.length}`)

  // 偏移只能加一次：3 片 × 10 秒 → 最大时间戳必须落在 25 秒附近，而不是 55 秒
  const json = JSON.parse(readFileSync(join(ctx.root, 'transcripts', `${long.meeting.id}.json`), 'utf8'))
  const maxStart = Math.max(...json.segments.map((segment) => segment.start))
  assert.ok(maxStart < 30, `片偏移被重复累加：最大时间戳 ${maxStart}s 超过音频时长 25s`)
  assert.ok(json.segments.length >= 6, '三片各两段应至少 6 段')
})

test('开启分人时：sentences 带 speaker_id，md 输出 S{n}：标签', async () => {
  const fetchImpl = fakeFetch({
    body: {
      request_id: 'req-diar',
      output: {
        sentences: [
          { sentence_id: 1, begin_time: 0, end_time: 1000, text: '我先说两句。', speaker_id: 0 },
          { sentence_id: 2, begin_time: 1000, end_time: 2000, text: '我补充一下。', speaker_id: 1 },
        ],
      },
    },
  })
  const ctx = makeService({ sourceEntries: { DASHSCOPE_API_KEY: 'sk-test', NOTE_TAKER_ASR_DIARIZATION: '1' }, fetchImpl })

  const result = await ctx.service.transcribe({ meetingId: ctx.meetingId, engine: 'cloud' })
  assert.equal(result.ok, true, JSON.stringify(result))

  const md = readFileSync(join(ctx.root, 'transcripts', `${ctx.meetingId}.md`), 'utf8')
  assert.match(md, /\[00:00:00\] S0：我先说两句。/)
  assert.match(md, /\[00:00:01\] S1：我补充一下。/)

  const json = JSON.parse(readFileSync(join(ctx.root, 'transcripts', `${ctx.meetingId}.json`), 'utf8'))
  assert.deepEqual(json.segments.map((s) => s.speakerId), [0, 1])
  assert.equal(fetchImpl.calls[0].body?.parameters?.speaker_diarization_enabled ?? JSON.parse(fetchImpl.calls[0].options.body).parameters.speaker_diarization_enabled, true)
})
