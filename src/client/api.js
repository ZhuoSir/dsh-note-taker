/**
 * 会记页面的接口封装（浏览器侧）。
 *
 * 职责：
 * - 统一拼路径与查询串、统一超时、统一把「非 200 / 非 JSON / 网络错误」收敛成信封
 * - 云端动作前强制二次确认（R-07）：确认逻辑由页面传入，本模块只负责「没确认就绝不发请求」
 *
 * 不依赖 React / DOM，可在 node 下用假 fetch 单测（R-09）。
 *
 * @module dsh-note-taker/client/api
 */

import { CLOUD_CONSENT_TEXT, needsCloudConsent } from './logic.js'

export const DEFAULT_TIMEOUT_MS = 15_000
const BASE = '/note-taker'

function buildUrl(path, query) {
  const pairs = []
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  }
  return pairs.length > 0 ? `${path}?${pairs.join('&')}` : path
}

function toErrorEnvelope(code, message, detail = {}) {
  return { ok: false, code, message, detail }
}

/**
 * @param {object} options
 * @param {Function} [options.fetchImpl] 测试注入
 * @param {number} [options.timeoutMs]
 * @param {Function} [options.confirmCloud] 返回 Promise<boolean>；缺省视为「不确认」
 */
export function createApi({ baseUrl = '', fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, confirmCloud } = {}) {
  const inflight = new Set()

  async function request(path, { method = 'GET', query, body } = {}) {
    if (typeof fetchImpl !== 'function') return toErrorEnvelope('E_DEP', '当前环境没有 fetch')

    const controller = new AbortController()
    inflight.add(controller)
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetchImpl(`${baseUrl}${buildUrl(`${BASE}${path}`, query)}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      const text = await response.text().catch(() => '')
      let parsed = null
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        parsed = null
      }

      if (!response.ok) {
        const code = parsed?.code ?? (response.status === 401 || response.status === 403 ? 'E_DEP' : 'E_LLM')
        return toErrorEnvelope(code, parsed?.message ?? `接口返回 HTTP ${response.status}`,
          { ...(parsed?.detail ?? {}), httpStatus: response.status, endpoint: path })
      }
      if (parsed === null) return toErrorEnvelope('E_LLM', '接口返回的不是 JSON', { endpoint: path })
      return parsed
    } catch (error) {
      const aborted = error?.name === 'AbortError'
      return toErrorEnvelope('E_LLM', aborted ? `请求超时（${timeoutMs}ms）` : `网络请求失败：${error?.message ?? error}`)
    } finally {
      clearTimeout(timer)
      inflight.delete(controller)
    }
  }

  async function longAction(path, body, { engine } = {}) {
    if (engine && needsCloudConsent(engine)) {
      let granted = false
      try {
        granted = confirmCloud ? await confirmCloud(CLOUD_CONSENT_TEXT) === true : false
      } catch {
        granted = false
      }
      if (!granted) return { ok: false, code: 'E_STATE', message: '已取消（未确认云端上传）', detail: { cancelled: true } }
    }
    return request(path, { method: 'POST', body })
  }

  return {
    list: ({ limit, sessionId } = {}) => request('/list', { query: { limit, sessionId } }),
    detail: ({ id, sessionId } = {}) => request('/detail', { query: { id, sessionId } }),
    health: () => request('/health'),
    getConfig: () => request('/config'),
    saveConfig: (patch) => request('/config', { method: 'POST', body: patch }),
    transcribe: ({ id, engine, sessionId } = {}) => longAction('/transcribe', { id, engine, sessionId }, { engine }),
    minutes: ({ id, force, sessionId } = {}) => request('/minutes', { method: 'POST', body: { id, force, sessionId } }),
    record: ({ action, label, stream, sessionId } = {}) => request('/record', { method: 'POST', body: { action, label, stream, sessionId } }),
    // 全局录音状态：不带 sessionId —— 录音属于宿主，不属于某个会话（CR-02 / R-11）
    recordState: () => request('/record'),
    live: ({ id } = {}) => request('/live', { query: { id } }),
    rename: ({ id, label } = {}) => request('/label', { method: 'POST', body: { id, label } }),
    importAudio: ({ path, label } = {}) => request('/import', { method: 'POST', body: { path, label } }),
    cancelAll() {
      for (const controller of inflight) controller.abort()
      inflight.clear()
    },
  }
}
