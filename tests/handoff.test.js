import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildHandoffMessage } from '../src/client/handoff.js'

const BASE = {
  meetingId: '20261110-1626-3d64',
  label: '周会',
  durationSec: 2826,
  outputPath: 'meetings/20261110-1626-3d64.md',
  outputMode: 'workspace',
  workspaceRoot: 'D:/work/demo',
}

test('有产物路径：只给路径与指令，不内联转写', () => {
  const result = buildHandoffMessage({ ...BASE, transcript: 'x'.repeat(20000) })

  assert.equal(result.ok, true)
  assert.equal(result.mode, 'file')
  assert.match(result.text, /20261110-1626-3d64/)
  assert.match(result.text, /周会/)
  assert.match(result.text, /47:06/)
  assert.match(result.text, /meetings\/20261110-1626-3d64\.md/)
  assert.match(result.text, /## 纪要/)
  assert.match(result.text, /工作区根/)
  assert.doesNotMatch(result.text, /xxxxx/, '不得内联转写正文')
})

test('消息长度与转写长度无关，且远小于内联阈值', () => {
  const short = buildHandoffMessage({ ...BASE, transcript: 'a'.repeat(100) })
  const long = buildHandoffMessage({ ...BASE, transcript: 'a'.repeat(50000) })

  assert.equal(short.chars, long.chars, '有路径时长度与转写无关')
  assert.ok(long.text.length < 800, `消息应短，实际 ${long.text.length}`)
})

test('回落模式：给绝对路径且不写工作区根', () => {
  const result = buildHandoffMessage({
    ...BASE,
    outputMode: 'fallback',
    outputPath: 'D:/data/meetings/20261110-1626-3d64.md',
    workspaceRoot: undefined,
  })

  assert.match(result.text, /D:\/data\/meetings\/20261110-1626-3d64\.md/)
  assert.doesNotMatch(result.text, /工作区根/)
})

test('没有产物路径时退化为内联（兼容旧行为）', () => {
  const result = buildHandoffMessage({
    meetingId: 'm-1', label: '周会', durationSec: 60, transcript: '[00:00:00] 内容',
  })

  assert.equal(result.mode, 'inline')
  assert.match(result.text, /\[00:00:00\] 内容/)
  assert.match(result.text, /行动项/)
})

test('既无路径又无转写时拒绝构造', () => {
  assert.equal(buildHandoffMessage({ meetingId: 'm-1' }).ok, false)
  assert.match(buildHandoffMessage({ meetingId: 'm-1' }).reason, /既没有产物路径/)
})

test('缺会议 id 直接拒绝', () => {
  assert.equal(buildHandoffMessage({ ...BASE, meetingId: '' }).ok, false)
})
