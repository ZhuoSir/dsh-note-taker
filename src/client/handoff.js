/**
 * 交接消息构造（R-03 / R-06；BUG-05 修复）。
 *
 * 产物已经写进会话工作区的单文件里，交接消息**给路径和指令**，不再把整段转写塞进对话。
 *
 * BUG-05 修的三件事：
 * 1. 路径必须**绝对**——原来只给 `meetings/<id>.md`，会话工作区不是那个仓库根时读不到，
 *    等于什么都没交付；现在绝对路径打头，相对路径与字节数作补充信息。
 * 2. **不再截断**：转写超过内联上限时改走文件路径，绝不再发「开头 800 字摘要」；
 *    真的连文件都没有时明确报错，不假装交付。
 * 3. 载体**自证**：产物没有就退到旧转写文件（legacy），两者都没有才报无内容可交付。
 *
 * @module dsh-note-taker/client/handoff
 */

export const MAX_INLINE_CHARS = 8000
/** 单次消息体量上限（只用于判断，不再用于截断正文） */
export const MAX_MESSAGE_CHARS = 800

const STRUCTURE = [
  '标题 / 「> 日期: YYYY-MM-DD | 时长: N 分钟」/ 一句话摘要 / 议题 / 决议 / 行动项（负责人 + 事项 + 截止时间）。',
  '信息不足处标注「待确认」，不要编造。',
].join('\n')

const INSTRUCTION_INLINE = '请据此生成会议纪要：按「背景 / 讨论要点 / 决议 / 行动项（负责人 + 截止时间）」组织，'
  + '结论要具体，行动项必须能落到人和日期；信息不足的地方标注「待确认」，不要编造。'

const INSTRUCTION_FILE = [
  '请直接读取上面的绝对路径，生成会议纪要并写入同一文件的 `## 纪要` 一节；结构要求：',
  STRUCTURE,
].join('\n')

const INSTRUCTION_LEGACY = [
  '该文件只有转写、没有 `## 纪要` 节。请直接读取上面的绝对路径，据此生成会议纪要并**在对话里给出**',
  '（这场会议没有产物文件可写回）；结构要求：',
  STRUCTURE,
].join('\n')

function fmtDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const pad = (value) => String(value).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const positive = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0)

/**
 * 构造交接消息。
 * @param {object} input
 * @param {string} input.meetingId
 * @param {string} [input.label]
 * @param {number} [input.durationSec]
 * @param {string} [input.outputAbs] 产物文件绝对路径（优先，读到就用它）
 * @param {string} [input.outputRelative] 产物相对工作区路径（补充信息）
 * @param {number} [input.outputBytes] 产物文件字节数
 * @param {string} [input.outputPath] 旧入参：相对路径；无 `outputAbs` 时退化使用
 * @param {'workspace'|'fallback'} [input.outputMode]
 * @param {string} [input.workspaceRoot]
 * @param {string} [input.transcriptAbs] 旧转写文件绝对路径（无产物时的退路）
 * @param {number} [input.transcriptChars] 转写字数（给会话一个体量预期）
 * @param {string} [input.transcript] 仅在前两者都没有时用于内联
 * @param {number} [input.maxChars]
 * @returns {{ok:true, mode:'file'|'legacy'|'inline', text:string, chars:number}|{ok:false, reason:string}}
 */
export function buildHandoffMessage({
  meetingId,
  label,
  durationSec,
  outputAbs,
  outputRelative,
  outputBytes,
  outputPath,
  outputMode = 'workspace',
  workspaceRoot,
  transcriptAbs,
  transcriptChars,
  transcript,
  maxChars = MAX_INLINE_CHARS,
} = {}) {
  if (typeof meetingId !== 'string' || meetingId.trim() === '') {
    return { ok: false, reason: '缺少会议 id，无法让会话定位这场会议' }
  }

  const name = (typeof label === 'string' && label.trim() !== '') ? label.trim() : '未命名'
  const header = `【会记】会议 ${meetingId}（${name}，${fmtDuration(durationSec)}）`
  const chars = positive(transcriptChars) || text(transcript).length
  const abs = text(outputAbs)
  const rel = text(outputRelative)
  const root = text(workspaceRoot)

  // ① 有产物：绝对路径打头，相对路径与体量作补充
  if (abs !== '') {
    const lines = [header, `产物文件（绝对路径）：\`${abs}\``]
    if (rel !== '') lines.push(`相对路径：\`${rel}\``)
    const bytes = positive(outputBytes)
    lines.push(`该文件${bytes > 0 ? ` ${bytes} 字节` : ''}，含 \`## 转写\`${chars > 0 ? `（${chars} 字）` : ''}与 \`## 纪要\` 两节。`)
    lines.push(INSTRUCTION_FILE)
    const built = lines.join('\n') + '\n'
    return { ok: true, mode: 'file', text: built, chars: built.length }
  }

  // ② 无产物但有旧转写文件：给它的绝对路径，别退化成内联
  const legacyAbs = text(transcriptAbs)
  if (legacyAbs !== '') {
    const built = [
      header,
      `转写文件（绝对路径）：\`${legacyAbs}\``,
      `该文件${chars > 0 ? `共 ${chars} 字。` : ''}`,
      INSTRUCTION_LEGACY,
    ].join('\n') + '\n'
    return { ok: true, mode: 'legacy', text: built, chars: built.length }
  }

  // ③ 旧调用方只给了 outputPath：是绝对路径就直说绝对，是相对的才提工作区根
  const relOnly = text(outputPath)
  if (relOnly !== '') {
    const absolute = /^[A-Za-z]:[\\/]/.test(relOnly) || relOnly.startsWith('/')
    const built = [
      header,
      !absolute && root !== '' ? `工作区根：\`${root}\`` : '',
      `产物文件（${absolute ? '绝对路径' : '相对路径'}）：\`${relOnly}\``,
      absolute
        ? '请直接读取上面的绝对路径，生成会议纪要并写入该文件的 `## 纪要` 一节；结构要求：'
        : '请在工作区根下拼接上面路径后读取，生成会议纪要并写入该文件的 `## 纪要` 一节；结构要求：',
      STRUCTURE,
    ].filter(Boolean).join('\n') + '\n'
    return { ok: true, mode: 'file', text: built, chars: built.length }
  }

  // ④ 只剩内联：能装下才内联，装不下就如实报错（绝不截断充数）
  const body = text(transcript)
  if (body === '') return { ok: false, reason: '这场会议既没有产物文件，也没有转写内容' }
  if (body.length > maxChars) {
    return { ok: false, reason: `转写 ${body.length} 字，超过单次消息上限（${maxChars} 字），且这场会议没有可交付的文件路径` }
  }
  const built = `${header}\n${INSTRUCTION_INLINE}\n\n${body}\n`
  return { ok: true, mode: 'inline', text: built, chars: body.length }
}

/** 交付方式的中文口径（回执里必须与实际一致，BUG-05 R-04） */
export function modeLabel(mode) {
  if (mode === 'file') return '文件路径'
  if (mode === 'legacy') return '文件路径（旧转写）'
  return '全文'
}