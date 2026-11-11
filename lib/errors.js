/**
 * 错误码与统一信封。
 *
 * 错误码集合由 requirements R-07 封闭规定，新增码属于需求变更（走 CR），不允许在这里随手加。
 * 信封：成功 { ok:true, ...结果 }；失败 { ok:false, code, message, detail }。
 *
 * message 是给人看的（可进 UI）；堆栈、stderr 原文、绝对路径只进日志，不进 detail。
 *
 * @module dsh-note-taker/errors
 */

export const CODES = Object.freeze({
  E_DEP: 'E_DEP', // 依赖缺失（如采集库、转写模型）
  E_DEVICE: 'E_DEVICE', // 无可用录音设备 / 设备被占用
  E_MODEL: 'E_MODEL', // 转写模型缺失或不可用
  E_AUDIO: 'E_AUDIO', // 音频不可读 / 文件不存在 / 解码失败
  E_STATE: 'E_STATE', // 状态不允许（未录音、未转写、并发、参数非法）
  E_LLM: 'E_LLM', // 模型调用失败
})

export function ok(data = {}) {
  return { ok: true, ...data }
}

/**
 * @param {keyof CODES} code
 * @param {string} message 人类可读、不含内部细节
 * @param {Record<string, unknown>} [detail] 排查所需的最小字段
 */
export function err(code, message, detail = {}) {
  if (!CODES[code]) throw new Error(`未知错误码: ${code}`)
  if (typeof message !== 'string' || message.length === 0) throw new Error('错误消息不能为空')
  return { ok: false, code, message, detail: sanitizeDetail(detail) }
}

/** detail 里不放堆栈、不放 Error 实例、不放超长文本 */
function sanitizeDetail(detail) {
  const out = {}
  for (const [key, value] of Object.entries(detail ?? {})) {
    if (key === 'stack') continue
    if (value instanceof Error) continue
    out[key] = value
  }
  return out
}

/** 判定一个返回值是不是错误信封 */
export function isErr(result) {
  return Boolean(result) && result.ok === false
}
