import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { after, test } from 'node:test'

import { createService } from '../lib/service.js'
import { parseSidecarStdout } from '../lib/py.js'
import { pcmToWav } from '../lib/asr/wav.js'

const roots = []
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class FakeWS {
  static instances = []
  static reset() { FakeWS.instances = [] }
  static get last() { return FakeWS.instances.at(-1) }
  constructor(url, opts) {
    this.url = url
    this.opts = opts
    this.sent = []
    FakeWS.instances.push(this)
  }
  send(raw) { this.sent.push(JSON.parse(raw)) }
  close() { this.onclose?.({ code: 1000 }) }
  open() { this.onopen?.({}) }
  emit(event) { this.onmessage({ data: JSON.stringify(event) }) }
  drop(code = 1006) { this.onclose?.({ code }) }
  frames(type) { return this.sent.filter((item) => item.type === type) }
}

function loggerSpy() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') }
}

const OK_RESPONSE = {
  request_id: 'req-stream-test',
  sentence: { sentence_id: 1, begin_time: 0, end_time: 600, text: '降级后仍能出字。', words: [{ begin_time: 0, end_time: 600, text: '降级后仍能出字', punctuation: '。' }] },
  usage: { duration: 1 },
}

function fakeFetch() {
  return async () => ({ ok: true, status: 200, text: async () => JSON.stringify(OK_RESPONSE) })
}

const TRANSCRIPT_MD = '# 转写：周会\n\n[00:00:05] 张三：灰度先做 5%。\n'

/**
 * 假录音子进程：stdin.end() 时才落 WAV/PCM（与真实 sidecar 一致：边录边写，这里为了确定性一次性写）
 */
function fakeRecordChild({ outPath, pcmOut }) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => {}
  child.stdin = {
    write() {},
    end() {
      writeFileSync(outPath, pcmToWav(Buffer.alloc(32_000, 7), { sampleRate: 16000 }))
      if (pcmOut) writeFileSync(pcmOut, Buffer.alloc(32_000, 7))
      const payload = { ok: true, path: outPath, durationSec: 1, bytes: 32_000, sampleRate: 16000, channels: 1 }
      if (pcmOut) Object.assign(payload, { pcmPath: pcmOut, pcmBytes: 32_000, pcmBroken: false })
      child.stdout.write(`${JSON.stringify(payload)}\n`)
      setImmediate(() => child.emit('close', 0))
    },
  }
  setImmediate(() => child.stderr.write('note-taker/record - 录音开始, device=default, sampleRate=16000\n'))
  return child
}

function makeContext({ enabled = '1', withKey = true, configExtra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'note-taker-stream-'))
  roots.push(root)

  const entries = {}
  if (withKey) entries.DASHSCOPE_API_KEY = 'sk-test'
  const source = {
    name: 'test',
    get(key) { return entries[key] ?? null },
  }

  const spawns = []
  const python = {
    parseSidecarStdout,
    spawnSidecar(script, args) {
      spawns.push(args)
      const outPath = args[args.indexOf('--out') + 1]
      const pcmIndex = args.indexOf('--pcm-out')
      return fakeRecordChild({ outPath, pcmOut: pcmIndex >= 0 ? args[pcmIndex + 1] : null })
    },
    runSidecar(script, args) {
      if (script === 'decode_pcm.py') {
        const out = args[args.indexOf('--out') + 1]
        writeFileSync(out, Buffer.alloc(32_000, 7))
        return Promise.resolve({ ok: true, payload: { ok: true, durationSec: 1 }, exitCode: 0, stderr: '' })
      }
      const outDir = args[args.indexOf('--out-dir') + 1]
      const stem = args[args.indexOf('--stem') + 1]
      const mdPath = join(outDir, `${stem}.md`)
      writeFileSync(mdPath, TRANSCRIPT_MD, 'utf8')
      return Promise.resolve({ ok: true, payload: { ok: true, segments: 1, chars: 12, durationSec: 1, rtf: 0.2, mdPath }, exitCode: 0, stderr: '' })
    },
  }

  const logger = loggerSpy()
  const config = {
    root,
    model: 'tiny',
    threads: 1,
    engine: 'local',
    cloudSource: source,
    streamOverrides: { enabled, apiKey: withKey ? 'sk-test' : undefined },
    streamWebSocket: FakeWS,
    streamSettleMs: 40,
    streamReconnectDelayMs: 5,
    ...configExtra,
  }
  const service = createService({ config, logger, python, llm: { stream: () => (async function* gen() {})() }, cloudFetch: fakeFetch() })

  return { service, logger, root, spawns }
}

test('不传 stream 时行为与改造前一致（不写 PCM、无 stream 字段）', async () => {
  const { service, spawns, root } = makeContext({ enabled: '0' })

  const started = await service.recordStart({ label: '普通录音' })
  assert.equal(started.ok, true)
  assert.equal(started.stream.stream, false)
  assert.equal(spawns[0].includes('--pcm-out'), false, '非流式不应传 --pcm-out')

  const stopped = await service.recordStop()
  assert.equal(stopped.ok, true)
  assert.equal(stopped.stream, undefined, '非流式返回里不该有 stream 字段')

  const pcmFiles = readdirSync(join(root, 'recordings')).filter((name) => name.endsWith('.pcm'))
  assert.deepEqual(pcmFiles, [])
})

test('stream=true：连上流式会话并把 PCM 推给服务端', async () => {
  FakeWS.reset()
  const { service } = makeContext()

  const started = await service.recordStart({ label: '流式录音', stream: true })
  assert.equal(started.ok, true, JSON.stringify(started))
  assert.equal(started.stream.stream, true)
  assert.equal(started.stream.model, 'qwen3-asr-flash-realtime')

  const ws = FakeWS.last
  assert.ok(ws, '应创建 WebSocket')
  ws.open()
  ws.emit({ type: 'session.created', session: { id: 'sess_test' } })
  await sleep(5)

  const snapshot = service.live({ meetingId: started.meetingId })
  assert.equal(snapshot.data.state, 'streaming')
  assert.equal(snapshot.data.engine.stream, true)

  await service.recordStop()
})

test('停录：发 commit、产物落盘、状态转 done、旁路 PCM 删除', async () => {
  FakeWS.reset()
  const { service, root, logger } = makeContext()

  const started = await service.recordStart({ label: '流式收尾', stream: true })
  const ws = FakeWS.last
  ws.open()
  ws.emit({ type: 'session.created', session: { id: 'sess_1' } })
  ws.emit({ type: 'conversation.item.created', item: { id: 'i1' } })
  ws.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: '第一句话。' })
  ws.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i2', transcript: '第二句话。' })
  await sleep(5)

  const stopped = await service.recordStop()
  assert.equal(stopped.ok, true, JSON.stringify(stopped))
  assert.equal(stopped.stream.used, true)
  assert.equal(stopped.stream.segments, 2)
  assert.equal(stopped.stream.degraded, false)
  assert.equal(ws.frames('input_audio_buffer.commit').length, 1, '收尾必须发 commit')

  const meeting = service.store.get(started.meetingId)
  assert.equal(meeting.status.transcribe, 'done')
  assert.equal(meeting.status.record, 'done')
  assert.equal(meeting.stream, true)

  const md = readFileSync(join(root, 'transcripts', `${started.meetingId}.md`), 'utf8')
  assert.match(md, /第一句话/)
  assert.match(md, /第二句话/)
  const json = JSON.parse(readFileSync(join(root, 'transcripts', `${started.meetingId}.json`), 'utf8'))
  assert.equal(json.mode, 'stream')
  assert.equal(json.segments.length, 2)
  for (const segment of json.segments) {
    assert.equal(typeof segment.startSec, 'number')
    assert.equal(typeof segment.endSec, 'number')
  }

  assert.equal(existsSync(join(root, 'recordings', `${started.meetingId}.pcm`)), false, '旁路 PCM 应收尾后删除')
  assert.ok(logger.lines.some((line) => line.message === '流式转写完成'))
})

test('流式降级：连不上时用 WAV 走非流式，产物仍完整', async () => {
  FakeWS.reset()
  const { service, root } = makeContext()

  const started = await service.recordStart({ label: '降级用例', stream: true })
  const ws = FakeWS.last
  ws.open()
  ws.drop(1006)
  await sleep(20)
  FakeWS.last.drop(1006)
  await sleep(20)
  FakeWS.last.drop(1006)
  await sleep(20)

  const live = service.live({ meetingId: started.meetingId })
  assert.equal(live.data.state, 'degraded')

  const stopped = await service.recordStop()
  assert.equal(stopped.ok, true, JSON.stringify(stopped))
  assert.equal(stopped.stream.degraded, true)
  assert.equal(stopped.stream.used, false)
  assert.equal(stopped.stream.fallback, 'queued')

  await service.pendingFallbacks()

  const meeting = service.store.get(started.meetingId)
  assert.equal(meeting.status.transcribe, 'done', '降级后非流式识别应完成')
  const md = readFileSync(join(root, 'transcripts', `${started.meetingId}.md`), 'utf8')
  assert.match(md, /降级后仍能出字/)
  assert.equal(existsSync(join(root, 'recordings', `${started.meetingId}.pcm`)), false)
})

test('想走流式但没配密钥：开始前就拒绝，且不建会议、不落文件', async () => {
  const { service, spawns } = makeContext({ withKey: false })

  const result = await service.recordStart({ label: '缺密钥', stream: true })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_DEP')
  assert.equal(result.detail.field, 'stream')
  assert.equal(spawns.length, 0, '拒绝发生在起 sidecar 之前')
  assert.equal(service.store.list().length, 0, '不应留下半场会议')
})

test('显式 stream=false 覆盖「配置已启用」：本次仍走普通录音', async () => {
  FakeWS.reset()
  const { service, spawns } = makeContext({ enabled: '1' })

  const started = await service.recordStart({ stream: false })
  assert.equal(started.ok, true)
  assert.equal(started.stream.stream, false)
  assert.equal(spawns[0].includes('--pcm-out'), false)
  assert.equal(FakeWS.instances.length, 0, '不应建立流式连接')

  await service.recordStop()
})

test('并发第二场录音仍被拒（状态机不变）', async () => {
  FakeWS.reset()
  const { service } = makeContext({ enabled: '0' })

  const first = await service.recordStart({ label: '第一场' })
  assert.equal(first.ok, true)

  const second = await service.recordStart({ label: '第二场' })
  assert.equal(second.ok, false)
  assert.equal(second.code, 'E_STATE')

  await service.recordStop()
})