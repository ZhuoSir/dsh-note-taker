import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MAX_INLINE_CHARS, buildHandoffMessage } from '../src/client/handoff.js'

const BASE = { meetingId: '20261110-1530-abcd', label: '周会', durationSec: 2826, transcript: '[00:00:00] 周会开始。\n[00:00:09] 今天讨论灰度。' }

test('正常长度：内联全文，含会议 id、标签、时长与指令', () => {
  const result = buildHandoffMessage(BASE)

  assert.equal(result.ok, true)
  assert.equal(result.mode, 'inline')
  assert.match(result.text, /20261110-1530-abcd/)
  assert.match(result.text, /周会/)
  assert.match(result.text, /47:06/)
  assert.match(result.text, /生成会议纪要/)
  assert.match(result.text, /周会开始。/, '正文原样保留')
  assert.match(result.text, /今天讨论灰度。/, '多行正文都要保留')
})

test('未命名会议用占位标签', () => {
  const result = buildHandoffMessage({ ...BASE, label: '' })
  assert.match(result.text, /\(未命名\)/)
})

test('超长正文：降级为摘要 + 指向 transcripts 文件', () => {
  const long = Array.from({ length: 4000 }, (_, index) => `[00:00:${index % 60}] 第 ${index} 句内容。`).join('\n')
  const result = buildHandoffMessage({ ...BASE, transcript: long })

  assert.equal(result.ok, true)
  assert.equal(result.mode, 'summary')
  assert.match(result.text, /transcripts\/20261110-1530-abcd\.md/)
  assert.match(result.text, /超过单次消息上限/)
  assert.ok(result.text.length < 2000, `摘要应远小于正文，实际 ${result.text.length}`)
})

test('正好等于阈值时仍内联', () => {
  const exact = 'a'.repeat(MAX_INLINE_CHARS)
  const result = buildHandoffMessage({ ...BASE, transcript: exact })
  assert.equal(result.mode, 'inline')
})

test('缺会议 id 或空正文时拒绝构造', () => {
  assert.equal(buildHandoffMessage({ ...BASE, meetingId: '' }).ok, false)
  assert.equal(buildHandoffMessage({ ...BASE, transcript: '   ' }).ok, false)
  assert.match(buildHandoffMessage({ ...BASE, transcript: '' }).reason, /为空/)
})

test('自定义阈值生效', () => {
  const result = buildHandoffMessage({ ...BASE, transcript: 'x'.repeat(100), maxChars: 50 })
  assert.equal(result.mode, 'summary')
})
