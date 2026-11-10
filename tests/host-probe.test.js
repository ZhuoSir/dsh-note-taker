import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getHostStatus, hostStatusText, probeHost, resetHostStatus } from '../src/client/host.js'

test('宿主直接给 conversation.send → 可用（direct）', () => {
  resetHostStatus()
  const ctx = { get: (name) => (name === 'conversation' ? { send: async () => {} } : undefined) }

  const status = probeHost(ctx)
  assert.equal(status.conversation, 'available')
  assert.equal(status.via, 'direct')
  assert.match(hostStatusText(status), /可用（direct）/)
})

test('ctx.conversation 上挂 send 也认', () => {
  resetHostStatus()
  const status = probeHost({ conversation: { send: async () => {} } })
  assert.equal(status.conversation, 'available')
})

test('直接取抛错 → 记录原因，再尝试注入', () => {
  resetHostStatus()
  const ctx = {
    get: () => { throw new Error('cannot get property "conversation" without inject') },
    inject: (deps, callback) => callback({ conversation: { send: async () => {} } }),
  }

  const status = probeHost(ctx)
  assert.equal(status.conversation, 'available')
  assert.equal(status.via, 'inject', 'direct 失败后应由注入救回')
})

test('两条路都拿不到 → 不可用并给出原因', () => {
  resetHostStatus()
  const status = probeHost({ get: () => undefined, inject: (deps, callback) => callback({}) })

  assert.equal(status.conversation, 'unavailable')
  assert.match(status.reason, /没有 send/)
  assert.match(hostStatusText(status), /不可用/)
})

test('宿主没有 inject 能力也不抛错', () => {
  resetHostStatus()
  assert.doesNotThrow(() => probeHost({}))
  assert.equal(getHostStatus().conversation, 'unavailable')
})

test('注入本身抛错被吞掉，状态仍可读', () => {
  resetHostStatus()
  const status = probeHost({
    get: () => undefined,
    inject: () => { throw new Error('服务未提供') },
  })
  assert.equal(status.conversation, 'unavailable')
  assert.match(status.reason, /注入失败/)
})

test('reset 后回到未知态', () => {
  resetHostStatus()
  assert.equal(getHostStatus().conversation, 'unknown')
  assert.match(hostStatusText(), /尚未探测/)
})

test('状态文本三种形态', () => {
  assert.match(hostStatusText({ conversation: 'available', via: 'inject' }), /可用（inject）/)
  assert.match(hostStatusText({ conversation: 'unavailable', reason: 'x' }), /不可用（x）/)
  assert.match(hostStatusText({ conversation: 'unknown' }), /尚未探测/)
})
