import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { INDEX_FILE, createStore, makeMeetingId } from '../lib/meetings.js'

const roots = []
function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'note-taker-meetings-'))
  roots.push(dir)
  return dir
}

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

let counter = 0
function idFactory() {
  counter += 1
  return `20261110-1145-${String(counter).padStart(4, '0')}`
}

test('会议 id 形如 yyyyMMdd-HHmm-xxxx', () => {
  const id = makeMeetingId(new Date(2026, 10, 10, 11, 45), () => 0.5)
  assert.match(id, /^20261110-1145-[0-9a-f]{4}$/)
})

test('新建后读回，字段一致', () => {
  const store = createStore({ root: freshRoot(), idFactory })
  const { meeting, existing } = store.create({ label: '周会', startedAt: '2026-11-10T11:45:00+08:00' })

  assert.equal(existing, false)
  assert.deepEqual(store.get(meeting.id), meeting)
  assert.equal(meeting.label, '周会')
  assert.deepEqual(meeting.status, { record: 'pending', transcribe: 'pending', minutes: 'pending' })
  assert.equal(meeting.durationSec, null)
})

test('重新实例化 store 后仍可读（进程重启等价）', () => {
  const root = freshRoot()
  const first = createStore({ root, idFactory })
  const { meeting } = first.create({ label: '评审会' })

  const second = createStore({ root })
  const reloaded = second.get(meeting.id)

  assert.ok(reloaded, '重启后应能读回')
  assert.equal(reloaded.label, '评审会')
  assert.equal(reloaded.startedAt, meeting.startedAt)
})

test('list 按 startedAt 倒序', () => {
  const store = createStore({ root: freshRoot(), idFactory })
  store.create({ label: '早', startedAt: '2026-11-10T09:00:00+08:00' })
  store.create({ label: '晚', startedAt: '2026-11-10T15:00:00+08:00' })
  store.create({ label: '中', startedAt: '2026-11-10T12:00:00+08:00' })

  assert.deepEqual(store.list().map((item) => item.label), ['晚', '中', '早'])
})

test('同一音频 sha256 重复登记返回既有 id，总数不变', () => {
  const store = createStore({ root: freshRoot(), idFactory })
  const audio = { path: 'recordings/a.wav', sha256: 'abc123', sampleRate: 16000, channels: 1 }

  const first = store.create({ label: '第一次', audio })
  const second = store.create({ label: '第二次', audio })

  assert.equal(first.existing, false)
  assert.equal(second.existing, true)
  assert.equal(second.matchedId, first.meeting.id)
  assert.equal(store.list().length, 1)
})

test('索引损坏时报错且不覆盖原文件', () => {
  const root = freshRoot()
  const broken = '{"version":1, "meetings": ['
  writeFileSync(join(root, INDEX_FILE), broken, 'utf8')
  const store = createStore({ root })

  assert.throws(() => store.list(), /会议索引损坏/)
  assert.equal(readFileSync(join(root, INDEX_FILE), 'utf8'), broken, '损坏文件必须原样保留')
})

test('写入后不留 .tmp 残留', () => {
  const root = freshRoot()
  const store = createStore({ root, idFactory })
  store.create({ label: '周会' })

  const leftovers = readdirSync(root).filter((name) => name.endsWith('.tmp'))
  assert.deepEqual(leftovers, [])
  assert.ok(existsSync(join(root, INDEX_FILE)))
})

test('patch 只改白名单字段，并校验状态值', () => {
  const store = createStore({ root: freshRoot(), idFactory })
  const { meeting } = store.create({ label: '周会' })

  store.patch(meeting.id, { status: { record: 'done' }, durationSec: 190 })
  assert.deepEqual(store.get(meeting.id).status, { record: 'done', transcribe: 'pending', minutes: 'pending' })
  assert.equal(store.get(meeting.id).durationSec, 190)

  assert.throws(() => store.patch(meeting.id, { id: 'hack' }), /字段不可修改/)
  assert.throws(() => store.patch(meeting.id, { status: { record: 'unknown' } }), /非法状态值/)
  assert.throws(() => store.patch('nope', { label: 'x' }), /会议不存在/)
})
