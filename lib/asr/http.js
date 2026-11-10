/**
 * 百炼非实时语音识别（Qwen-Audio-ASR）HTTP 客户端。
 *
 * 接口（官方文档 + 真机实测）：
 *   POST {endpoint}           // 默认 .../api/v1/services/aigc/multimodal-generation/generation
 *   Authorization: Bearer <key>
 *   Content-Type: application/json
 *   X-DashScope-SSE: disable
 *   {
 *     model: 'qwen-audio-3.0-asr-flash',
 *     input: { messages: [{ role:'user', content:[{ type:'input_audio',
 *              input_audio: { data: 'data:audio/wav;base64,...' } }] }] },
 *     parameters: { format: 'wav', sample_rate: '16000' }
 *   }
 *
 * 为什么是 HTTP 而不是流式：该工作空间只有非流式模型，实测流式端点收下 run-task 后
 * 无后端可路由（CR-01）。HTTP 一次返回，1 秒级，比 1x 推流快两个数量级。
 *
 * @module dsh-note-taker/asr/http
 */

import { CODES, err, ok } from '../errors.js'

export const MIME_BY_FORMAT = Object.freeze({
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
})

/** 组装请求体：字段与官方示例逐项对应 */
export function buildRequestBody({ model, audioBase64, format = 'wav', sampleRate = 16000, terms, diarization = false }) {
  const content = []

  // 上下文增强：把术语作为前一轮 user 文本传给模型（文档的 input_text）。
  // 实测：开启说话人分离时只要带 input_text，speaker_id 会全部退化成 -1（分人失效），
  // 所以两者互斥——分人优先。
  if (!diarization && Array.isArray(terms) && terms.length > 0) {
    content.push({ type: 'input_text', text: `领域词表：${terms.join('、')}` })
  }
  content.push({
    type: 'input_audio',
    input_audio: { data: `data:${MIME_BY_FORMAT[format] ?? 'audio/wav'};base64,${audioBase64}` },
  })

  const parameters = { format, sample_rate: String(sampleRate) }
  // 说话人分离：仅 qwen-audio-3.1-asr-flash 生效（3.0 会忽略该参数，speaker_id 恒为 null）
  if (diarization) parameters.speaker_diarization_enabled = true

  return {
    model,
    input: { messages: [{ role: 'user', content }] },
    parameters,
  }
}

function mapHttpError(status, body, rawText) {
  const message = body?.message ?? body?.error?.message ?? rawText?.slice(0, 200) ?? ''
  if (status === 401 || status === 403) {
    return err(CODES.E_DEP, `云端 ASR 鉴权失败（HTTP ${status}）：请检查 DASHSCOPE_API_KEY 与该端点的匹配关系`, { httpStatus: status, serverMessage: message })
  }
  if (status === 429) {
    return err(CODES.E_LLM, `云端 ASR 被限流（HTTP 429）：${message}`, { httpStatus: status, serverMessage: message })
  }
  return err(CODES.E_LLM, `云端 ASR 调用失败（HTTP ${status}）：${message}`, { httpStatus: status, serverMessage: message })
}

/**
 * @param {object} options
 * @param {object} options.config resolveCloudAsrConfig 的 config
 * @param {Buffer} options.audio 归一化后的音频字节
 * @param {string} [options.format] wav/mp3/m4a…
 * @param {string[]} [options.terms]
 * @param {object} options.logger
 * @param {Function} [options.fetchImpl] 测试注入假 fetch
 * @param {string} [options.runId]
 */
export async function recognizeWithHttp({ config, audio, format = 'wav', terms, logger, fetchImpl = globalThis.fetch, runId = '-', offsetSec = 0 }) {
  if (typeof fetchImpl !== 'function') return err(CODES.E_DEP, '当前运行时没有 fetch，无法调用云端 ASR', {})
  if (!Buffer.isBuffer(audio) || audio.length === 0) return err(CODES.E_AUDIO, '没有可上传的音频数据', {})

  const audioBase64 = audio.toString('base64')
  const body = buildRequestBody({
    model: config.model,
    audioBase64,
    format,
    sampleRate: config.sampleRate ?? 16000,
    terms,
    diarization: config.diarization === true,
  })

  const controller = new AbortController()
  const timeoutMs = config.requestTimeoutMs ?? 180_000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()

  logger?.info('云端识别请求', {
    meetingId: runId,
    model: config.model,
    audioBytes: audio.length,
    base64Bytes: audioBase64.length,
    timeoutMs,
  }, runId)

  let response
  try {
    response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-SSE': 'disable',
        'user-agent': 'dsh-note-taker',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    const aborted = error?.name === 'AbortError'
    logger?.error('云端识别失败', {
      meetingId: runId,
      code: CODES.E_LLM,
      reason: aborted ? `请求超时（${timeoutMs}ms）` : String(error?.message ?? error).slice(0, 200),
    }, runId)
    return err(CODES.E_LLM, aborted ? `云端 ASR 请求超时（${timeoutMs}ms）` : `云端 ASR 网络请求失败：${error?.message ?? error}`, {})
  }

  const rawText = await response.text().catch(() => '')
  clearTimeout(timer)

  let parsed = null
  try {
    parsed = rawText ? JSON.parse(rawText) : null
  } catch {
    parsed = null
  }

  if (!response.ok) {
    const mapped = mapHttpError(response.status, parsed, rawText)
    logger?.error('云端识别失败', {
      meetingId: runId,
      code: mapped.code,
      httpStatus: response.status,
      serverMessage: String(mapped.detail?.serverMessage ?? '').slice(0, 200),
    }, runId)
    return mapped
  }

  const elapsedSec = Math.round(((Date.now() - started) / 1000) * 10) / 10
  logger?.info('云端识别完成', {
    meetingId: runId,
    elapsedSec,
    requestId: parsed?.request_id,
  }, runId)

  return ok({ payload: parsed, elapsedSec, offsetSec })
}
