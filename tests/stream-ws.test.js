/**
 * 真实 WebSocket 传输联调（不是假 WS）。
 *
 * 目的：本机没有云端 Key 时，也要能证明「ws 客户端 + Authorization 头 + append/commit」
 * 这条链路在真实实现上是通的——用本地 ws 服务端当对端，事件按 DashScope 的时序发回。
 *
 * @module dsh-note-taker/tests/stream-ws
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { WebSocket, WebSocketServer } from 'ws'

import { createStreamSession } from '../lib/asr/stream.js'

function loggerSpy() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') }
}

/** 轮询等待条件成立（避免对时序做假设） */
async function waitFor(predicate, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`等待超时：${message}`)
}

/** 起一个本地「像 DashScope」的服务端，记录它收到的一切 */
async function startServer() {
  const server = new WebSocketServer({ port: 0 })
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()

  const seen = { authorization: null, updates: [], appends: 0, commits: 0 }

  server.on('connection', (socket, request) => {
    seen.authorization = request.headers.authorization ?? null
    socket.send(JSON.stringify({ type: 'session.created', session: { id: 'sess_local' } }))

    socket.on('message', (raw) => {
      const event = JSON.parse(String(raw))
      if (event.type === 'session.update') {
        seen.updates.push(event.session)
        socket.send(JSON.stringify({ type: 'session.updated', session: { model: event.session.input_audio_transcription?.model } }))
        return
      }
      if (event.type === 'input_audio_buffer.append') {
        seen.appends += 1
        if (seen.appends === 1) {
          // 真实服务端由 VAD 触发；这里手动补上，让时间戳推导有起点
          socket.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }))
          socket.send(JSON.stringify({ type: 'conversation.item.created', item: { id: 'item_1' } }))
        }
        return
      }
      if (event.type === 'input_audio_buffer.commit') {
        seen.commits += 1
        // 实测顺序：speech_stopped → committed → completed
        socket.send(JSON.stringify({ type: 'input_audio_buffer.speech_stopped' }))
        socket.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'item_1' }))
        socket.send(JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'item_1',
          transcript: '本地联调成功。',
        }))
      }
    })
  })

  return {
    port,
    seen,
    url: `ws://127.0.0.1:${port}/api-ws/v1/realtime`,
    close: async () => {
      // 客户端还连着时 server.close() 会一直等，先掐断连接
      for (const client of server.clients) client.terminate()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

test('真实 ws：带 Authorization 头建连，PCM 分帧推流，commit 后收尾出字', async () => {
  const server = await startServer()
  const logger = loggerSpy()

  const config = {
    enabled: true,
    available: true,
    model: 'qwen3-asr-flash-realtime',
    endpoint: server.url,
    apiKey: 'sk-local-test',
    sampleRate: 16000,
    frameBytes: 3200,
    connectTimeoutMs: 5000,
    finalizeTimeoutMs: 3000,
    reconnectAttempts: 2,
    sourceName: 'test',
  }

  const session = createStreamSession({ config, logger, runId: 'ws-local', settleMs: 60, WebSocketImpl: WebSocket })
  try {
    const connected = await session.connect()
    assert.equal(connected.ok, true, JSON.stringify(connected))
    await waitFor(() => server.seen.updates.length > 0, 'session.update 未到达服务端')
    assert.equal(server.seen.authorization, 'Bearer sk-local-test', '鉴权头必须真实发出去')
    assert.equal(server.seen.updates[0].input_audio_format, 'pcm', '格式必须是 pcm（不是 pcm16）')
    assert.equal(server.seen.updates[0].sample_rate, 16000)

    // 边录边推：service 的 tail 每次推一个 100ms 块（3200 字节），1 秒 = 10 块
    for (let i = 0; i < 10; i += 1) session.push(Buffer.alloc(3200, 1))
    await waitFor(() => server.seen.appends >= 10, `应发 10 帧，实际 ${server.seen.appends}`)
    assert.equal(server.seen.appends, 10, `应发 10 帧，实际 ${server.seen.appends}`)
    assert.equal(session.snapshot().state, 'streaming')

    const finalized = await session.finalize()
    assert.equal(finalized.ok, true, JSON.stringify(finalized))
    assert.equal(server.seen.commits, 1)
    assert.equal(finalized.segments.length, 1, `应有一段定稿，实际 ${finalized.segments.length}`)
    assert.equal(finalized.segments[0].text, '本地联调成功。')
    assert.ok(finalized.segments[0].endSec >= finalized.segments[0].startSec)
    assert.equal(session.snapshot().state, 'done')
    assert.ok(logger.lines.some((line) => line.message === '流式会话已建立'))
    assert.ok(logger.lines.some((line) => line.message === '收尾完成'))
  } finally {
    session.close()
    await server.close()
  }
})

test('真实 ws：服务端拒绝（无鉴权）时降级，不抛异常', async () => {
  const config = {
    enabled: true,
    available: true,
    model: 'qwen3-asr-flash-realtime',
    endpoint: 'ws://127.0.0.1:1/api-ws/v1/realtime',
    apiKey: 'sk-local-test',
    sampleRate: 16000,
    frameBytes: 3200,
    connectTimeoutMs: 300,
    finalizeTimeoutMs: 500,
    reconnectAttempts: 1,
    sourceName: 'test',
  }

  const session = createStreamSession({ config, logger: loggerSpy(), runId: 'ws-down', settleMs: 40, reconnectDelayMs: 10 })
  const connected = await session.connect()
  assert.equal(connected.ok, false, '连不上必须如实返回失败')
  await waitFor(() => session.snapshot().state === 'degraded', '重试用尽后应降级')
  assert.equal(session.snapshot().state, 'degraded')

  // 降级后 push 不该抛（录音还在继续）
  assert.doesNotThrow(() => session.push(Buffer.alloc(3200, 1)))
  const finalized = await session.finalize()
  assert.equal(finalized.ok, true)
  assert.equal(finalized.degraded, true)
})