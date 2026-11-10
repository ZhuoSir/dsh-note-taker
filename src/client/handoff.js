/**
 * 交接消息构造（R-06 / R-10）。
 *
 * 「交给会话」本质是把一段结构化文本作为用户消息发进当前会话，让 agent 据此生成纪要。
 * 这里做成纯函数，可单测；发送动作在组件里完成（走 host.js 拿到的 conversation 服务）。
 *
 * 为什么超长要降级：47 分钟会议的转写约 1.5 万字，整段塞进消息既浪费 token 也容易截断。
 * 超过阈值时改为「摘要 + 指向 transcripts 文件」，让 agent 自己按需读取。
 *
 * @module dsh-note-taker/client/handoff
 */

export const MAX_INLINE_CHARS = 8000

const INSTRUCTION = '请据此生成会议纪要：按「背景 / 讨论要点 / 决议 / 行动项（负责人 + 截止时间）」组织，'
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
 * @param {string} input.meetingId 会议 id（必填，agent 据此定位产物）
 * @param {string} [input.label] 会议标签
 * @param {number} [input.durationSec] 时长
 * @param {string} input.transcript 确认后的转写正文
 * @param {number} [input.maxChars] 内联上限，默认 8000
 * @returns {{ok:true, text:string, mode:'inline'|'summary', chars:number} | {ok:false, reason:string}}
 */
export function buildHandoffMessage({ meetingId, label, durationSec, transcript, maxChars = MAX_INLINE_CHARS } = {}) {
  if (typeof meetingId !== 'string' || meetingId.trim() === '') {
    return { ok: false, reason: '缺少会议 id，无法让会话定位这场会议' }
  }

  const body = typeof transcript === 'string' ? transcript.trim() : ''
  if (body === '') {
    return { ok: false, reason: '转写内容为空，没什么可交给会话' }
  }

  const name = (typeof label === 'string' && label.trim() !== '') ? label.trim() : '(未命名)'
  const duration = fmtDuration(durationSec)
  const header = `【会记】会议 ${meetingId}（${name}，${duration}）`
  const pointer = `转写全文：transcripts/${meetingId}.md`

  if (body.length <= maxChars) {
    return {
      ok: true,
      mode: 'inline',
      chars: body.length,
      text: `${header}\n${INSTRUCTION}\n\n${body}\n`,
    }
  }

  // 超长：只给摘要（前 800 字）+ 指针，避免把整篇转写塞进一次消息
  const head = body.slice(0, 800).replace(/\s+$/, '')
  const lines = body.split('\n').length
  return {
    ok: true,
    mode: 'summary',
    chars: body.length,
    text: `${header}\n${INSTRUCTION}\n\n`
      + `转写共 ${body.length} 字 / ${lines} 行，超过单次消息上限（${maxChars} 字），这里只放开头摘要，`
      + `完整内容请读取 ${pointer}（会议 id ${meetingId}）。\n\n`
      + `${head}…\n`,
  }
}
