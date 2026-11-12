/**
 * 交接消息构造（R-03 / R-06）。
 *
 * 新形态：产物已经写进会话工作区的单文件里，交接消息**只给路径和指令**，
 * 不再把整段转写塞进对话——47 分钟会议正文一万五千字，塞进去既费 token 也没人看。
 *
 * 兼容：没有产物路径时（旧调用方 / 极端回落），退化为内联全文，行为与改造前一致。
 *
 * @module dsh-note-taker/client/handoff
 */

export const MAX_INLINE_CHARS = 8000
export const MAX_MESSAGE_CHARS = 800

const INSTRUCTION_FILE = (path) => [
  `产物文件：\`${path}\``,
  '该文件包含元信息、`## 转写` 与 `## 纪要` 两节。',
  '请读取它，生成会议纪要并写入同一文件的 `## 纪要` 一节；结构要求：',
  '标题 / 「> 日期: YYYY-MM-DD | 时长: N 分钟」/ 一句话摘要 / 议题 / 决议 / 行动项（负责人 + 事项 + 截止时间）。',
  '信息不足处标注「待确认」，不要编造。',
].join('\n')

const INSTRUCTION_INLINE = '请据此生成会议纪要：按「背景 / 讨论要点 / 决议 / 行动项（负责人 + 截止时间）」组织，'
  + '结论要具体，行动项必须能落到人和日期；信息不足的地方标注「待确认」，不要编造。'

function fmtDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const pad = (value) => String(value).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

/**
 * 构造交接消息。
 * @param {object} input
 * @param {string} input.meetingId
 * @param {string} [input.label]
 * @param {number} [input.durationSec]
 * @param {string} [input.outputPath] 产物路径（相对工作区或绝对）
 * @param {'workspace'|'fallback'} [input.outputMode]
 * @param {string} [input.workspaceRoot] 工作区根（workspace 模式下用于说明）
 * @param {string} [input.transcript] 仅在无产物路径时用于内联退化
 * @param {number} [input.maxChars]
 */
export function buildHandoffMessage({
  meetingId,
  label,
  durationSec,
  outputPath,
  outputMode = 'workspace',
  workspaceRoot,
  transcript,
  maxChars = MAX_INLINE_CHARS,
} = {}) {
  if (typeof meetingId !== 'string' || meetingId.trim() === '') {
    return { ok: false, reason: '缺少会议 id，无法让会话定位这场会议' }
  }

  const name = (typeof label === 'string' && label.trim() !== '') ? label.trim() : '未命名'
  const header = `【会记】会议 ${meetingId}（${name}，${fmtDuration(durationSec)}）`
  const hasPath = typeof outputPath === 'string' && outputPath.trim() !== ''

  if (hasPath) {
    const root = outputMode === 'workspace' && typeof workspaceRoot === 'string' && workspaceRoot.trim() !== ''
      ? `工作区根：\`${workspaceRoot.trim()}\`\n`
      : ''
    const text = `${header}\n${root}${INSTRUCTION_FILE(outputPath.trim())}\n`
    return { ok: true, mode: 'file', text, chars: text.length }
  }

  const body = typeof transcript === 'string' ? transcript.trim() : ''
  if (body === '') return { ok: false, reason: '既没有产物路径，也没有转写内容' }

  if (body.length <= maxChars) {
    return { ok: true, mode: 'inline', chars: body.length, text: `${header}\n${INSTRUCTION_INLINE}\n\n${body}\n` }
  }

  const head = body.slice(0, 800).replace(/\s+$/, '')
  const lines = body.split('\n').length
  return {
    ok: true,
    mode: 'summary',
    chars: body.length,
    text: `${header}\n${INSTRUCTION_INLINE}\n\n`
      + `转写共 ${body.length} 字 / ${lines} 行，超过单次消息上限（${maxChars} 字），这里只放开头摘要。\n\n${head}…\n`,
  }
}
