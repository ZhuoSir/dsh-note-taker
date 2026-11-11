import assert from 'node:assert/strict'
import { test } from 'node:test'

import { STREAM_STATES, buildSessionUpdate, createStreamSession, secondsOf } from '../lib/asr/stream.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 假 WebSocket：只记 send、可手动触发 open/message/close */
class FakeWS {
  static instances = []

  static reset() {
    FakeWS.instances = []
  }

  static get last() {
    return FakeWS.instances.at(-1)
  }

  constructor(url, opts) {
    this.url = url
    this.opts = opts
    this.sent = []
    this.closed = false
    FakeWS.instances.push(this)
  }

  send(raw) {
    this.sent.push(JSON.parse(raw))
  }

  close() {
    this.closed = true
    this.onclose?.({ code: 1000 })
  }

  open() {
    this.onopen?.({})
  }

  emit(event) {
    this.onmessage({ data: JSON.stringify(event) })
  }

  drop(code = 1006) {
    this.onclose?.({ code })
  }

  frames(type) {
    return this.sent.filter((item) => item.type === type)
  }
}

function loggerSpy() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, warn: push('warn'), error: push('error'), info: push('info'), debug: push('debug') }
}

function makeConfig(overrides = {}) {
  return {
    enabled: true,
    available: true,
    reason: null,
    model: 'qwen3-asr-flash-realtime',
    endpoint: 'ws://127.0.0.1:9999/api-ws/v1/realtime',
    apiKey: 'sk-secret-should-not-leak',
    sampleRate: 16000,
    frameBytes: 3200,
    connectTimeoutMs: 200,
    finalizeTimeoutMs: 800,
    reconnectAttempts: 2,
    ...overrides,
  }
}

async function connected(config = makeConfig(), extra = {}) {
  FakeWS.reset()
  const logger = loggerSpy()
  const session = createStreamSession({ config, logger, WebSocketImpl: FakeWS, reconnectDelayMs: 10, ...extra })
  const promise = session.connect()
  const ws = FakeWS.last
  ws.open()
  ws.emit({ type: 'session.created', session: { id: 'sess_1', model: config.model, sample_rate: 16000 } })
  const result = await promise
  return { session, ws, logger, result }
}

test('连接后第一帧是 session.update，格式为 pcm、16k、指定模型', async () => {
  const { ws } = await connected()

  assert.equal(ws.sent[0].type, 'session.update')
  assert.equal(ws.sent[0].session.input_audio_format, 'pcm')
  assert.equal(ws.sent[0].session.sample_rate, 16000)
  assert.equal(ws.sent[0].session.modalities[0], 'text')
  assert.equal(ws.sent[0].session.input_audio_transcription.model, 'qwen3-asr-flash-realtime')
  assert.match(ws.url, /\/api-ws\/v1\/realtime\?model=qwen3-asr-flash-realtime$/)
})

test('会话建立前的音频入队，建立后按序补发', async () => {
  FakeWS.reset()
  const session = createStreamSession({ config: makeConfig(), logger: loggerSpy(), WebSocketImpl: FakeWS, reconnectDelayMs: 10 })
  const promise = session.connect()
  const ws = FakeWS.last
  ws.open()

  session.push(Buffer.alloc(3200, 1))
  assert.equal(ws.frames('input_audio_buffer.append').length, 0, '建立前不应发送音频')

  ws.emit({ type: 'session.created', session: { id: 'sess_q' } })
  await promise

  assert.equal(ws.frames('input_audio_buffer.append').length, 1)
  assert.equal(Buffer.from(ws.frames('input_audio_buffer.append')[0].audio, 'base64').length, 3200)
})

test('中间结果 = text + stash 拼接', async () => {
  const { session, ws } = await connected()

  ws.emit({ type: 'conversation.item.input_audio_transcription.text', item_id: 'i1', text: '这个', stash: '里面' })
  assert.equal(session.snapshot().partial, '这个里面')

  ws.emit({ type: 'conversation.item.input_audio_transcription.text', item_id: 'i1', text: '', stash: '这个里面变更的时候' })
  assert.equal(session.snapshot().partial, '这个里面变更的时候')
})

test('completed 落成最终段：清空 partial、时间戳来自本地时钟', async () => {
  const { session, ws } = await connected()

  session.push(Buffer.alloc(3200, 1)) // 0.1s
  ws.emit({ type: 'input_audio_buffer.speech_started' })
  ws.emit({ type: 'conversation.item.created', item: { id: 'i1', type: 'message' } })
  session.push(Buffer.alloc(64000, 1)) // +2.0s → 2.1s
  ws.emit({ type: 'input_audio_buffer.speech_stopped' })
  ws.emit({ type: 'input_audio_buffer.committed' })
  ws.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: '你好世界', usage: { duration: 2 } })

  const snap = session.snapshot()
  assert.equal(snap.partial, '')
  assert.equal(snap.finals.length, 1)
  assert.equal(snap.finals[0].text, '你好世界')
  assert.equal(snap.finals[0].startSec, 0.1)
  assert.equal(snap.finals[0].endSec, 2.1)
  assert.equal(snap.chars, 4)
})

test('最终段之后到达的中间结果不得改写它（R-03）', async () => {
  const { session, ws } = await connected()

  ws.emit({ type: 'conversation.item.input_audio_transcription.text', item_id: 'i1', text: '', stash: '你好' })
  ws.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: '你好世界' })
  ws.emit({ type: 'conversation.item.input_audio_transcription.text', item_id: 'i1', text: '', stash: '你好世界啊啊' })

  const snap = session.snapshot()
  assert.equal(snap.finals.length, 1)
  assert.equal(snap.finals[0].text, '你好世界')
  assert.equal(snap.partial, '', '定稿后的 item 不应再出现在 partial 里')
})

test('同一 item 的 completed 重复到达只记一次', async () => {
  const { session, ws } = await connected()

  ws.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: '第一句' })
  ws.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: '第一句' })

  assert.equal(session.snapshot().finals.length, 1)
})

test('时间戳单调不减：多段按顺序累加', async () => {
  const { session, ws } = await connected()

  const speak = (id, text, secondsFollowed) => {
    ws.emit({ type: 'input_audio_buffer.speech_started' })
    ws.emit({ type: 'conversation.item.created', item: { id } })
    session.push(Buffer.alloc(secondsFollowed * 32000, 1))
    ws.emit({ type: 'input_audio_buffer.speech_stopped' })
    ws.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text })
  }

  speak('i1', '第一句', 2)
  speak('i2', '第二句', 3)

  const finals = session.snapshot().finals
  assert.equal(finals.length, 2)
  for (let i = 1; i < finals.length; i += 1) {
    assert.ok(finals[i].startSec >= finals[i - 1].endSec, `第 ${i + 1} 段起点不应早于前一段终点`)
  }
})

test('finalize 发 commit，等残句定稿后才返回', async () => {
  const { session, ws } = await connected(makeConfig({ finalizeTimeoutMs: 800 }), { settleMs: 60 })

  ws.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: '最后一句' })
  const promise = session.finalize()

  assert.equal(ws.frames('input_audio_buffer.commit').length, 1, '收尾必须发 commit')
  // 模拟服务端顺序：committed 之后才来 completed（实测就是如此）
  ws.emit({ type: 'input_audio_buffer.committed' })
  await sleep(5)
  ws.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i2', transcript: '收尾那句' })

  const result = await promise
  assert.equal(result.ok, true)
  assert.equal(result.timedOut, false)
  assert.equal(result.segments.length, 2)
  assert.equal(result.segments[1].text, '收尾那句')
  assert.equal(session.snapshot().state, STREAM_STATES.DONE)
})

test('收尾超时：用已有最终段落盘并标记 timedOut', async () => {
  const { session, ws } = await connected(makeConfig({ finalizeTimeoutMs: 80 }), { settleMs: 600 })

  ws.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: '已定的那句' })
  const result = await session.finalize()

  assert.equal(result.timedOut, true)
  assert.equal(result.segments.length, 1)
  assert.equal(result.segments[0].text, '已定的那句')
})

test('断线重连 2 次仍失败 → 降级 degraded（不静默重试）', async () => {
  const { session, ws, logger } = await connected(makeConfig({ reconnectAttempts: 2 }), {})
  assert.equal(session.snapshot().state, STREAM_STATES.STREAMING)

  ws.drop(1006)
  await sleep(25)
  FakeWS.last.drop(1006)
  await sleep(25)
  FakeWS.last.drop(1006)
  await sleep(25)

  const snap = session.snapshot()
  assert.equal(snap.state, STREAM_STATES.DEGRADED)
  assert.equal(snap.degradedReason, 'reconnect_exceeded')
  assert.ok(logger.lines.some((line) => line.message === '降级'))
})

test('服务端 error 事件转成可读错误，不抛异常', async () => {
  const { session, ws } = await connected()

  ws.emit({ type: 'error', error: { code: 'InternalError', message: "Audio format is not valid 'pcm16'!" } })

  const snap = session.snapshot()
  assert.equal(snap.error.code, 'InternalError')
  assert.match(snap.error.message, /Audio format is not valid/)
})

test('日志：记录会话建立与模型名，且不出现 API Key', async () => {
  const { logger } = await connected()

  const built = logger.lines.find((line) => line.message === '流式会话已建立')
  assert.ok(built, '应记录「流式会话已建立」')
  assert.equal(built.fields.model, 'qwen3-asr-flash-realtime')
  assert.equal(built.fields.sampleRate, 16000)
  assert.equal(built.fields.runId, 'stream')

  const dump = JSON.stringify(logger.lines)
  assert.ok(!dump.includes('sk-secret-should-not-leak'), '日志里不得出现 API Key')
})

test('secondsOf 与 buildSessionUpdate 的细节约定', () => {
  assert.equal(secondsOf(32000), 1)
  assert.equal(secondsOf(3200), 0.1)
  assert.equal(secondsOf(0), 0)

  const update = buildSessionUpdate('qwen3-asr-flash-realtime')
  assert.equal(update.session.input_audio_format, 'pcm', "必须是 'pcm'，写 pcm16 会被服务端拒绝")
  assert.deepEqual(update.session.modalities, ['text'])
})