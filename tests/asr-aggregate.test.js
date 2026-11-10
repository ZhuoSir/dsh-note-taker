import assert from 'node:assert/strict'
import { test } from 'node:test'

import { aggregateHttpPayload, aggregateSentences } from '../lib/asr/aggregate.js'

function result({ text, begin, end, id = 1, end_ = true, heartbeat = false }) {
  return {
    header: { event: 'result-generated', task_id: 't' },
    payload: {
      output: {
        sentence: {
          sentence_id: id,
          begin_time: begin,
          end_time: end,
          text,
          heartbeat,
          sentence_end: end_,
          sentence_begin: false,
        },
      },
    },
  }
}

test('只取句级终态，毫秒转秒', () => {
  const { segments } = aggregateSentences([result({ text: '欢迎使用阿里云。', begin: 160, end: 1640 })])

  assert.deepEqual(segments, [{ start: 0.16, end: 1.64, text: '欢迎使用阿里云。' }])
})

test('心跳包被丢弃并计数', () => {
  const { segments, dropped } = aggregateSentences([result({ text: 'x', begin: 0, end: 10, heartbeat: true })])

  assert.deepEqual(segments, [])
  assert.equal(dropped.heartbeat, 1)
})

test('中间结果被丢弃，只保留最终态', () => {
  const events = [
    result({ text: '欢迎', begin: 160, end: 800, end_: false }),
    result({ text: '欢迎使用', begin: 160, end: 1200, end_: false }),
    result({ text: '欢迎使用阿里云。', begin: 160, end: 1640 }),
  ]
  const { segments, dropped } = aggregateSentences(events)

  assert.equal(dropped.interim, 2)
  assert.deepEqual(segments, [{ start: 0.16, end: 1.64, text: '欢迎使用阿里云。' }])
})

test('同一 sentence_id 多次终态时保留最后一次', () => {
  const events = [
    result({ text: '第一版', begin: 0, end: 1000, id: 7 }),
    result({ text: '第二版', begin: 0, end: 1000, id: 7 }),
  ]
  const { segments } = aggregateSentences(events)
  assert.deepEqual(segments.map((item) => item.text), ['第二版'])
})

test('乱序到达按开始时间排序', () => {
  const events = [
    result({ text: '第三句', begin: 4000, end: 5000, id: 3 }),
    result({ text: '第一句', begin: 0, end: 1000, id: 1 }),
    result({ text: '第二句', begin: 2000, end: 3000, id: 2 }),
  ]
  const { segments } = aggregateSentences(events)
  assert.deepEqual(segments.map((item) => item.text), ['第一句', '第二句', '第三句'])
})

test('空事件流产出空数组，不抛错', () => {
  const { segments, usage } = aggregateSentences([])
  assert.deepEqual(segments, [])
  assert.equal(usage, null)
})

test('畸形事件跳过并计数，不抛错', () => {
  const events = [
    { header: { event: 'result-generated' }, payload: {} },
    { header: { event: 'result-generated' }, payload: { output: { sentence: { sentence_end: true, text: '   ' } } } },
    { header: { event: 'unknown-event' } },
    null,
  ]
  const { segments, dropped } = aggregateSentences(events)

  assert.deepEqual(segments, [])
  assert.equal(dropped.malformed, 2)
  // 未知事件与 null 都按「非 result-generated」计入 other
  assert.equal(dropped.other, 2)
})

test('task-finished 里的 usage 被收集', () => {
  const { usage } = aggregateSentences([
    result({ text: '一句', begin: 0, end: 1000 }),
    { header: { event: 'task-finished' }, payload: { usage: { duration: 2, total_tokens: 89 } } },
  ])
  assert.deepEqual(usage, { duration: 2, total_tokens: 89 })
})

// ---- CR-01：非实时 HTTP 响应聚合 ----

test('HTTP 响应：顶层 sentence 聚合成一段，偏移生效', () => {
  const payload = { sentence: { sentence_id: 1, begin_time: 200, end_time: 11640, text: '周会开始。', sentence_end: true } }
  const { segments } = aggregateHttpPayload(payload, { offsetSec: 120 })

  assert.deepEqual(segments, [{ start: 120.2, end: 131.64, text: '周会开始。' }])
})

test('HTTP 响应：output.sentences 数组（开说话人分离）带 speakerId', () => {
  const payload = {
    output: {
      sentences: [
        { sentence_id: 1, begin_time: 0, end_time: 1000, text: '第一句', speaker_id: 0 },
        { sentence_id: 2, begin_time: 1000, end_time: 2000, text: '第二句', speaker_id: 1 },
      ],
    },
  }
  const { segments } = aggregateHttpPayload(payload)

  assert.equal(segments.length, 2)
  assert.equal(segments[0].speakerId, 0)
  assert.equal(segments[1].speakerId, 1)
})

test('HTTP 响应：没有句子时返回空数组，不抛错', () => {
  assert.deepEqual(aggregateHttpPayload({}).segments, [])
  assert.deepEqual(aggregateHttpPayload(null).segments, [])
})

test('HTTP 响应：空文本被丢弃并计数', () => {
  const { segments, dropped } = aggregateHttpPayload({ sentence: { begin_time: 0, end_time: 1, text: '  ' } })
  assert.deepEqual(segments, [])
  assert.equal(dropped.malformed, 1)
})
