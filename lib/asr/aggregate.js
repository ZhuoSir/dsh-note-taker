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
