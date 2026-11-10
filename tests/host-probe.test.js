import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getHostStatus, hostStatusText, probeHost, resetHostStatus, sendToSession } from '../src/client/host.js'

function fakeSessions({ conversation = { send: async () => {} }, scopes = {} } = {}) {
  return {
    scope: (id) => (Object.hasOwn(scopes, id) ? scopes[id] : { get: () => conversation }),
  }
}

test('注入拿到 sessions.scope → 可用（inject）', () => {
  resetHostStatus()
  const sessions = fakeSessions()
  const status = probeHost({
    get: () => { throw new Error('cannot get property "sessions" without inject') },
    inject: (deps, callback) => callback({ sessions }),
  })

  assert.equal(status.conversation, 'available')
  assert.equal(status.via, 'inject')
  assert.match(hostStatusText(status), /sessions\.scope/)
})

test('直接取到也认，缺 sessions 则不可用并说明原因', () => {
  resetHostStatus()
  assert.equal(probeHost({ get: () => fakeSessions() }).conversation, 'available')

  resetHostStatus()
  const status = probeHost({ get: () => undefined, inject: (deps, cb) => cb({}) })
  assert.equal(status.conversation, 'unavailable')
  assert.match(status.reason, /sessions\.scope/)
})

test('宿主没有 inject 也不抛错', () => {
  resetHostStatus()
  assert.doesNotThrow(() => probeHost({}))
  assert.equal(getHostStatus().conversation, 'unavailable')
})

test('sendToSession：走 sessions.scope(id).get("conversation").send', async () => {
  resetHostStatus()
  const sent = []
  const sessions = fakeSessions({ conversation: { send: async (text) => { sent.push(text) } } })
  probeHost({ get: () => sessions })

  const result = await sendToSession({ sessionId: 'sess-1', text: '【会记】会议 m-1' })
  assert.equal(result.ok, true)
  assert.deepEqual(sent, ['【会记】会议 m-1'])
})

test('sendToSession：缺 sessionId / 空文本 / 无服务时都返回可读原因', async () => {
  resetHostStatus()
  assert.equal((await sendToSession({ text: 'x' })).ok, false)

  resetHostStatus()
  probeHost({ get: () => fakeSessions() })
  assert.match((await sendToSession({ sessionId: 's', text: '   ' })).reason, /为空/)

  resetHostStatus()
  assert.match((await sendToSession({ sessionId: 's', text: 'x' })).reason, /未提供 sessions/)
})

test('sendToSession：作用域里没有 conversation 时报原因', async () => {
  resetHostStatus()
  probeHost({ get: () => ({ scope: () => ({ get: () => undefined }) }) })

  const result = await sendToSession({ sessionId: 'sess-9', text: 'x' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /没有 conversation\.send/)
})

test('sendToSession：send 抛错被收敛成原因', async () => {
  resetHostStatus()
  probeHost({ get: () => fakeSessions({ conversation: { send: async () => { throw new Error('queued full') } } }) })

  const result = await sendToSession({ sessionId: 's', text: 'x' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /queued full/)
})
