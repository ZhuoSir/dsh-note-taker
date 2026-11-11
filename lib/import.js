/**
 * 导入规则（R-01 / R-02 / R-05）。
 *
 * 纯函数，不碰文件系统——真正的 stat/copy/解码在 service 里做。
 * 放在这里是为了能被单测覆盖：命名、扩展名后备、大小判定都是容易出错的细节。
 *
 * @module dsh-note-taker/import
 */

import { basename, extname } from 'node:path'

/** 单文件上限：500 MB（超出直接拒，不截断） */
export const MAX_IMPORT_BYTES = 500 * 1024 * 1024

/** 无扩展名时的后备后缀：解码器靠内容嗅探，不依赖后缀 */
export const FALLBACK_EXTENSION = '.bin'

/**
 * 推导会议标签：文件名去掉后缀；不可用时用时间。
 * @param {{path?:string, startedAt?:string}} input
 */
export function deriveLabel({ path, startedAt } = {}) {
  const name = typeof path === 'string' ? basename(path.trim()) : ''
  const withoutExt = name.replace(/\.[^.]+$/, '').trim()

  if (withoutExt !== '') return withoutExt.slice(0, 60)

  const date = new Date(startedAt)
  if (!Number.isNaN(date.getTime())) {
    const pad = (value) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  return '导入的音频'
}

/**
 * 落盘用哪个后缀：有就用它（统一小写），没有就用 .bin。
 * @param {string} path
 */
export function pickExtension(path) {
  const ext = typeof path === 'string' ? extname(path) : ''
  return ext ? ext.toLowerCase() : FALLBACK_EXTENSION
}

/**
 * 大小判定。
 * @param {number} bytes
 * @param {{maxBytes?:number}} [options]
 * @returns {{ok:true, bytes:number} | {ok:false, reason:string, bytes:number, limit:number}}
 */
export function checkSize(bytes, { maxBytes = MAX_IMPORT_BYTES } = {}) {
  const size = Number(bytes) || 0
  if (size <= 0) {
    return { ok: false, reason: '文件是空的（0 字节）', bytes: size, limit: maxBytes }
  }
  if (size > maxBytes) {
    const mb = (size / 1024 / 1024).toFixed(1)
    const limitMb = (maxBytes / 1024 / 1024).toFixed(0)
    return { ok: false, reason: `文件过大：${mb} MB，上限 ${limitMb} MB`, bytes: size, limit: maxBytes }
  }
  return { ok: true, bytes: size }
}

/** 给用户的提示：路径不存在时区分「像 id」和「像路径」两种情况 */
export function missingPathHint(path) {
  const text = typeof path === 'string' ? path.trim() : ''
  if (text === '') return '缺少参数 path'
  // 宿主附件 id 是长十六进制串，看起来不像路径
  if (/^[0-9a-f]{32,}$/i.test(text)) {
    return `找不到文件：${text.slice(0, 12)}… 看起来是附件 id 而不是文件路径，请换成附件的本地路径`
  }
  return `文件不存在：${text}`
}
