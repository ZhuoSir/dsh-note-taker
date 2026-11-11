import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  FALLBACK_EXTENSION,
  MAX_IMPORT_BYTES,
  checkSize,
  deriveLabel,
  missingPathHint,
  pickExtension,
} from '../lib/import.js'

test('标签推导：文件名去后缀', () => {
  assert.equal(deriveLabel({ path: 'D:/会议/周会录音.m4a' }), '周会录音')
  assert.equal(deriveLabel({ path: 'D:/会议/需求评审.WAV' }), '需求评审')
})

test('标签推导：无后缀保留整个名字，空名回退时间', () => {
  assert.equal(deriveLabel({ path: '/tmp/blob_noext' }), 'blob_noext')
  assert.equal(deriveLabel({ path: '/tmp/.hidden' }), '导入的音频', '只有后缀时回退到默认文案')
  assert.equal(deriveLabel({ path: '', startedAt: '2026-11-10T16:26:00+08:00' }), '2026-11-10 16:26')
  assert.equal(deriveLabel({ path: '   ', startedAt: 'not-a-date' }), '导入的音频')
})

test('标签超长截断到 60 字', () => {
  const long = 'a'.repeat(120)
  assert.equal(deriveLabel({ path: `/tmp/${long}.m4a` }).length, 60)
})

test('扩展名：有则小写保留，无则 .bin', () => {
  assert.equal(pickExtension('a/b.m4a'), '.m4a')
  assert.equal(pickExtension('a/b.MP3'), '.mp3')
  assert.equal(pickExtension('a/blob_noext'), FALLBACK_EXTENSION)
  assert.equal(pickExtension(''), FALLBACK_EXTENSION)
})

test('大小判定：通过 / 超限 / 空文件', () => {
  assert.equal(checkSize(1024).ok, true)

  const over = checkSize(MAX_IMPORT_BYTES + 1024)
  assert.equal(over.ok, false)
  assert.match(over.reason, /文件过大/)
  assert.equal(over.limit, MAX_IMPORT_BYTES)

  const empty = checkSize(0)
  assert.equal(empty.ok, false)
  assert.match(empty.reason, /0 字节/)
})

test('大小判定：边界值刚好等于上限时通过', () => {
  assert.equal(checkSize(MAX_IMPORT_BYTES).ok, true)
})

test('路径提示：区分附件 id 与普通路径', () => {
  assert.match(missingPathHint('a'.repeat(40)), /附件 id/)
  assert.match(missingPathHint('D:/会议/不存在.m4a'), /文件不存在/)
  assert.match(missingPathHint(''), /缺少参数 path/)
})
