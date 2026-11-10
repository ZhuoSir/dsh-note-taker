import assert from 'node:assert/strict'
import { test } from 'node:test'

import { aggregateSentences } from '../lib/asr/aggregate.js'

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
