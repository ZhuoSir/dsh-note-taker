/**
 * 产物路径与单文件结构（R-01 / R-02 / R-05）。
 *
 * 一个会议一个 markdown 文件，包含「元信息 + 转写 + 纪要」三段：
 *
 *   # <id> · <标签>
 *   - 开始 / 时长 / 引擎 / 段数
 *   ## 转写
 *   [HH:MM:SS] 正文
 *   ## 纪要
 *   （会话生成后回写）
 *
 * 关键约束：写纪要只替换 `## 纪要` 之后的内容，**转写段落逐字不变**——这是最容易丢数据的地方。
 *
 * 本模块不碰文件系统（纯函数），IO 在 service 层。
 *
 * @module dsh-note-taker/output
 */

import { join } from 'node:path'

export const PRODUCT_DIR = 'meetings'
export const TRANSCRIPT_HEADING = '## 转写'
export const MINUTES_HEADING = '## 纪要'

/**
 * 解析产物落点。
 * @param {{dataRoot:string, workspaceDir?:string|null, meetingId:string}} input
 * @returns {{mode:'workspace'|'fallback', dir:string, file:string, relative:string|null, workspaceRoot:string|null}}
 */
export function resolveProductPaths({ dataRoot, workspaceDir = null, meetingId } = {}) {
  if (typeof meetingId !== 'string' || meetingId.trim() === '') {
    throw new Error('resolveProductPaths 需要 meetingId')
  }
  const id = meetingId.trim()

  if (typeof workspaceDir === 'string' && workspaceDir.trim() !== '') {
    const root = workspaceDir.trim()
    const dir = join(root, PRODUCT_DIR)
    return { mode: 'workspace', dir, file: join(dir, `${id}.md`), relative: `${PRODUCT_DIR}/${id}.md`, workspaceRoot: root }
  }

  const dir = join(dataRoot, PRODUCT_DIR)
  return { mode: 'fallback', dir, file: join(dir, `${id}.md`), relative: null, workspaceRoot: null }
}

function fmtDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const pad = (value) => String(value).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

function fmtDateTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fmtClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
}

/**
 * 渲染单文件正文（不含纪要内容，纪要留空段等会话回写）。
 * @param {{meetingId:string, label?:string, startedAt?:string, durationSec?:number, engine?:string, model?:string, segments?:Array}} input
 */
export function renderProduct({ meetingId, label, startedAt, durationSec, engine = 'local', model, segments = [] } = {}) {
  const name = (typeof label === 'string' && label.trim() !== '') ? label.trim() : fmtDateTime(startedAt)
  const chars = segments.reduce((sum, segment) => sum + String(segment?.text ?? '').length, 0)
  const engineText = model ? `${engine}（${model}）` : engine

  const lines = [
    `# ${meetingId} · ${name}`,
    '',
    `- 开始：${fmtDateTime(startedAt)}`,
    `- 时长：${fmtDuration(durationSec)}`,
    `- 引擎：${engineText}`,
    `- 段数 / 字数：${segments.length} / ${chars}`,
    '',
    TRANSCRIPT_HEADING,
    '',
  ]

  for (const segment of segments) {
    lines.push(`[${fmtClock(segment.start)}] ${String(segment.text ?? '').trim()}`)
  }

  lines.push('', MINUTES_HEADING, '', '')
  return lines.join('\n')
}

/**
 * 把纪要写进文件：只替换 `## 纪要` 之后的内容，其余逐字保留（R-02）。
 * @param {string} content 现有文件内容
 * @param {string} minutes 纪要正文（markdown）
 */
export function mergeMinutes(content, minutes) {
  const body = typeof minutes === 'string' ? minutes.trim() : ''
  const text = typeof content === 'string' ? content : ''

  const index = text.indexOf(MINUTES_HEADING)
  if (index < 0) {
    const head = text.replace(/\s+$/, '')
    return `${head}\n\n${MINUTES_HEADING}\n\n${body}\n`
  }

  const head = text.slice(0, index + MINUTES_HEADING.length).replace(/\s+$/, '')
  return `${head}\n\n${body}\n`
}

/** 从文件内容里取出纪要正文（供页面/接口读取） */
export function extractMinutes(content) {
  const text = typeof content === 'string' ? content : ''
  const index = text.indexOf(MINUTES_HEADING)
  if (index < 0) return ''
  return text.slice(index + MINUTES_HEADING.length).trim()
}
