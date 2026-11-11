/**
 * 流式 ASR 客户端（DashScope realtime，OpenAI-Realtime 风格事件）。
 *
 * 协议事实全部来自 2026-11-11 探针实测（specs/20261111_streaming-asr/plan.md）：
 * - 端点 `wss://<host>/api-ws/v1/realtime?model=<id>`，鉴权 `Authorization: Bearer <key>`
 * - `session.update` 的 `input_audio_format` 必须是 `pcm`（写 pcm16 会被拒）
 * - 中间结果 = `text` + `stash`；最终结果 = `completed.transcript`
 * - 服务端 VAD 自动切句；完成事件**没有时间戳**，只能本地按时钟推导
 *
 * 本模块不碰文件、不碰宿主，只负责「连上 → 推流 → 收字 → 收尾」，
 * 便于用假 WebSocket 做契约测试（真机验证在 T-09）。
 *
 * @module dsh-note-taker/asr/stream
 */

import { CODES, err, ok } from '../errors.js'

export const STREAM_STATES = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  STREAMING: 'streaming',
  FINALIZING: 'finalizing',
  DONE: 'done',
  DEGRADED: 'degraded',
})

export const EVENTS = Object.freeze({
  created: 'session.created',
  updated: 'session.updated',
  append: 'input_audio_buffer.append',
  commit: 'input_audio_buffer.commit',
  speechStarted: 'input_audio_buffer.speech_started',
  speechStopped: 'input_audio_buffer.speech_stopped',
  committed: 'input_audio_buffer.committed',
  itemCreated: 'conversation.item.created',
  partial: 'conversation.item.input_audio_transcription.text',
  completed: 'conversation.item.input_audio_transcription.completed',
  error: 'error',
})

const BYTES_PER_SECOND_BASE = 2 // s16le 单声道

/** 已发送字节数 → 音频秒数 */
export function secondsOf(bytes, sampleRate = 16000) {
  return Math.round((bytes / (sampleRate * BYTES_PER_SECOND_BASE)) * 1000) / 1000
}

export function buildSessionUpdate(model, sampleRate = 16000) {
  return {
    type: 'session.update',
    session: {
      modalities: ['text'],
      input_audio_format: 'pcm',
      sample_rate: sampleRate,
      input_audio_transcription: { model },
    },
  }
}

/**
 * 建一个流式会话对象（不自动连接，调用 connect()）。
 *
 * @param {object} options
 * @param {object} options.config         resolveStreamConfig().config
 * @param {object} [options.logger]
 * @param {string} [options.runId]        meetingId，用于日志串联
 * @param {Function} [options.WebSocketImpl] 测试注入假 WS
 * @param {Function} [options.now]        测试注入时钟
 * @param {Function} [options.onEvent]    状态/文本变化回调（前端不直接依赖它，路由走 snapshot）
 * @param {number} [options.settleMs]     收尾静默判定窗口
 */
export function createStreamSession(options = {}) {
  const {
    config,
    logger,
    runId = 'stream',
    WebSocketImpl = globalThis.WebSocket,
    now = () => Date.now(),
    onEvent = () => {},
    settleMs = 600,
  } = options
  if (!config) throw new Error('createStreamSession 需要 config')

  const sampleRate = config.sampleRate ?? 16000
  const frameBytes = config.frameBytes ?? 3200
  const state = {
    status: STREAM_STATES.IDLE,
    startedAt: null,
    endedAt: null,
    sentBytes: 0,
    error: null,
    degradedReason: null,
    sessionId: null,
  }

  let socket = null
  let ready = false
  let queue = [] // 未连上前的音频帧
  let lastProgressAt = 0
  let lastEventAt = 0
  let commitSentAt = 0
  let reconnects = 0
  let closedByUs = false
  let finalizeWaiter = null
  let connectWaiter = null
  const reconnectDelayMs = options.reconnectDelayMs ?? 1000

  const drafts = new Map() // item_id -> { text, stash }
  const itemStart = new Map() // item_id -> startSec
  const finals = [] // { id, startSec, endSec, text }
  const finalizedIds = new Set()
  let pendingStart = 0
  let pendingEnd = null

  const emit = (kind, payload = {}) => {
    try {
      onEvent({ kind, ...payload, snapshot: snapshot() })
    } catch {
      // 回调方异常不能影响主链路
    }
  }

  function snapshot() {
    const partial = [...drafts.values()].map((d) => `${d.text}${d.stash}`).join('')
    return {
      state: state.status,
      sessionId: state.sessionId,
      audioSecondsSent: secondsOf(state.sentBytes, sampleRate),
      chars: finals.reduce((sum, item) => sum + item.text.length, 0),
      partial,
      finals: finals.map((item) => ({ startSec: item.startSec, endSec: item.endSec, text: item.text })),
      error: state.error,
      degradedReason: state.degradedReason,
    }
  }

  function setStatus(next, extra = {}) {
    if (state.status === next) return
    state.status = next
    emit('state', { state: next, ...extra })
  }

  function fail(code, message, detail = {}) {
    state.error = { code, message, ...detail }
    emit('error', { error: state.error })
  }

  function connect() {
    if (state.status === STREAM_STATES.STREAMING) return Promise.resolve(ok({ sessionId: state.sessionId }))
    setStatus(STREAM_STATES.CONNECTING)
    if (state.startedAt === null) state.startedAt = now()

    return new Promise((resolve) => {
      let settled = false
      const settle = (result) => {
        if (settled) return
        settled = true
        connectWaiter = null
        resolve(result)
      }
      connectWaiter = settle

      let ws
      try {
        ws = new WebSocketImpl(`${config.endpoint}?model=${encodeURIComponent(config.model)}`, {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        })
      } catch (error) {
        logger?.error('流式连接构造失败', { runId, message: error.message })
        fail('E_DEP', `无法创建 WebSocket 连接：${error.message}`)
        degrade('connect_failed')
        settle(err(CODES.E_DEP, `无法创建 WebSocket 连接：${error.message}`))
        return
      }
      socket = ws

      const connectTimer = setTimeout(() => {
        logger?.error('流式连接超时', { runId, timeoutMs: config.connectTimeoutMs })
        fail('E_TIMEOUT', `流式连接超时（${config.connectTimeoutMs}ms）`)
        degrade('connect_timeout')
        settle(err(CODES.E_TIMEOUT, '流式连接超时'))
      }, config.connectTimeoutMs ?? 10_000)

      ws.onopen = () => {
        logger?.info('流式会话已建立', { runId, model: config.model, sampleRate, endpoint: config.endpoint })
        try {
          ws.send(JSON.stringify(buildSessionUpdate(config.model, sampleRate)))
        } catch (error) {
          logger?.error('流式会话参数发送失败', { runId, message: error.message })
        }
      }

      ws.onmessage = async (message) => {
        if (typeof message.data !== 'string') return
        let event
        try {
          event = JSON.parse(message.data)
        } catch {
          logger?.warn('流式事件非 JSON，已忽略', { runId, preview: String(message.data).slice(0, 120) })
          return
        }
        lastEventAt = now()

        switch (event.type) {
          case EVENTS.created: {
            state.sessionId = event.session?.id ?? null
            ready = true
            clearTimeout(connectTimer)
            setStatus(STREAM_STATES.STREAMING)
            settle(ok({ sessionId: state.sessionId }))
            drainQueue()
            return
          }
          case EVENTS.updated: {
            logger?.debug('流式会话参数已被接受', { runId, model: event.session?.model, format: event.session?.input_audio_format })
            return
          }
          case EVENTS.speechStarted: {
            pendingStart = secondsOf(state.sentBytes, sampleRate)
            pendingEnd = null
            return
          }
          case EVENTS.itemCreated: {
            const id = event.item?.id
            if (id) itemStart.set(id, pendingStart)
            return
          }
          case EVENTS.speechStopped: {
            pendingEnd = secondsOf(state.sentBytes, sampleRate)
            return
          }
          case EVENTS.partial: {
            const id = event.item_id
            if (!id || finalizedIds.has(id)) return // R-03：最终结果不被中间结果改写
            drafts.set(id, { text: event.text ?? '', stash: event.stash ?? '' })
            emit('partial')
            return
          }
          case EVENTS.completed: {
            const id = event.item_id
            const text = String(event.transcript ?? '').trim()
            if (!id || finalizedIds.has(id)) return
            finalizedIds.add(id)
            drafts.delete(id)
            if (text) {
              const start = itemStart.get(id) ?? pendingStart ?? 0
              const end = pendingEnd !== null && pendingEnd >= start
                ? pendingEnd
                : Math.round((start + Number(event.usage?.duration ?? 0)) * 1000) / 1000
              finals.push({ id, startSec: start, endSec: end, text })
            }
            emit('final')
            return
          }
          case EVENTS.committed: {
            // 注意：completed 在 committed 之后才到（实测 0.15s），这里只记录不结束收尾
            return
          }
          case EVENTS.error: {
            const info = event.error ?? {}
            logger?.error('流式服务返回错误', { runId, code: info.code, message: info.message })
            fail(info.code ?? 'E_STREAM', info.message ?? '流式服务返回错误')
            return
          }
          default: {
            logger?.debug('流式事件未处理', { runId, type: event.type })
          }
        }
      }

      ws.onerror = (event) => {
        logger?.warn('流式连接异常', { runId, message: event?.message ?? '' })
      }

      ws.onclose = (event) => {
        clearTimeout(connectTimer)
        ready = false
        if (closedByUs || state.status === STREAM_STATES.DONE) return
        if (event?.code && event.code !== 1000 && event.code !== 1005) {
          fail('E_STREAM_CLOSED', `流式连接中断（code=${event.code}）`)
        }
        if (state.status === STREAM_STATES.FINALIZING) {
          maybeFinish()
          return
        }
        // 还在建连就断了：先把 connect() 的等待者叫醒（否则调用方永远等下去），再按策略重连
        if (state.status === STREAM_STATES.CONNECTING && connectWaiter) {
          const waiter = connectWaiter
          connectWaiter = null
          waiter(err(CODES.E_DEP, '流式连接中断（未建立）'))
        }
        handleDisconnect()
      }
    })
  }

  function handleDisconnect() {
    if (reconnects >= (config.reconnectAttempts ?? 2)) {
      logger?.warn('降级', { runId, 原因: 'reconnect_exceeded', finals: finals.length, reason: 'reconnect_exceeded' })
      degrade('reconnect_exceeded')
      return
    }
    reconnects += 1
    setStatus(STREAM_STATES.CONNECTING)
    const delay = reconnectDelayMs * reconnects
    logger?.warn('流式连接中断，准备重连', { runId, attempt: reconnects, delayMs: delay })
    setTimeout(() => {
      if (state.status !== STREAM_STATES.CONNECTING) return
      connect().catch(() => {})
    }, delay)
  }

  function degrade(reason) {
    state.degradedReason = reason
    ready = false
    setStatus(STREAM_STATES.DEGRADED, { reason })
    resolveFinalize()
  }

  function drainQueue() {
    const pending = queue
    queue = []
    for (const chunk of pending) sendAudio(chunk)
  }

  function sendAudio(chunk) {
    if (!socket || !ready) {
      queue.push(chunk)
      if (queue.length > 1200) queue.shift() // 约 2 分钟，超了就丢最旧的
      return
    }
    try {
      socket.send(JSON.stringify({ type: EVENTS.append, audio: chunk.toString('base64') }))
      state.sentBytes += chunk.length
      if (state.sentBytes === chunk.length) {
        logger?.debug('首帧已发送', { runId, bytes: chunk.length })
      }
      const at = now()
      if (at - lastProgressAt >= 30_000) {
        lastProgressAt = at
        logger?.info('推流进度', { runId, audioSecondsSent: secondsOf(state.sentBytes, sampleRate), finals: finals.length, chars: snapshot().chars })
      }
      emit('audio')
    } catch (error) {
      logger?.warn('音频帧发送失败，已入队等待重连', { runId, message: error.message })
      queue.push(chunk)
    }
  }

  function push(chunk) {
    if (!chunk || chunk.length === 0) return
    if (state.status === STREAM_STATES.FINALIZING || state.status === STREAM_STATES.DONE) return
    sendAudio(chunk)
  }

  function maybeFinish() {
    if (state.status !== STREAM_STATES.FINALIZING) return
    // 静默窗口从「最后一个事件」和「commit 发出」里更晚的那个算起：
    // 否则刚 commit 就会被判定为安静，残句还没回来就收尾了（会丢最后一句）
    const quiet = now() - Math.max(lastEventAt, commitSentAt)
    if (quiet >= settleMs) {
      resolveFinalize()
      return
    }
    // 残句还在定稿：等事件安静下来（实测 committed 之后才有 completed）
    setTimeout(maybeFinish, Math.max(20, settleMs - quiet + 5))
  }

  function resolveFinalize() {
    if (!finalizeWaiter) return
    const waiter = finalizeWaiter
    finalizeWaiter = null
    waiter()
  }

  /**
   * 停录收尾：发 commit，等残句定稿，返回最终段。
   * @returns {Promise<{ok:true, segments:Array, timedOut:boolean, degraded:boolean, snapshot:object}>}
   */
  function finalize() {
    if (state.status === STREAM_STATES.DONE) {
      return Promise.resolve(ok({ segments: finals.map(toSegment), timedOut: false, degraded: false, snapshot: snapshot() }))
    }
    if (state.status === STREAM_STATES.DEGRADED) {
      // 已经降级：不再假装收尾，直接把已定的段交出去（调用方据此回退非流式）
      return Promise.resolve(ok({ segments: finals.map(toSegment), timedOut: false, degraded: true, snapshot: snapshot() }))
    }
    return new Promise((resolve) => {
      const startedFinalize = now()
      let timedOut = false
      const finish = () => {
        if (state.status === STREAM_STATES.FINALIZING) setStatus(STREAM_STATES.DONE)
        closedByUs = true
        ready = false
        try {
          socket?.close()
        } catch {
          // 忽略关闭异常
        }
        state.endedAt = now()
        const elapsedMs = state.endedAt - startedFinalize
        const snap = snapshot()
        logger?.info('收尾完成', { runId, 耗时: elapsedMs, finals: finals.length, chars: snap.chars, 是否超时: timedOut })
        resolve(ok({ segments: finals.map(toSegment), timedOut, degraded: state.status === STREAM_STATES.DEGRADED, snapshot: snap }))
      }

      finalizeWaiter = finish
      setStatus(STREAM_STATES.FINALIZING)
      commitSentAt = now()

      try {
        socket?.send(JSON.stringify({ type: EVENTS.commit }))
      } catch (error) {
        logger?.warn('收尾 commit 发送失败，用已有最终段落盘', { runId, message: error.message })
      }

      setTimeout(() => {
        if (!finalizeWaiter) return
        timedOut = true
        logger?.warn('收尾超时，用已有最终段落盘', { runId, timeoutMs: config.finalizeTimeoutMs })
        resolveFinalize()
      }, config.finalizeTimeoutMs ?? 10_000)

      // 等事件安静（实测顺序是 committed → completed，不能在 committed 时就收）
      maybeFinish()
    })
  }

  function toSegment(item) {
    return { startSec: item.startSec, endSec: item.endSec, text: item.text }
  }

  function close() {
    closedByUs = true
    ready = false
    try {
      socket?.close()
    } catch {
      // 忽略
    }
    socket = null
    if (state.status !== STREAM_STATES.DONE && state.status !== STREAM_STATES.DEGRADED) {
      setStatus(STREAM_STATES.DONE)
    }
  }

  return {
    connect,
    push,
    finalize,
    close,
    snapshot,
    get state() {
      return state.status
    },
    get finals() {
      return finals.map(toSegment)
    },
  }
}