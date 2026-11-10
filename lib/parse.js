/**
 * 转写文本解析与统计（requirements R-05）。
 *
 * 输入是 `py/transcribe.py` 产出的 md，也接受人工整理的同类文本：
 *   [00:03:12] 张三：这版方案下周先灰度。
 *   [00:03:20] 李四：灰度范围定多少，
 *   先按 5% 吧。
 *
 * 约定：
 * - 有 `[HH:MM:SS]` 的行开新段；同一条发言的续行并入上一段
 * - 没有时间戳但形如「张三：内容」的行也开新段，开始时间取上一段的结束时间
 * - 段结束时间 = 下一段开始时间；最后一段 end = start（不臆造时长）
 * - 形如 `[` 开头但时间戳不合法（如 `[3:1]`）的行**报错并给行号**，绝不静默丢弃
 *
 * 纯函数、零依赖：便于单测，也便于 T-08 在组装提示前先算统计。
 *
 * @module dsh-note-taker/parse
 */

const TIMESTAMP_LINE = /^\[(\d{1,2}):(\d{2}):(\d{2})\]\s*(.*)$/
const SPEAKER_PREFIX = /^([^：:\s][^：:]{0,19})[：:]\s*(.*)$/

export class TranscriptParseError extends Error {
  constructor(message, { line, expected } = {}) {
    super(message)
    this.name = 'TranscriptParseError'
    this.line = line
    this.expected = expected
  }
}

function parseClock(hours, minutes, seconds, lineNo) {
  const h = Number(hours)
  const m = Number(minutes)
  const s = Number(seconds)
  if (m > 59 || s > 59) {
    throw new TranscriptParseError(`第 ${lineNo} 行时间戳越界（分/秒需 < 60）`, {
      line: lineNo,
      expected: '[HH:MM:SS]',
    })
  }
  return h * 3600 + m * 60 + s
}

/**
 * @param {string} text
 * @returns {{ segments: Array<{start:number,end:number,speaker:string|null,text:string}>, stats: {segments:number,durationSec:number,chars:number} }}
 */
export function parseTranscript(text) {
  if (typeof text !== 'string') {
    throw new TranscriptParseError('转写内容必须是字符串')
  }

  const lines = text.split(/\r?\n/)
  const segments = []

  lines.forEach((rawLine, index) => {
    const lineNo = index + 1
    const line = rawLine.trim()

    // 空行与 markdown 标题不参与解析（转写 md 的首行是 # 标题）
    if (line === '' || line.startsWith('#')) return

    const stamped = line.match(TIMESTAMP_LINE)
    if (stamped) {
      const [, hh, mm, ss, rest] = stamped
      const start = parseClock(hh, mm, ss, lineNo)
      const speakerMatch = rest.match(SPEAKER_PREFIX)
      segments.push({
        start,
        end: start,
        speaker: speakerMatch ? speakerMatch[1].trim() : null,
        text: (speakerMatch ? speakerMatch[2] : rest).trim(),
      })
      return
    }

    // 以 [ 开头但不是合法时间戳：必须报错，不能当成正文吞掉
    if (line.startsWith('[')) {
      throw new TranscriptParseError(`第 ${lineNo} 行时间戳格式不合法：${line}`, {
        line: lineNo,
        expected: '[HH:MM:SS] 内容',
      })
    }

    const speakerMatch = line.match(SPEAKER_PREFIX)
    if (speakerMatch) {
      const previous = segments.at(-1)
      const start = previous ? previous.end : 0
      segments.push({
        start,
        end: start,
        speaker: speakerMatch[1].trim(),
        text: speakerMatch[2].trim(),
      })
      return
    }

    // 续行：并入上一段；没有上一段说明这份文本结构不对，同样报错
    const previous = segments.at(-1)
    if (!previous) {
      throw new TranscriptParseError(`第 ${lineNo} 行无法归属到任何发言：${line}`, {
        line: lineNo,
        expected: '先出现一条带时间戳或「发言人：」的发言',
      })
    }
    previous.text = previous.text ? `${previous.text}\n${line}` : line
  })

  // 段结束时间 = 下一段开始时间；末段保持 start，不臆造时长
  for (let i = 0; i < segments.length - 1; i += 1) {
    segments[i].end = segments[i + 1].start
  }

  const chars = segments.reduce((sum, segment) => sum + segment.text.length, 0)
  const durationSec = segments.length > 0 ? segments.at(-1).end : 0

  return {
    segments,
    stats: { segments: segments.length, durationSec, chars },
  }
}
