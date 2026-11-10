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

export const CLOUD_DEFAULTS = Object.freeze({
  model: 'qwen-audio-3.0-asr-flash',
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
