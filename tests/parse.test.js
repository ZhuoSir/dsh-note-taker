import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseTranscript } from '../lib/parse.js'

const SAMPLE = [
  '# 转写：周会',
  '',
  '[00:00:05] 张三：今天三件事。',
  '[00:00:12] 李四：先说灰度，',
  '范围我建议 5%。',
  '[00:01:30] 王五：可以。',
].join('\n')

test('标准格式：段数、发言人、时间轴正确', () => {
  const { segments, stats } = parseTranscript(SAMPLE)

  assert.equal(segments.length, 3)
  assert.deepEqual(segments.map((item) => item.speaker), ['张三', '李四', '王五'])
  assert.deepEqual(segments.map((item) => item.start), [5, 12, 90])
  // 段结束时间 = 下一段开始时间
  assert.deepEqual(segments.map((item) => item.end), [12, 90, 90])
  assert.equal(stats.segments, 3)
  assert.equal(stats.durationSec, 90, '覆盖时长等于末段结束时间')
})

test('续行并入上一段，字符数与各段正文之和相等', () => {
  const { segments, stats } = parseTranscript(SAMPLE)
  const lee = segments[1]

  assert.equal(lee.text, '先说灰度，\n范围我建议 5%。')
  assert.equal(stats.chars, segments.reduce((sum, item) => sum + item.text.length, 0))
})

test('无时间戳的「发言人：」行也开新段，起点接上一段结束', () => {
  const { segments } = parseTranscript('[00:00:10] 张三：开场\n李四：我补充一句')

  assert.equal(segments.length, 2)
  assert.equal(segments[1].speaker, '李四')
  assert.equal(segments[1].start, 10)
})

test('非法时间戳报错并给出行号', () => {
  assert.throws(() => parseTranscript('[00:00:05] 张三：开头\n[3:1] 坏行'), (error) => {
    assert.equal(error.name, 'TranscriptParseError')
    assert.equal(error.line, 2)
    assert.match(error.message, /第 2 行/)
    assert.equal(error.expected, '[HH:MM:SS] 内容')
    return true
  })
})

test('分秒越界也报错', () => {
  assert.throws(() => parseTranscript('[00:75:00] 张三：越界'), /时间戳越界/)
})

test('空输入返回空集合而不是抛错', () => {
  const empty = parseTranscript('')
  assert.deepEqual(empty.segments, [])
  assert.deepEqual(empty.stats, { segments: 0, durationSec: 0, chars: 0 })
})

test('开头就是无法归属的续行时报错，不静默丢弃', () => {
  assert.throws(() => parseTranscript('这是一句没有归属的正文'), /无法归属/)
})

test('markdown 标题与空行被忽略', () => {
  const { segments } = parseTranscript('# 标题\n\n[00:00:01] 张三：你好\n\n')
  assert.equal(segments.length, 1)
})
