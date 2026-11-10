/**
 * 云端 ASR 的配置解析。
 *
 * 设计要点（plan 决策 3 与「接口可插拔」要求）：
 * - 配置来源抽象成 `source.get(name)`，当前实现读 process.env；
 *   以后页面要做可配时，只换 source，不动调用方。
 * - Key 缺失必须报 E_DEP，**不允许静默回退本地引擎**（否则用户以为走了云端）。
 * - 术语表转成即时热词 vocabulary，超过上限截断并告警。
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
  speed: 'NOTE_TAKER_ASR_SPEED',
})

export const CLOUD_DEFAULTS = Object.freeze({
  model: 'qwen-audio-3.0-asr-flash-streaming',
  // 旧域名（无需 Workspace ID）；官方推荐的新域名是 {WorkspaceId}.cn-beijing.maas.aliyuncs.com
  endpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
  speed: 1.0,
  idleTimeoutMs: 60_000,
  maxTerms: 200,
  termWeight: 3,
  sampleRate: 16_000,
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

/** 术语表：逗号分隔 → { 术语: 权重 }，超限截断 */
export function parseTerms(raw, { maxTerms = CLOUD_DEFAULTS.maxTerms, weight = CLOUD_DEFAULTS.termWeight, logger } = {}) {
  if (!raw) return { vocabulary: null, total: 0, kept: 0, truncated: false }
  const terms = raw
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)

  const unique = [...new Set(terms)]
  const kept = unique.slice(0, maxTerms)
  if (unique.length > kept.length) {
    logger?.warn('术语超限截断', { total: unique.length, kept: kept.length })
  }
  const vocabulary = {}
  for (const term of kept) vocabulary[term] = weight
  return { vocabulary, total: unique.length, kept: kept.length, truncated: unique.length > kept.length }
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

  const speedRaw = Number(overrides.speed ?? source.get(ENV.speed) ?? CLOUD_DEFAULTS.speed)
  const speed = Number.isFinite(speedRaw) && speedRaw > 0 && speedRaw <= 20 ? speedRaw : CLOUD_DEFAULTS.speed

  const terms = parseTerms(overrides.terms ?? source.get(ENV.terms), { logger })

  return ok({
    config: {
      apiKey,
      model: overrides.model ?? source.get(ENV.model) ?? CLOUD_DEFAULTS.model,
      endpoint: overrides.endpoint ?? source.get(ENV.endpoint) ?? CLOUD_DEFAULTS.endpoint,
      speed,
      idleTimeoutMs: CLOUD_DEFAULTS.idleTimeoutMs,
      sampleRate: CLOUD_DEFAULTS.sampleRate,
      vocabulary: terms.vocabulary,
      termsTruncated: terms.truncated,
      sourceName: source.name ?? 'custom',
    },
  })
}
