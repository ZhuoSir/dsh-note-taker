/**
 * 结构化日志：plan「关键日志点清单」的落地载体。
 *
 * 格式（对齐 standards/logging.md §2.1 的文本 pattern）：
 *   2026-11-10 11:55:15.915 INFO  [runId] note-taker - 插件启动, name=dsh-note-taker, tools=6
 *
 * 纪律（plan 敏感纪律，红线级）：
 *   - 转写正文、纪要正文、模型提示词与返回原文一律不进日志，只记字符数
 *   - 路径中的用户目录替换为 <home>，避免把用户名写进日志（L-06）
 *   - 长值截断，避免把大对象整体打出来
 *
 * @module dsh-note-taker/logger
 */

import { homedir } from 'node:os'

const LEVEL_TEXT = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' }
const MAX_VALUE_LENGTH = 200

function pad(value, width) {
  return String(value).padStart(width, '0')
}

/** 本地时间 yyyy-MM-dd HH:mm:ss.SSS（与 logging 规范 pattern 一致） */
export function formatTime(date = new Date()) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}` +
    ` ${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`
  )
}

/** 把用户主目录换成 <home>：日志里不该出现用户名 */
export function maskPath(text) {
  const home = homedir()
  if (!home) return String(text)
  return String(text).split(home).join('<home>')
}

function formatValue(value) {
  const text = maskPath(typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value))
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text
}

/**
 * @param {object} options
 * @param {string} options.module 模块名，落在日志的 logger 槽位
 * @param {string} [options.runId] 一次任务/一次模型的串联 id
 * @param {(line: string) => void} [options.sink] 输出目标，默认 stdout（测试可注入）
 */
export function createLogger({ module, runId = '-', sink } = {}) {
  if (!module) throw new Error('createLogger 需要 module')
  const write = sink ?? ((line) => process.stdout.write(`${line}\n`))

  const emit = (level, message, fields = {}) => {
    if (message.includes('{}')) {
      throw new Error(`日志消息含未替换的占位符: ${message}`)
    }
    const kv = Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${formatValue(value)}`)
      .join(', ')
    write(`${formatTime()} ${LEVEL_TEXT[level]} [${runId}] ${module} - ${message}${kv ? `, ${kv}` : ''}`)
  }

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  }
}
