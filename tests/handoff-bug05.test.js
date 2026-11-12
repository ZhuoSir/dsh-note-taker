import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildHandoffMessage, modeLabel } from '../src/client/handoff.js'

const ABS = 'D:\\workspace\\my_workspace\\dsh-note-taker\\meetings\\20261112-1309-2625.md'
const LEGACY = 'C:\\Users\\KypCa\\.dsh\\note-taker\\transcripts\\20261111-1412-09cd.md'

test('S-01 有产物：消息含产物绝对路径原样、字节数与转写字数', () => {
  const result = buildHandoffMessage({
    meetingId: '20261112-1309-2625',
    label: '',
    durationSec: 3874,
    outputAbs: ABS,
    outputRelative: 'meetings/20261112-1309-2625.md',
    outputBytes: 654321,
    workspaceRoot: 'D:\\workspace\\my_workspace\\dsh-note-taker',
    transcriptChars: 24912,
  })

  assert.equal(result.ok, true)
  assert.equal(result.mode, 'file')
  assert.ok(result.text.includes(ABS), '绝对路径必须原样出现在消息里')
  assert.match(result.text, /绝对路径/)
  assert.match(result.text, /654321 字节/)
  assert.match(result.text, /24912 字/)
  assert.match(result.text, /直接读取上面的绝对路径/)
  assert.doesNotMatch(result.text, /只放开头摘要/, '不许再出现摘要截断话术')
  assert.ok(result.text.length < 400, `消息应短小，实际 ${result.text.length}`)
})

test('S-02 长转写（24912 字）也不截断、不内联', () => {
  const withProduct = buildHandoffMessage({
    meetingId: '20261112-1309-2625',
    outputAbs: ABS,
    outputRelative: 'meetings/20261112-1309-2625.md',
    outputBytes: 1000,
    transcript: 'x'.repeat(24912),
    transcriptChars: 24912,
  })
  assert.equal(withProduct.mode, 'file')
  assert.ok(withProduct.text.length < 400)
  assert.doesNotMatch(withProduct.text, /xxxxx/, '不得内联正文')
})

test('S-03 无产物但有旧转写：交付该文件绝对路径（legacy）', () => {
  const result = buildHandoffMessage({
    meetingId: '20261111-1412-09cd',
    durationSec: 50,
    outputAbs: null,
    transcriptAbs: LEGACY,
    transcriptChars: 216,
    transcript: 'y'.repeat(30000),
  })

  assert.equal(result.ok, true)
  assert.equal(result.mode, 'legacy')
  assert.ok(result.text.includes(LEGACY))
  assert.match(result.text, /只有转写/)
  assert.match(result.text, /216 字/)
  assert.ok(result.text.length < 400, `不该内联 3 万字，实际 ${result.text.length}`)
})

test('S-04 没有任何载体：明确失败，不发明摘要', () => {
  const tooLong = buildHandoffMessage({
    meetingId: 'm-1',
    transcript: 'z'.repeat(9000),
    transcriptChars: 9000,
  })
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.reason, /9000 字/)
  assert.match(tooLong.reason, /没有可交付的文件路径/)

  const empty = buildHandoffMessage({ meetingId: 'm-1' })
  assert.equal(empty.ok, false)
  assert.match(empty.reason, /既没有产物文件/)
})

test('S-05 回执口径：文件路径不能说成全文', () => {
  assert.equal(modeLabel('file'), '文件路径')
  assert.equal(modeLabel('legacy'), '文件路径（旧转写）')
  assert.equal(modeLabel('inline'), '全文')
})

test('短转写且无文件：仍可内联全文（旧会议兜底）', () => {
  const result = buildHandoffMessage({ meetingId: 'm-2', durationSec: 3, transcript: '[00:00:00] 嗯。', transcriptChars: 9 })
  assert.equal(result.mode, 'inline')
  assert.match(result.text, /\[00:00:00\] 嗯。/)
  assert.equal(modeLabel(result.mode), '全文')
})