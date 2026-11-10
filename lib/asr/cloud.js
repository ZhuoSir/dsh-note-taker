/**
 * 阿里云百炼实时语音识别（qwen-audio-*-asr-flash-streaming）客户端。
 *
 * 协议（官方文档）：
 *   连接 → run-task → 等 task-started → 推二进制音频帧 → finish-task
 *   → 收 result-generated 直到 task-finished → 关闭
 *
 * 实现要点：
 * - WebSocket 用 `ws`：Node 内置实现不能带 Authorization 握手头（plan 决策 1）
 * - WebSocket 实现可注入，单测用假客户端，不碰真实网络（R-10）
 * - 推流默认 1x 实时速率（plan 决策 2），倍速可配
 * - 空闲超时、服务端 task-failed、握手指纹失败都收敛成结构化错误（R-05）
 *
 * @module dsh-note-taker/asr/cloud
 */

import { randomUUID } from 'node:crypto'

import { aggregateSentences } from './aggregate.js'
import { CODES, err, ok } from '../errors.js'

const DEFAULT_FRAME_MS = 100
const MIN_FRAME_MS = 1

function endpointHost(endpoint) {
  try {
    return new URL(endpoint).host
  } catch {
    return String(endpoint)
  }
}

function buildRunTask({ taskId, model, sampleRate, vocabulary, languageHint }) {
  const parameters = {
    format: 'pcm',
    sample_rate: sampleRate,
  }
  if (vocabulary && Object.keys(vocabulary).length > 0) parameters.vocabulary = vocabulary
  if (languageHint) parameters.language_hints = [languageHint]

  return {
    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model,
      parameters,
      input: {},
    },
  }
}

function buildFinishTask(taskId) {
  return {
    header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: {} },
  }
}

/**
 * @param {object} options
 * @param {object} options.config resolveCloudAsrConfig() 产出的 config
 * @param {object} options.logger
 * @param {Function} options.WebSocketImpl WebSocket 构造器（测试注入假实现）
 * @param {string} [options.runId]
 * @param {string} [options.languageHint] 默认 'zh'
 */
export function createCloudAsrClient({ config, logger, WebSocketImpl, runId = '-', languageHint = 'zh' }) {
  if (!config?.endpoint || !config?.apiKey) throw new Error('createCloudAsrClient 缺少 endpoint 或 apiKey')
  if (typeof WebSocketImpl !== 'function') throw new Error('createCloudAsrClient 需要 WebSocketImpl')

  /**
   * @param {Buffer[]} frames 已切好的 PCM 帧
   * @returns {Promise<object>} 成功信封或错误信封
   */
  async function transcribe(frames) {
    const started = Date.now()
    const taskId = randomUUID()
    const frameMs = Math.max(MIN_FRAME_MS, Math.round(DEFAULT_FRAME_MS / (config.speed || 1)))
    const events = []
    let firstResultAt = null
    let sentFrames = 0
    let settled = false
    let idleTimer = null
    let streamTimer = null
    let settle = () => {}

    const socket = new WebSocketImpl(config.endpoint, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'user-agent': 'dsh-note-taker',
      },
    })

    const done = new Promise((resolve) => {
      settle = resolve
    })

    function finish(result) {
      if (settled) return
      settled = true
      clearTimeout(idleTimer)
      clearInterval(streamTimer)
      try {
        socket.close()
      } catch { /* 已关闭 */ }
      settle(result)
    }

    function armIdle() {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        logger?.error('连接/推流失败', {
          meetingId: runId,
          code: CODES.E_LLM,
          reason: `空闲超过 ${config.idleTimeoutMs ?? 60000}ms 无响应`,
        }, runId)
        finish(err(CODES.E_LLM, '云端 ASR 超时：长时间没有收到任何事件', { taskId }))
      }, config.idleTimeoutMs ?? 60_000)
    }

    function startStreaming() {
      logger?.info('task-started', { taskId, model: config.model, frames: frames.length }, runId)
      if (frames.length === 0) {
        socket.send(JSON.stringify(buildFinishTask(taskId)))
        return
      }

      let index = 0
      streamTimer = setInterval(() => {
        if (settled) return
        if (index >= frames.length) {
          clearInterval(streamTimer)
          socket.send(JSON.stringify(buildFinishTask(taskId)))
          return
        }
        socket.send(frames[index])
        sentFrames += 1
        index += 1
        if (sentFrames % 300 === 0) {
          logger?.debug('推流进度', { meetingId: runId, frames: sentFrames, bytes: sentFrames * frames[0].length }, runId)
        }
      }, frameMs)
    }

    socket.on?.('open', () => {
      logger?.info('连接建立', { meetingId: runId, host: endpointHost(config.endpoint), elapsedMs: Date.now() - started }, runId)
      armIdle()
      socket.send(JSON.stringify(buildRunTask({
        taskId,
        model: config.model,
        sampleRate: config.sampleRate ?? 16_000,
        vocabulary: config.vocabulary,
        languageHint,
      })))
    })

    socket.on?.('message', (data, isBinary) => {
      armIdle()
      if (isBinary) return
      let event
      try {
        event = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'))
      } catch (error) {
        logger?.error('连接/推流失败', { meetingId: runId, code: CODES.E_LLM, reason: '服务端返回非 JSON' }, runId)
        finish(err(CODES.E_LLM, '云端 ASR 返回了无法解析的数据', { taskId }))
        return
      }

      const name = event?.header?.event
      if (name === 'task-started') {
        startStreaming()
        return
      }
      if (name === 'result-generated') {
        events.push(event)
        if (firstResultAt === null && event?.payload?.output?.sentence?.sentence_end === true) {
          firstResultAt = Date.now()
          logger?.info('首条最终结果', { meetingId: runId, sentenceId: event.payload.output.sentence.sentence_id }, runId)
        }
        return
      }
      if (name === 'task-failed') {
        const payload = event?.payload ?? {}
        const header = event?.header ?? {}
        const reason = payload.message ?? payload.error_message ?? payload.error_code
          ?? header.error_code ?? header.error_message ?? payload.code ?? '任务失败'
        logger?.error('连接/推流失败', {
          meetingId: runId,
          code: CODES.E_LLM,
          serverCode: header.error_code ?? payload.error_code ?? payload.code,
          reason: String(reason).slice(0, 200),
          rawEvent: JSON.stringify(event).slice(0, 500),
        }, runId)
        finish(err(CODES.E_LLM, `云端 ASR 任务失败：${reason}`, {
          taskId,
          serverCode: header.error_code ?? payload.error_code ?? payload.code ?? null,
          serverPayload: JSON.stringify(event).slice(0, 500),
        }))
        return
      }
      if (name === 'task-finished') {
        events.push(event)
        const { segments, usage, dropped } = aggregateSentences(events)
        const elapsedSec = Math.round(((Date.now() - started) / 1000) * 10) / 10
        logger?.info('task-finished', {
          meetingId: runId,
          segments: segments.length,
          usageDuration: usage?.duration,
          elapsedSec,
          droppedInterim: dropped.interim,
          droppedHeartbeat: dropped.heartbeat,
        }, runId)
        finish(ok({ taskId, segments, usage, elapsedSec, frames: sentFrames, dropped }))
      }
    })

    socket.on?.('error', (error) => {
      const raw = String(error?.message ?? error)
      // ws 在握手被拒时给的是 "Unexpected server response: 401"，statusCode 不一定带
      const statusFromMessage = raw.match(/\b(401|403|404|429)\b/)?.[1]
      const status = error?.statusCode ?? error?.status ?? (statusFromMessage ? Number(statusFromMessage) : null)
      const code = status === 401 || status === 403 ? CODES.E_DEP : CODES.E_LLM
      logger?.error('连接/推流失败', {
        meetingId: runId,
        code,
        httpStatus: status,
        reason: raw.slice(0, 200),
      }, runId)
      finish(err(code, status === 401 || status === 403
        ? '云端 ASR 鉴权失败：请检查 DASHSCOPE_API_KEY 是否有效、以及端点是否匹配该工作空间'
        : `云端 ASR 连接失败：${raw}`, { taskId, httpStatus: status }))
    })

    socket.on?.('close', () => {
      if (!settled) {
        logger?.error('连接/推流失败', { meetingId: runId, code: CODES.E_LLM, reason: '连接在任务完成前关闭' }, runId)
        finish(err(CODES.E_LLM, '云端 ASR 连接在任务完成前关闭', { taskId, sentFrames }))
      }
    })

    return done
  }

  return { transcribe }
}
