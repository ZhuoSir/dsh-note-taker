/**
 * 云端 ASR 的配置解析。
 *
 * 设计要点：
 * - 配置来源抽象成 `source.get(name)`，当前实现读 process.env；
 *   以后页面要做可配时，只换 source，不动调用方。
 * - Key 缺失必须报 E_DEP，**不允许静默回退本地引擎**（否则用户以为走了云端）。
 * - 术语表作为上下文传给模型（HTTP 接口用 input_text，见 CR-01）。
 *
 * @module dsh-note-taker/asr/config
 */

import { CODES, err, ok } from '../errors.js'

export const ENV = Object.freeze({
  apiKey: 'DASHSCOPE_API_KEY',
  model: 'NOTE_TAKER_CLOUD_ASR_MODEL',
  endpoint: 'NOTE_TAKER_CLOUD_ASR_URL',
  engine: 'NOTE_TAKER_ASR_ENGINE',
  terms: 'NOTE_TAKER_ASR_TERMS',
  chunkSeconds: 'NOTE_TAKER_ASR_CHUNK_SECONDS',
  diarization: 'NOTE_TAKER_ASR_DIARIZATION',
})

/** 流式（realtime）专用环境变量；与 HTTP 非实时路径互不影响 */
export const STREAM_ENV = Object.freeze({
  enabled: 'NOTE_TAKER_STREAM_ENABLED',
  model: 'NOTE_TAKER_STREAM_MODEL',
  endpoint: 'NOTE_TAKER_STREAM_URL',
})

export const STREAM_DEFAULTS = Object.freeze({
  // 专用 ASR 实时模型；qwen-audio-*-realtime-* 是 omni 对话模型，会对音频「回话」，不选（2026-11-11 实测）
  model: 'qwen3-asr-flash-realtime',
  endpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
  enabled: false,
  sampleRate: 16_000,
  frameBytes: 3_200, // 100ms @16k mono s16le
  connectTimeoutMs: 10_000,
  finalizeTimeoutMs: 10_000,
  reconnectAttempts: 2,
})

const TRUE_VALUES = ['1', 'true', 'yes', 'on']
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const ENDPOINT_PATTERN = /^wss?:\/\/[^\s/]+/i

export const CLOUD_DEFAULTS = Object.freeze({
  // 3.1 支持说话人分离与文本润色；模型列表里可能看不到，但实测可调（2026-11-10）
  model: 'qwen-audio-3.1-asr-flash',
  // 非实时 HTTP 接口（CR-01）；Workspace 专属域名把 host 换成 {WorkspaceId}.cn-beijing.maas.aliyuncs.com 即可
  endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  requestTimeoutMs: 180_000,
  chunkSeconds: 300,
  sampleRate: 16_000,
  maxTerms: 200,
})

/** 环境变量来源；换成页面配置时只要实现同样的 get() */
export function createEnvSource(env = process.env) {
  return {
    name: 'env',
    get(key) {
      const value = env[key]
      return value === undefined || value === '' ? null : value
    },
  }
}

export function resolveDefaultEngine({ source = createEnvSource() } = {}) {
  const raw = (source.get(ENV.engine) ?? 'local').toLowerCase()
  return raw === 'cloud' ? 'cloud' : 'local'
}

/** 术语表：逗号分隔 → 数组，去重、截断并告警 */
export function parseTerms(raw, { maxTerms = CLOUD_DEFAULTS.maxTerms, logger } = {}) {
  if (!raw) return { terms: [], total: 0, kept: 0, truncated: false }

  const unique = [...new Set(String(raw).split(/[,，]/).map((item) => item.trim()).filter(Boolean))]
  const kept = unique.slice(0, maxTerms)
  if (unique.length > kept.length) {
    logger?.warn('术语超限截断', { total: unique.length, kept: kept.length })
  }
  return { terms: kept, total: unique.length, kept: kept.length, truncated: unique.length > kept.length }
}

/**
 * 由 HTTP 端点推导流式端点：取 host，拼 `/api-ws/v1/realtime`。
 * 推导失败（端点不是合法 URL）时回内置默认，不抛错。
 */
export function deriveStreamEndpoint(cloudEndpoint) {
  try {
    const url = new URL(String(cloudEndpoint))
    if (!url.host) return STREAM_DEFAULTS.endpoint
    return `wss://${url.host}/api-ws/v1/realtime`
  } catch {
    return STREAM_DEFAULTS.endpoint
  }
}

/**
 * 流式 ASR 配置解析。
 *
 * - `enabled`：用户是否要求走流式（配置项，缺省 false，不改变既有行为）
 * - `available`：配置是否完整可用（有 Key + 模型/端点合法）
 * - 两者分开：开了但没 Key 要给「已启用但不可用」的明确原因，而不是假装能用
 *
 * @returns {{ok:true, config:object} | {ok:false, code:string, message:string, detail:object}}
 */
export function resolveStreamConfig({ source = createEnvSource(), logger, overrides = {} } = {}) {
  const apiKey = overrides.apiKey ?? source.get(ENV.apiKey)
  const enabled = TRUE_VALUES.includes(String(overrides.enabled ?? source.get(STREAM_ENV.enabled) ?? '').toLowerCase())

  const model = String(overrides.model ?? source.get(STREAM_ENV.model) ?? STREAM_DEFAULTS.model).trim()
  if (!MODEL_PATTERN.test(model)) {
    return err(CODES.E_STATE, `流式模型名不合法：${model || '(空)'}`, { field: 'streamModel' })
  }

  const cloudEndpoint = overrides.cloudEndpoint ?? source.get(ENV.endpoint) ?? CLOUD_DEFAULTS.endpoint
  const rawEndpoint = overrides.endpoint ?? source.get(STREAM_ENV.endpoint)
  const endpoint = rawEndpoint ? String(rawEndpoint).trim() : deriveStreamEndpoint(cloudEndpoint)
  if (!ENDPOINT_PATTERN.test(endpoint)) {
    return err(CODES.E_STATE, `流式端点必须是 ws:// 或 wss://：${endpoint}`, { field: 'streamUrl' })
  }

  const available = Boolean(apiKey)
  const reason = available ? null : 'missing_key'
  if (enabled && !available) {
    // 启用了但缺 Key：给原因，不静默回退（R-07）
    logger?.warn('流式已启用但缺少密钥', { env: ENV.apiKey, model })
  }

  return ok({
    config: {
      enabled,
      available,
      reason,
      model,
      endpoint,
      apiKey: apiKey ?? null,
      sampleRate: STREAM_DEFAULTS.sampleRate,
      frameBytes: STREAM_DEFAULTS.frameBytes,
      connectTimeoutMs: STREAM_DEFAULTS.connectTimeoutMs,
      finalizeTimeoutMs: STREAM_DEFAULTS.finalizeTimeoutMs,
      reconnectAttempts: STREAM_DEFAULTS.reconnectAttempts,
      sourceName: source.name ?? 'custom',
    },
  })
}

/**
 * @returns {{ok:true, config:object} | {ok:false, code:string, message:string, detail:object}}
 */
export function resolveCloudAsrConfig({ source = createEnvSource(), logger, overrides = {} } = {}) {
  const apiKey = overrides.apiKey ?? source.get(ENV.apiKey)
  if (!apiKey) {
    logger?.error('密钥缺失，云端 ASR 不可用', { env: ENV.apiKey })
    return err(CODES.E_DEP, `缺少云端 ASR 密钥：请配置环境变量 ${ENV.apiKey}`, { env: ENV.apiKey })
  }

  const rawChunk = Number(overrides.chunkSeconds ?? source.get(ENV.chunkSeconds) ?? CLOUD_DEFAULTS.chunkSeconds)
  const chunkSeconds = Number.isFinite(rawChunk) && rawChunk >= 10 && rawChunk <= 3600 ? rawChunk : CLOUD_DEFAULTS.chunkSeconds

  const terms = parseTerms(overrides.terms ?? source.get(ENV.terms), { logger })

  return ok({
    config: {
      apiKey,
      model: overrides.model ?? source.get(ENV.model) ?? CLOUD_DEFAULTS.model,
      endpoint: overrides.endpoint ?? source.get(ENV.endpoint) ?? CLOUD_DEFAULTS.endpoint,
      requestTimeoutMs: CLOUD_DEFAULTS.requestTimeoutMs,
      chunkSeconds,
      sampleRate: CLOUD_DEFAULTS.sampleRate,
      terms: terms.terms,
      diarization: ['1', 'true', 'yes'].includes(String(overrides.diarization ?? source.get(ENV.diarization) ?? '').toLowerCase()),
      termsTruncated: terms.truncated,
      sourceName: source.name ?? 'custom',
    },
  })
}
