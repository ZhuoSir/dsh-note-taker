import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MINUTES_HEADING,
  TRANSCRIPT_HEADING,
  extractMinutes,
  mergeMinutes,
  renderProduct,
  resolveProductPaths,
} from '../lib/output.js'

const SEGMENTS = [
  { start: 0.36, end: 9.16, text: '那这个里面变更的时候可能需要大量的' },
  { start: 9.16, end: 15.2, text: '但是现在还有一个好处' },
]

const MEETING = {
  meetingId: '20261110-1626-3d64',
  label: '周会',
  startedAt: '2026-11-10T16:26:00+08:00',
  durationSec: 2826,
  engine: 'cloud',
  model: 'qwen-audio-3.1-asr-flash',
  segments: SEGMENTS,
}

test('路径：有工作区写工作区，无工作区回落数据目录', () => {
  const inWorkspace = resolveProductPaths({ dataRoot: 'D:/data', workspaceDir: 'D:/work/demo', meetingId: 'm-1' })
  assert.equal(inWorkspace.mode, 'workspace')
  assert.equal(inWorkspace.file.replace(/\\/g, '/'), 'D:/work/demo/meetings/m-1.md')
  assert.equal(inWorkspace.relative, 'meetings/m-1.md')
  assert.equal(inWorkspace.workspaceRoot, 'D:/work/demo')

  const fallback = resolveProductPaths({ dataRoot: 'D:/data', workspaceDir: null, meetingId: 'm-1' })
  assert.equal(fallback.mode, 'fallback')
  assert.equal(fallback.file.replace(/\\/g, '/'), 'D:/data/meetings/m-1.md')
  assert.equal(fallback.relative, null)

  assert.throws(() => resolveProductPaths({ dataRoot: 'D:/data' }), /meetingId/)
})

test('渲染：元信息四项齐全，转写带时间戳，纪要段留空', () => {
  const md = renderProduct(MEETING)

  assert.match(md, /^# 20261110-1626-3d64 · 周会/)
  assert.match(md, /- 开始：2026-11-10 16:26/)
  assert.match(md, /- 时长：47:06/)
  assert.match(md, /- 引擎：cloud（qwen-audio-3\.1-asr-flash）/)
  assert.match(md, /- 段数 \/ 字数：2 \/ \d+/)
  assert.match(md, /## 转写/)
  assert.match(md, /\[00:00:00\] 那这个里面变更的时候可能需要大量的/)
  assert.match(md, /\[00:00:09\] 但是现在还有一个好处/)
  assert.match(md, new RegExp(`## 纪要`))
  assert.equal(extractMinutes(md), '', '初始纪要段为空')
})

test('渲染：未命名会议用开始时间当标题', () => {
  const md = renderProduct({ ...MEETING, label: '' })
  assert.match(md, /^# 20261110-1626-3d64 · 2026-11-10 16:26/)
})

test('合并纪要：首次写入追加，第二次替换，且只有一个纪要段', () => {
  const base = renderProduct(MEETING)

  const first = mergeMinutes(base, '## 决议\n- 事项 A')
  assert.match(first, /## 决议/)
  assert.equal(first.split(MINUTES_HEADING).length - 1, 1, '只能有一个纪要标题')

  const second = mergeMinutes(first, '## 决议\n- 事项 B')
  assert.doesNotMatch(second, /事项 A/, '旧纪要应被替换')
  assert.match(second, /事项 B/)
  assert.equal(second.split(MINUTES_HEADING).length - 1, 1)
})

test('合并纪要：转写段落逐字不变（防丢数据）', () => {
  const base = renderProduct(MEETING)
  const before = base.slice(base.indexOf(TRANSCRIPT_HEADING), base.indexOf(MINUTES_HEADING))

  const merged = mergeMinutes(base, '纪要内容')
  const after = merged.slice(merged.indexOf(TRANSCRIPT_HEADING), merged.indexOf(MINUTES_HEADING))

  assert.equal(after, before, '转写段落必须逐字保留')
})

test('合并纪要：文件没有纪要段时自动补上', () => {
  const raw = '# 手工写的\n\n## 转写\n\n[00:00:00] 内容\n'
  const merged = mergeMinutes(raw, '纪要')

  assert.match(merged, /## 转写\n\n\[00:00:00\] 内容/)
  assert.match(merged, /## 纪要\n\n纪要/)
})

test('提取纪要：没有纪要段返回空串', () => {
  assert.equal(extractMinutes('# 只有转写'), '')
  assert.equal(extractMinutes(`${MINUTES_HEADING}\n\n正文\n`), '正文')
})
