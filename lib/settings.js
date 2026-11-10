/**
 * 配置读写与优先级（R-01 / R-02 / R-08）。
 *
 * 存储：<数据目录>/config.json
 * 优先级：页面保存的 config.json  > 环境变量  > 内置默认
 *
 * 两个刻意的设计：
 * 1. **数据目录本身只由环境变量/默认决定**——读 config.json 需要先知道目录，
 *    所以文件里的 dataRoot 只影响下次启动，页面要明确标注「需重启」。
 * 2. **Key 永远只回掩码**——接口与日志都不出现明文；写入时若收到的是掩码回显，视为「未修改」。
 *
 * 本模块是纯函数 + 文件 IO，不依赖 service，可独立单测。
 *
 * @module dsh-note-taker/settings
 */

import { access, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const SETTINGS_FILE = 'config.json'
export const SETTINGS_VERSION = 1

export const DEFAULT_CLOUD_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'

export const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  asr: { engine: 'local', localModel: 'small', chunkSeconds: 300 },
  cloud: { apiKey: null, endpoint: DEFAULT_CLOUD_ENDPOINT, model: 'qwen-audio-3.1-asr-flash' },
  dataRoot: null,
})

/** 设置字段 → 对应的环境变量（用于「页面配置 > 环境变量」的合并） */
export const ENV_KEYS = Object.freeze({
  engine: 'NOTE_TAKER_ASR_ENGINE',
  localModel: 'NOTE_TAKER_MODEL',
  chunkSeconds: 'NOTE_TAKER_ASR_CHUNK_SECONDS',
  apiKey: 'DASHSCOPE_API_KEY',
  endpoint: 'NOTE_TAKER_CLOUD_ASR_URL',
  cloudModel: 'NOTE_TAKER_CLOUD_ASR_MODEL',
  dataRoot: 'NOTE_TAKER_DATA',
})

const ALLOWED_ENGINES = new Set(['local', 'cloud'])
const ALLOWED_MODELS = new Set(['tiny', 'base', 'small', 'medium'])
const MASK_CHAR = '…'
const CHUNK_MIN = 10
const CHUNK_MAX = 3600

export function settingsPath(root) {
  return join(root, SETTINGS_FILE)
}

/** `sk-1234567890abcdef` → `sk-…cdef`；太短就全遮 */
export function maskKey(key) {
  if (typeof key !== 'string' || key === '') return ''
  if (key.length < 8) return '•'.repeat(Math.max(4, key.length))
  const head = key.slice(0, 3)
  const tail = key.slice(-4)
  return `${head}${MASK_CHAR}${tail}`
}

/** 判据：看起来像掩码（含省略号或全遮点）就认为「用户没改」 */
export function isMasked(key) {
  return typeof key === 'string' && (key.includes(MASK_CHAR) || /^•+$/.test(key))
}

export function maskSettings(settings) {
  return {
    ...settings,
    cloud: { ...settings.cloud, apiKey: maskKey(settings.cloud?.apiKey ?? '') },
  }
}

/** 合并一份完整配置：文件 > 环境变量 > 默认 */
export function mergeSettings({ file = {}, env = {} } = {}) {
  const asr = { ...DEFAULT_SETTINGS.asr, ...(file.asr ?? {}) }
  const cloud = { ...DEFAULT_SETTINGS.cloud, ...(file.cloud ?? {}) }

  const sources = { engine: 'default', localModel: 'default', chunkSeconds: 'default', apiKey: 'default', endpoint: 'default', cloudModel: 'default', dataRoot: 'default' }

  if (file.asr?.engine) sources.engine = 'file'
  else if (env[ENV_KEYS.engine]) sources.engine = 'env'
  if (file.asr?.localModel) sources.localModel = 'file'
  else if (env[ENV_KEYS.localModel]) sources.localModel = 'env'
  if (file.asr?.chunkSeconds) sources.chunkSeconds = 'file'
  else if (env[ENV_KEYS.chunkSeconds]) sources.chunkSeconds = 'env'
  if (file.cloud?.apiKey) sources.apiKey = 'file'
  else if (env[ENV_KEYS.apiKey]) sources.apiKey = 'env'
  if (file.cloud?.endpoint) sources.endpoint = 'file'
  else if (env[ENV_KEYS.endpoint]) sources.endpoint = 'env'
  if (file.cloud?.model) sources.cloudModel = 'file'
  else if (env[ENV_KEYS.cloudModel]) sources.cloudModel = 'env'
  if (file.dataRoot) sources.dataRoot = 'file'
  else if (env[ENV_KEYS.dataRoot]) sources.dataRoot = 'env'

  // 环境变量补齐文件里没有的
  if (sources.engine === 'env') asr.engine = String(env[ENV_KEYS.engine]).toLowerCase()
  if (sources.localModel === 'env') asr.localModel = env[ENV_KEYS.localModel]
  if (sources.chunkSeconds === 'env') asr.chunkSeconds = Number(env[ENV_KEYS.chunkSeconds])
  const dataRoot = sources.dataRoot === 'file' ? file.dataRoot : (sources.dataRoot === 'env' ? env[ENV_KEYS.dataRoot] : null)

  const merged = {
    version: file.version ?? SETTINGS_VERSION,
    asr: {
      engine: asr.engine,
      localModel: asr.localModel,
      chunkSeconds: Number.isFinite(asr.chunkSeconds) ? asr.chunkSeconds : DEFAULT_SETTINGS.asr.chunkSeconds,
    },
    cloud: {
      apiKey: sources.apiKey === 'file' ? cloud.apiKey : (sources.apiKey === 'env' ? env[ENV_KEYS.apiKey] : null),
      endpoint: sources.endpoint === 'env' ? env[ENV_KEYS.endpoint] : cloud.endpoint,
      model: sources.cloudModel === 'env' ? env[ENV_KEYS.cloudModel] : cloud.model,
    },
    dataRoot,
  }

  return { settings: merged, sources }
}

/** 读文件；不存在或损坏都回空对象（不抛错，避免插件起不来） */
export async function readSettingsFile(root) {
  try {
    const text = await readFile(settingsPath(root), 'utf8')
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return { file: {}, warning: '配置文件不是对象，已忽略' }
    return { file: parsed, warning: null }
  } catch (error) {
    if (error?.code === 'ENOENT') return { file: {}, warning: null }
    return { file: {}, warning: `配置文件读取失败：${String(error?.message ?? error).slice(0, 80)}` }
  }
}

/** 校验一个 patch；返回规范化后的 patch、逐字段错误、被忽略的键 */
export function validatePatch(patch = {}) {
  const errors = []
  const normalized = {}
  const ignored = []

  const allowedTop = new Set(['asr', 'cloud', 'dataRoot'])
  for (const key of Object.keys(patch)) {
    if (!allowedTop.has(key)) ignored.push(key)
  }

  const asr = patch.asr ?? {}
  const cloud = patch.cloud ?? {}

  if (asr.engine !== undefined) {
    const value = String(asr.engine).toLowerCase()
    if (!ALLOWED_ENGINES.has(value)) errors.push({ field: 'asr.engine', message: '引擎只能是 local 或 cloud' })
    else normalized.asr = { ...(normalized.asr ?? {}), engine: value }
  }

  if (asr.localModel !== undefined) {
    const value = String(asr.localModel)
    if (!ALLOWED_MODELS.has(value)) errors.push({ field: 'asr.localModel', message: '本地模型档位只能是 tiny/base/small/medium' })
    else normalized.asr = { ...(normalized.asr ?? {}), localModel: value }
  }

  if (asr.chunkSeconds !== undefined) {
    const value = Number(asr.chunkSeconds)
    if (!Number.isInteger(value) || value < CHUNK_MIN || value > CHUNK_MAX) {
      errors.push({ field: 'asr.chunkSeconds', message: `分片秒数必须是 ${CHUNK_MIN}–${CHUNK_MAX} 的整数` })
    } else {
      normalized.asr = { ...(normalized.asr ?? {}), chunkSeconds: value }
    }
  }

  if (cloud.apiKey !== undefined) {
    if (cloud.apiKey !== null && typeof cloud.apiKey !== 'string') {
      errors.push({ field: 'cloud.apiKey', message: 'Key 必须是字符串' })
    } else if (typeof cloud.apiKey === 'string' && cloud.apiKey.trim() === '') {
      errors.push({ field: 'cloud.apiKey', message: 'Key 不能是空字符串（要清空请传 null）' })
    } else if (isMasked(cloud.apiKey)) {
      // 页面回显的掩码：视为未修改
    } else {
      normalized.cloud = { ...(normalized.cloud ?? {}), apiKey: cloud.apiKey }
    }
  }

  if (cloud.endpoint !== undefined) {
    let okUrl = false
    try {
      const url = new URL(String(cloud.endpoint))
      okUrl = url.protocol === 'http:' || url.protocol === 'https:'
    } catch { okUrl = false }
    if (!okUrl) errors.push({ field: 'cloud.endpoint', message: '接口地址必须是 http(s) URL' })
    else normalized.cloud = { ...(normalized.cloud ?? {}), endpoint: String(cloud.endpoint) }
  }

  if (cloud.model !== undefined) {
    const value = String(cloud.model).trim()
    if (value === '') errors.push({ field: 'cloud.model', message: '模型名不能为空' })
    else normalized.cloud = { ...(normalized.cloud ?? {}), model: value }
  }

  if (patch.dataRoot !== undefined) {
    if (patch.dataRoot !== null && (typeof patch.dataRoot !== 'string' || patch.dataRoot.trim() === '')) {
      errors.push({ field: 'dataRoot', message: '数据目录必须是非空路径字符串' })
    } else {
      normalized.dataRoot = patch.dataRoot
    }
  }

  return { ok: errors.length === 0, patch: normalized, errors, ignored }
}

/** 目录可写校验（保存前做，避免存进去一个不可用目录） */
export async function assertWritableDir(path) {
  try {
    await access(path)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: `目录不可访问：${String(error?.message ?? error).slice(0, 80)}` }
  }
}

/** 原子写：先写临时文件再 rename */
export async function writeSettingsFile(root, settings) {
  const target = settingsPath(root)
  const temp = `${target}.${process.pid}.tmp`
  const payload = { ...settings, version: SETTINGS_VERSION }
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, target)
  return target
}

/**
 * 保存一个 patch：读 → 合并 → 校验 → 写。
 * @returns {{ok:boolean, saved?:string[], ignored?:string[], restartRequired?:string[], errors?:Array, message?:string}}
 */
export async function saveSettings({ root, patch, env = {} }) {
  const { file } = await readSettingsFile(root)

  const result = validatePatch(patch)
  if (!result.ok) return { ok: false, errors: result.errors, message: result.errors[0]?.message ?? '配置不合法' }

  // 关键：只写用户显式改过的字段（稀疏存储）。
  // 若把「合并后的完整配置」写进文件，内置默认值会被当成用户配置，
  // 之后环境变量就再也覆盖不了它——这正是本函数第一版踩的坑。
  const next = {
    version: SETTINGS_VERSION,
    asr: { ...(file.asr ?? {}), ...(result.patch.asr ?? {}) },
    cloud: { ...(file.cloud ?? {}), ...(result.patch.cloud ?? {}) },
  }
  if (file.dataRoot !== undefined || result.patch.dataRoot !== undefined) {
    next.dataRoot = result.patch.dataRoot !== undefined ? result.patch.dataRoot : file.dataRoot
  }
  if (Object.keys(next.asr).length === 0) delete next.asr
  if (Object.keys(next.cloud).length === 0) delete next.cloud

  if (next.cloud && typeof next.cloud.apiKey === 'string' && next.cloud.apiKey.trim() === '') next.cloud.apiKey = null

  if (result.patch.dataRoot !== undefined && result.patch.dataRoot !== null) {
    const writable = await assertWritableDir(result.patch.dataRoot)
    if (!writable.ok) return { ok: false, errors: [{ field: 'dataRoot', message: writable.message }], message: writable.message }
  }

  const saved = []
  if (result.patch.asr?.engine !== undefined) saved.push('asr.engine')
  if (result.patch.asr?.localModel !== undefined) saved.push('asr.localModel')
  if (result.patch.asr?.chunkSeconds !== undefined) saved.push('asr.chunkSeconds')
  if (result.patch.cloud?.apiKey !== undefined) saved.push('cloud.apiKey')
  if (result.patch.cloud?.endpoint !== undefined) saved.push('cloud.endpoint')
  if (result.patch.cloud?.model !== undefined) saved.push('cloud.model')
  if (result.patch.dataRoot !== undefined) saved.push('dataRoot')

  try {
    await writeSettingsFile(root, next)
  } catch (error) {
    return { ok: false, errors: [{ field: '$file', message: String(error?.message ?? error).slice(0, 120) }], message: '配置文件写入失败' }
  }

  const restartRequired = result.patch.dataRoot !== undefined ? ['dataRoot'] : []
  return { ok: true, saved, ignored: result.ignored, restartRequired }
}

/**
 * 给 service / asr 用的配置来源：页面配置优先，其次环境变量。
 * 键名沿用环境变量名，这样既有的 resolveCloudAsrConfig 一行都不用改。
 */
export async function createSettingsSource({ root, env = process.env } = {}) {
  const { file, warning } = await readSettingsFile(root)
  const { settings } = mergeSettings({ file, env })

  const map = new Map([
    [ENV_KEYS.engine, settings.asr.engine],
    [ENV_KEYS.localModel, settings.asr.localModel],
    [ENV_KEYS.chunkSeconds, String(settings.asr.chunkSeconds)],
    [ENV_KEYS.apiKey, settings.cloud.apiKey],
    [ENV_KEYS.endpoint, settings.cloud.endpoint],
    [ENV_KEYS.cloudModel, settings.cloud.model],
    [ENV_KEYS.dataRoot, settings.dataRoot],
    ['NOTE_TAKER_ASR_TERMS', env.NOTE_TAKER_ASR_TERMS],
    ['NOTE_TAKER_ASR_DIARIZATION', env.NOTE_TAKER_ASR_DIARIZATION],
    ['NOTE_TAKER_MODEL_DIR', env.NOTE_TAKER_MODEL_DIR],
    ['NOTE_TAKER_HF_ENDPOINT', env.NOTE_TAKER_HF_ENDPOINT],
    ['NOTE_TAKER_LLM_PROVIDER', env.NOTE_TAKER_LLM_PROVIDER],
    ['NOTE_TAKER_LLM_MODEL', env.NOTE_TAKER_LLM_MODEL],
  ])

  return {
    name: 'settings',
    warning,
    settings,
    get(key) {
      const value = map.get(key)
      return value === undefined || value === null || value === '' ? null : value
    },
  }
}
