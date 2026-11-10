import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { createCloudAsrClient } from '../lib/asr/cloud.js'
import { FakeWebSocket, failedEvent, finishedEvent, sentenceEvent, startedEvent } from './support/fake-ws.js'

afterEach(() => FakeWebSocket.reset())

function loggerSpy() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') }
}

function makeConfig(overrides = {}) {
  return {
    apiKey: 'sk-test-key',
    endpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    model: 'qwen-audio-3.0-asr-flash-streaming',
    speed: 1000,
    sampleRate: 16000,
    idleTimeoutMs: 5000,
    vocabulary: { XXX: 3 },
    ...overrides,
  }
}

function frames(count = 3, size = 3200) {
  return Array.from({ length: count }, () => Buffer.alloc(size, 1))
}

/** 默认剧本：收到 run-task → 回 started；收到 finish-task → 回两条结果 + finished */
function installHappyServer({ sentences = [sentenceEvent({ text: '欢迎使用阿里云。', begin: 160, end: 1640 })] } = {}) {
  FakeWebSocket.onSend = (socket, data) => {
    if (Buffer.isBuffer(data)) return
    const payload = JSON.parse(data)
    if (payload.header.action === 'run-task') {
      setImmediate(() => socket.push(startedEvent(payload.header.task_id)))
      return
    }
    if (payload.header.action === 'finish-task') {
      setImmediate(() => {
        for (const sentence of sentences) socket.push(sentence)
        socket.push(finishedEvent())
      })
    }
  }
}

test('协议顺序：run-task → 音频帧 → finish-task', async () => {
  installHappyServer()
  const logger = loggerSpy()
  const client = createCloudAsrClient({ config: makeConfig(), logger, WebSocketImpl: FakeWebSocket, runId: 'm-1' })
  const result = await client.transcribe(frames(3))

  assert.equal(result.ok, true, JSON.stringify(result))
  const socket = FakeWebSocket.instances[0]
  const actions = socket.textSent.map((text) => JSON.parse(text).header.action)
  assert.deepEqual(actions, ['run-task', 'finish-task'])
  assert.equal(socket.binarySent.length, 3)
  assert.deepEqual(result.segments, [{ start: 0.16, end: 1.64, text: '欢迎使用阿里云。' }])
})

test('握手头带 Bearer，run-task 字段与配置一致', async () => {
  installHappyServer()
  const client = createCloudAsrClient({ config: makeConfig(), logger: loggerSpy(), WebSocketImpl: FakeWebSocket })
  await client.transcribe(frames(1))

  const socket = FakeWebSocket.instances[0]
  assert.equal(socket.options.headers.Authorization, 'Bearer sk-test-key')
  const runTask = JSON.parse(socket.textSent[0])
  assert.equal(runTask.payload.model, 'qwen-audio-3.0-asr-flash-streaming')
  assert.equal(runTask.payload.parameters.format, 'pcm')
  assert.equal(runTask.payload.parameters.sample_rate, 16000)
  assert.deepEqual(runTask.payload.parameters.vocabulary, { XXX: 3 })
  assert.deepEqual(runTask.payload.parameters.language_hints, ['zh'])
})

test('收到 task-started 之前不推音频', async () => {
  let startedPushed = false
  FakeWebSocket.onSend = (socket, data) => {
    if (Buffer.isBuffer(data)) {
      assert.equal(startedPushed, true, '必须在 task-started 之后才推音频')
      return
    }
    const payload = JSON.parse(data)
    if (payload.header.action === 'run-task') {
      setImmediate(() => {
        startedPushed = true
        socket.push(startedEvent(payload.header.task_id))
      })
    }
    if (payload.header.action === 'finish-task') {
      setImmediate(() => socket.push(finishedEvent()))
    }
  }

  const client = createCloudAsrClient({ config: makeConfig(), logger: loggerSpy(), WebSocketImpl: FakeWebSocket })
  const result = await client.transcribe(frames(2))
  assert.equal(result.ok, true)
})

test('服务端 task-failed → E_LLM 并带服务端码', async () => {
  FakeWebSocket.onSend = (socket, data) => {
    if (typeof data !== 'string') return
    const payload = JSON.parse(data)
    if (payload.header.action === 'run-task') {
      setImmediate(() => socket.push(failedEvent('模型不可用', 'InvalidParameter')))
    }
  }

  const logger = loggerSpy()
  const client = createCloudAsrClient({ config: makeConfig(), logger, WebSocketImpl: FakeWebSocket, runId: 'm-2' })
  const result = await client.transcribe(frames(1))

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_LLM')
  assert.match(result.message, /模型不可用/)
  assert.equal(result.detail.serverCode, 'InvalidParameter')
})

test('空闲超时 → E_LLM，不挂死', async () => {
  FakeWebSocket.onSend = () => { /* 服务端不回任何事件 */ }
  const client = createCloudAsrClient({
    config: makeConfig({ idleTimeoutMs: 50 }),
    logger: loggerSpy(),
    WebSocketImpl: FakeWebSocket,
  })
  const result = await client.transcribe(frames(1))

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_LLM')
  assert.match(result.message, /超时/)
})

test('连接中途关闭 → E_LLM', async () => {
  FakeWebSocket.onSend = (socket, data) => {
    if (typeof data !== 'string') return
    const payload = JSON.parse(data)
    if (payload.header.action === 'run-task') {
      setImmediate(() => socket.push(startedEvent(payload.header.task_id)))
      setImmediate(() => socket.close())
    }
  }

  const client = createCloudAsrClient({ config: makeConfig(), logger: loggerSpy(), WebSocketImpl: FakeWebSocket })
  const result = await client.transcribe(frames(1))

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_LLM')
  assert.match(result.message, /关闭/)
})

test('服务端返回畸形 JSON → E_LLM', async () => {
  FakeWebSocket.onSend = (socket, data) => {
    if (typeof data !== 'string') return
    const payload = JSON.parse(data)
    if (payload.header.action === 'run-task') {
      setImmediate(() => socket.pushRaw('this-is-not-json'))
    }
  }

  const client = createCloudAsrClient({ config: makeConfig(), logger: loggerSpy(), WebSocketImpl: FakeWebSocket })
  const result = await client.transcribe(frames(1))

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_LLM')
})

test('握手 401 → E_DEP（配置问题而非服务问题）', async () => {
  FakeWebSocket.failHandshake = true
  const client = createCloudAsrClient({ config: makeConfig(), logger: loggerSpy(), WebSocketImpl: FakeWebSocket })
  const result = await client.transcribe(frames(1))

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_DEP')
  assert.match(result.message, /鉴权失败/)
})

test('日志含连接/启动/首包/结束，且不含密钥', async () => {
  installHappyServer()
  const logger = loggerSpy()
  const client = createCloudAsrClient({ config: makeConfig(), logger, WebSocketImpl: FakeWebSocket, runId: 'm-3' })
  await client.transcribe(frames(2))

  const messages = logger.lines.map((line) => line.message)
  assert.ok(messages.includes('连接建立'))
  assert.ok(messages.includes('task-started'))
  assert.ok(messages.includes('首条最终结果'))
  assert.ok(messages.includes('task-finished'))
  const serialized = JSON.stringify(logger.lines)
  assert.ok(!serialized.includes('sk-test-key'), '日志中不得出现密钥')
})

test('空音频也走完协议（直接 finish-task）', async () => {
  installHappyServer({ sentences: [] })
  const client = createCloudAsrClient({ config: makeConfig(), logger: loggerSpy(), WebSocketImpl: FakeWebSocket })
  const result = await client.transcribe([])

  assert.equal(result.ok, true)
  assert.deepEqual(result.segments, [])
})
