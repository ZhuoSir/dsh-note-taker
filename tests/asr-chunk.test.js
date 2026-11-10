import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chunkBytesFor, mergeSegments, splitPcm } from '../lib/asr/chunk.js'

test('片字节数按采样率换算', () => {
  assert.equal(chunkBytesFor(1, 16000), 32000)
  assert.equal(chunkBytesFor(300, 16000), 9_600_000)
})

test('按片切分，最后一片可短，偏移累加正确', () => {
  // 5 秒音频，每片 2 秒 → 3 片
  const pcm = Buffer.alloc(5 * 32000, 1)
  const { chunks, chunkSeconds } = splitPcm(pcm, { chunkSeconds: 2 })

  assert.equal(chunkSeconds, 2)
  assert.equal(chunks.length, 3)
  assert.deepEqual(chunks.map((item) => item.offsetSec), [0, 2, 4])
  assert.deepEqual(chunks.map((item) => item.durationSec), [2, 2, 1])
  assert.equal(chunks.reduce((sum, item) => sum + item.buffer.length, 0), pcm.length, '分片不得丢字节')
})

test('整除时不留空片', () => {
  const pcm = Buffer.alloc(4 * 32000)
  const { chunks } = splitPcm(pcm, { chunkSeconds: 2 })
  assert.equal(chunks.length, 2)
})

test('非 Buffer 抛类型错误', () => {
  assert.throws(() => splitPcm('nope'), TypeError)
})

test('合并时按片偏移累加时间戳并排序', () => {
  const parts = [
    { offsetSec: 0, segments: [{ start: 0.5, end: 1.5, text: '第一句' }] },
    { offsetSec: 2, segments: [{ start: 0.25, end: 0.9, text: '第二句' }] },
  ]
  const merged = mergeSegments(parts)

  assert.deepEqual(merged.map((item) => item.start), [0.5, 2.25])
  assert.deepEqual(merged.map((item) => item.text), ['第一句', '第二句'])
})

test('空文本片段被丢弃', () => {
  const merged = mergeSegments([{ offsetSec: 0, segments: [{ start: 0, end: 1, text: '   ' }, { start: 1, end: 2, text: '有内容' }] }])
  assert.deepEqual(merged.map((item) => item.text), ['有内容'])
})

test('开启重叠时丢弃完全重复的句子', () => {
  const parts = [
    { offsetSec: 0, segments: [{ start: 4, end: 6, text: '交界句' }] },
    { offsetSec: 4, segments: [{ start: 0, end: 2, text: '交界句' }] },
  ]
  const merged = mergeSegments(parts, { overlapSec: 2 })
  assert.equal(merged.length, 1, '重叠区的同一句只保留一次')
})

test('乱序片按时间排好', () => {
  const parts = [
    { offsetSec: 4, segments: [{ start: 0, end: 1, text: '第三' }] },
    { offsetSec: 0, segments: [{ start: 0, end: 1, text: '第一' }] },
    { offsetSec: 2, segments: [{ start: 0, end: 1, text: '第二' }] },
  ]
  assert.deepEqual(mergeSegments(parts).map((item) => item.text), ['第一', '第二', '第三'])
})
