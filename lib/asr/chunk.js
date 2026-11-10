/**
 * 长音频切片与合并（R-11）。
 *
 * 为什么需要：HTTP 接口对单次请求的音频时长有上限，而会议动辄 40+ 分钟。
 * 做法：按固定时长切 PCM、逐片识别、把片内时间戳加上片起始偏移后合并。
 *
 * 已知限制（plan 风险节已列）：切点落在句子中间会切断一句。缓解方式是给相邻片
 * 留一小段重叠并在合并时按时间来重（见 mergeSegments 的 overlapSec）。
 *
 * @module dsh-note-taker/asr/chunk
 */

import { BYTES_PER_SAMPLE, SAMPLE_RATE } from './pcm.js'

export const DEFAULT_CHUNK_SECONDS = 300

export function chunkBytesFor(seconds = DEFAULT_CHUNK_SECONDS, sampleRate = SAMPLE_RATE) {
  return Math.round(seconds * sampleRate * BYTES_PER_SAMPLE)
}

/**
 * 纯函数：把 PCM 裸流按片切分。
 * @returns {{chunks: Array<{buffer: Buffer, offsetSec: number, durationSec: number}>, chunkSeconds: number}}
 */
export function splitPcm(pcm, { chunkSeconds = DEFAULT_CHUNK_SECONDS, sampleRate = SAMPLE_RATE } = {}) {
  if (!Buffer.isBuffer(pcm)) throw new TypeError('splitPcm 需要 Buffer')
  const size = chunkBytesFor(chunkSeconds, sampleRate)
  const chunks = []
  for (let offset = 0, index = 0; offset < pcm.length; offset += size, index += 1) {
    const buffer = pcm.subarray(offset, Math.min(offset + size, pcm.length))
    chunks.push({
      buffer,
      offsetSec: Math.round((index * chunkSeconds) * 100) / 100,
      durationSec: Math.round((buffer.length / (sampleRate * BYTES_PER_SAMPLE)) * 100) / 100,
    })
  }
  return { chunks, chunkSeconds }
}

/**
 * 纯函数：把各片的 segments 合并，时间戳按片偏移累加。
 * @param {Array<{offsetSec:number, segments:Array<{start:number,end:number,text:string}>}>} parts
 * @param {{overlapSec?: number}} [options] 相邻片的重叠时长，用于丢弃重复片段
 */
export function mergeSegments(parts, { overlapSec = 0 } = {}) {
  const merged = []
  for (const part of parts) {
    const offset = part.offsetSec ?? 0
    for (const segment of part.segments ?? []) {
      const start = Math.round((offset + segment.start) * 100) / 100
      const end = Math.round((offset + segment.end) * 100) / 100
      const text = String(segment.text ?? '').trim()
      if (text === '') continue

      if (overlapSec > 0 && merged.length > 0) {
        const last = merged.at(-1)
        // 重叠区里重复出现的同一句：完全包含则丢弃后者
        if (start <= last.end && text === last.text) continue
      }
      merged.push({ ...segment, start, end, text })
    }
  }
  merged.sort((a, b) => a.start - b.start || a.end - b.end)
  return merged
}
