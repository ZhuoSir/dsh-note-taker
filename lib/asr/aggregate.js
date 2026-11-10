/**
 * 把百炼实时识别的服务端事件聚合成句子级段落（纯函数）。
 *
 * 规则（plan 决策 4）：
 * - 只认 `header.event === 'result-generated'`
 * - 丢弃 heartbeat 包与中间结果（sentence_end !== true）
 * - 时间戳是毫秒，落盘要秒
 * - 同一 sentence_id 多次到达时保留最后一次（服务端可能改写）
 * - 按开始时间排序，保证时间轴单调
 *
 * @module dsh-note-taker/asr/aggregate
 */

function toSeconds(ms) {
  const value = Number(ms)
  return Number.isFinite(value) && value >= 0 ? Math.round((value / 1000) * 100) / 100 : 0
}

/**
 * @param {object[]} events 已解析的服务端事件对象
 * @returns {{segments:Array<{start:number,end:number,text:string}>, usage:object|null, dropped:object}}
 */
export function aggregateSentences(events = []) {
  const bySentence = new Map()
  const dropped = { heartbeat: 0, interim: 0, malformed: 0, other: 0 }
  let usage = null

  for (const event of events) {
    const name = event?.header?.event

    if (name === 'task-finished') {
      usage = event?.payload?.usage ?? usage
      continue
    }
    if (name === 'task-started' || name === 'task-failed') continue
    if (name !== 'result-generated') {
      dropped.other += 1
      continue
    }

    const sentence = event?.payload?.output?.sentence
    if (!sentence || typeof sentence !== 'object') {
      dropped.malformed += 1
      continue
    }
    if (sentence.heartbeat === true) {
      dropped.heartbeat += 1
      continue
    }
    if (sentence.sentence_end !== true) {
      dropped.interim += 1
      continue
    }

    const text = typeof sentence.text === 'string' ? sentence.text.trim() : ''
    if (text === '') {
      dropped.malformed += 1
      continue
    }

    const key = Number.isInteger(sentence.sentence_id) ? sentence.sentence_id : `t${toSeconds(sentence.begin_time)}`
    bySentence.set(key, {
      start: toSeconds(sentence.begin_time),
      end: toSeconds(sentence.end_time ?? sentence.begin_time),
      text,
    })
  }

  const segments = [...bySentence.values()].sort((a, b) => a.start - b.start || a.end - b.end)
  return { segments, usage, dropped }
}

const SENTENCE_END = /[。！？；!?;]/

/**
 * 按 words 的标点把一句长文本切成更细的段落。
 * 云端 `sentence` 是按长停顿切的（实测 2 分钟只回 1 句），
 * 而 `words[]` 带逐字时间与标点，用它重建句级粒度才能和本地产物对齐。
 */
export function splitSentenceByWords(words, { offsetSec = 0 } = {}) {
  if (!Array.isArray(words) || words.length === 0) return []

  const segments = []
  let buffer = null

  const flush = () => {
    if (buffer && buffer.text.trim() !== '') {
      segments.push({
        start: Math.round((offsetSec + buffer.start) * 100) / 100,
        end: Math.round((offsetSec + buffer.end) * 100) / 100,
        text: buffer.text.trim(),
      })
    }
    buffer = null
  }

  for (const word of words) {
    const text = String(word?.text ?? '')
    const punctuation = String(word?.punctuation ?? '')
    if (text === '' && punctuation === '') continue

    const begin = Number(word?.begin_time)
    const end = Number(word?.end_time)
    if (!buffer) {
      buffer = { start: toSeconds(begin), end: toSeconds(end), text: '' }
    }
    buffer.text += text + punctuation
    buffer.end = toSeconds(Number.isFinite(end) ? end : word?.begin_time)

    if (SENTENCE_END.test(punctuation)) flush()
  }
  flush()
  return segments
}

/**
 * 聚合非实时 HTTP 接口的响应体（CR-01）。
 *
 * 实测响应形态：顶层 `{ sentence: {...} }`；开启说话人分离时文档写的是 `output.sentences[]`。
 * 这里对两种路径都做兼容，时间戳同样是毫秒。
 * 若 `sentence.words` 存在，则用它把长句切细（粒度和本地引擎对齐）。
 *
 * @param {object} payload 响应体
 * @param {{offsetSec?: number, useWords?: boolean}} [options] 分片时的片起始偏移
 */
export function aggregateHttpPayload(payload, { offsetSec = 0, useWords = true } = {}) {
  const collected = []
  const dropped = { malformed: 0 }

  const push = (sentence) => {
    if (!sentence || typeof sentence !== 'object') {
      dropped.malformed += 1
      return
    }

    // 优先用 words 重建句级粒度
    if (useWords && Array.isArray(sentence.words) && sentence.words.length > 0) {
      const fine = splitSentenceByWords(sentence.words, { offsetSec })
      if (fine.length > 0) {
        const speaker = Number.isInteger(sentence.speaker_id) && sentence.speaker_id >= 0 ? sentence.speaker_id : null
        for (const segment of fine) {
          collected.push(speaker === null ? segment : { ...segment, speakerId: speaker })
        }
        return
      }
    }

    const text = typeof sentence.text === 'string' ? sentence.text.trim() : ''
    if (text === '') {
      dropped.malformed += 1
      return
    }
    collected.push({
      start: Math.round((offsetSec + toSeconds(sentence.begin_time)) * 100) / 100,
      end: Math.round((offsetSec + toSeconds(sentence.end_time ?? sentence.begin_time)) * 100) / 100,
      text,
      ...(Number.isInteger(sentence.speaker_id) && sentence.speaker_id >= 0 ? { speakerId: sentence.speaker_id } : {}),
    })
  }

  if (payload?.sentence) push(payload.sentence)
  if (Array.isArray(payload?.sentences)) payload.sentences.forEach(push)
  if (payload?.output?.sentence) push(payload.output.sentence)
  if (Array.isArray(payload?.output?.sentences)) payload.output.sentences.forEach(push)

  // 实测响应里 sentence 与 output.sentence 是同一句的回声，按「时间+文本」去重
  const seen = new Set()
  const unique = collected.filter((segment) => {
    const key = `${segment.start}|${segment.end}|${segment.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const segments = unique.sort((a, b) => a.start - b.start || a.end - b.end)
  return { segments, usage: payload?.usage ?? payload?.output?.usage ?? null, dropped }
}
