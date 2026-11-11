import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createLiveRegistry } from '../lib/live.js'
import { buildRoutes } from '../lib/routes.js'

function fakeClock(start = 1_000_000) {
  let value = start
  return {
    now: () => value,
    advance(ms) {
      value += ms
    },
  }
}

function loggerSpy() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, warn: push('warn'), error: push('error'), info: push('info'), debug: push('debug') }
}

/** 直接调用某条路由的 handler，拿 JSON 响应 */
async function callRoute(routes, path, { method = 'GET', url = '', body = null } = {}) {
  const route = routes.find((item) => item.path === path)
  assert.ok(route, `路由 ${path} 未注册`)
  const chunks = body ? [Buffer.from(JSON.stringify(body))] : []
  const req = {
    method,
    url,
    body: undefined,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  let payload = null
  const res = {
    statusCode: 0,
    setHeader() {},
    end(text) {
      payload = JSON.parse(text)
    },
  }
  await route.handler(req, res)
  return { status: res.statusCode, payload }
}

const LIVE_PATH = '/note-taker/live'

test('没有录音时 live 返回 idle 快照', async () => {
  const registry = createLiveRegistry()
  const routes = buildRoutes({ service: { live: ({ meetingId }) => ({ ok: true, data: registry.snapshotFor(meetingId) }) }, logger: loggerSpy() })

  const { payload } = await callRoute(routes, LIVE_PATH, { url: '/note-taker/live?id=m1' })

  assert.equal(payload.ok, true)
  assert.equal(payload.data.state, 'idle')
  assert.equal(payload.data.meetingId, 'm1')
  assert.deepEqual(payload.data.finals, [])
  assert.equal(payload.data.engine, null)
})

test('流式中返回 partial / finals / chars / elapsedSec', async () => {
  const clock = fakeClock()
  const registry = createLiveRegistry({ now: clock.now })
  const routes = buildRoutes({ service: { live: ({ meetingId }) => ({ ok: true, data: registry.snapshotFor(meetingId) }) }, logger: loggerSpy() })

  registry.attach('m1', { engine: { stream: true, model: 'qwen3-asr-flash-realtime', source: 'file' } })
  clock.advance(12_300)
  registry.update('m1', {
    state: 'streaming',
    audioSecondsSent: 12.2,
    chars: 9,
    partial: '然后我们说',
    finals: [{ startSec: 0.1, endSec: 11.4, text: '这个里面变更的时候' }],
  })

  const { payload } = await callRoute(routes, LIVE_PATH, { url: '/note-taker/live?id=m1' })

  assert.equal(payload.data.state, 'streaming')
  assert.equal(payload.data.partial, '然后我们说')
  assert.equal(payload.data.chars, 9)
  assert.equal(payload.data.elapsedSec, 12.3)
  assert.equal(payload.data.finals.length, 1)
  assert.equal(payload.data.engine.model, 'qwen3-asr-flash-realtime')
})

test('非法 id 被拒（含路径穿越字符）', async () => {
  const registry = createLiveRegistry()
  const routes = buildRoutes({ service: { live: () => { throw new Error('不该走到这里') } }, logger: loggerSpy() })

  const { status, payload } = await callRoute(routes, LIVE_PATH, { url: '/note-taker/live?id=../etc/passwd' })

  assert.equal(status, 400)
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'E_STATE')
  assert.equal(payload.detail.field, 'id')
})

test('查询非当前录音的 id 一律返回 idle', async () => {
  const registry = createLiveRegistry()
  const routes = buildRoutes({ service: { live: ({ meetingId }) => ({ ok: true, data: registry.snapshotFor(meetingId) }) }, logger: loggerSpy() })

  registry.attach('m1', { engine: { stream: true } })
  registry.update('m1', { state: 'streaming', chars: 5 })

  const { payload } = await callRoute(routes, LIVE_PATH, { url: '/note-taker/live?id=m2' })

  assert.equal(payload.data.state, 'idle')
  assert.equal(payload.data.meetingId, 'm2')
})

test('状态机：connecting → streaming → finalizing → done', async () => {
  const registry = createLiveRegistry()

  assert.equal(registry.snapshotFor('m1').state, 'idle')
  registry.attach('m1')
  assert.equal(registry.snapshotFor('m1').state, 'connecting')

  registry.update('m1', { state: 'streaming' })
  assert.equal(registry.snapshotFor('m1').state, 'streaming')

  registry.update('m1', { state: 'finalizing' })
  assert.equal(registry.snapshotFor('m1').state, 'finalizing')

  registry.update('m1', { state: 'done' })
  assert.equal(registry.snapshotFor('m1').state, 'done')
})

test('done 之后 elapsedSec 冻结，不再随时间增长', async () => {
  const clock = fakeClock()
  const registry = createLiveRegistry({ now: clock.now })

  registry.attach('m1')
  registry.update('m1', { state: 'streaming' })
  clock.advance(5_000)
  assert.equal(registry.snapshotFor('m1').elapsedSec, 5)

  registry.update('m1', { state: 'done' })
  clock.advance(60_000)
  assert.equal(registry.snapshotFor('m1').elapsedSec, 5, 'done 后已录时长应冻结')
})

test('detach 之后回到 idle；update 对别的会议无效', async () => {
  const registry = createLiveRegistry()

  registry.attach('m1')
  assert.equal(registry.update('other', { state: 'streaming' }), false, '不属于当前录音的更新应被忽略')
  assert.equal(registry.snapshotFor('m1').state, 'connecting')

  assert.equal(registry.detach('m1'), true)
  assert.equal(registry.snapshotFor('m1').state, 'idle')
  assert.equal(registry.meetingId, null)
})

test('registry 不持有宿主对象，snapshot 是纯数据（可 JSON 序列化）', async () => {
  const registry = createLiveRegistry()
  registry.attach('m1', { engine: { stream: true, model: 'x', source: 'env' } })
  registry.update('m1', { state: 'streaming', finals: [{ startSec: 0, endSec: 1.5, text: '你好' }] })

  const snap = registry.snapshotFor('m1')
  const clone = JSON.parse(JSON.stringify(snap))
  assert.deepEqual(clone, snap)
})