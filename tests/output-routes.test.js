import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildRoutes } from '../lib/routes.js'

function loggerSpy() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') }
}

function fakeService() {
  const calls = []
  return {
    calls,
    service: {
      transcribe: (args) => { calls.push(['transcribe', args]); return Promise.resolve({ ok: true }) },
      detail: (args) => { calls.push(['detail', args]); return { ok: true, outputMode: 'workspace' } },
      minutes: (args) => { calls.push(['minutes', args]); return { ok: true } },
      list: () => ({ ok: true, meetings: [] }),
      renameMeeting: () => ({ ok: true }),
    },
  }
}

function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v },
    end(b) { this.body = b },
  }
}

async function invoke(route, req) {
  const res = fakeRes()
  await route.handler(req, res)
  return { res, payload: res.body ? JSON.parse(res.body) : null }
}

const routeByName = (routes, name) => routes.find((item) => item.path === `/note-taker/${name}`)

test('transcribe 透传 sessionId', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  await invoke(routeByName(routes, 'transcribe'), {
    method: 'POST', url: '/note-taker/transcribe', body: { id: 'm-1', engine: 'cloud', sessionId: 'sess-1' },
  })
  assert.deepEqual(calls[0], ['transcribe', { meetingId: 'm-1', engine: 'cloud', sessionId: 'sess-1' }])
})

test('detail 透传 sessionId（查询串）', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  await invoke(routeByName(routes, 'detail'), { url: '/note-taker/detail?id=m-1&sessionId=sess-1' })
  assert.deepEqual(calls[0], ['detail', { meetingId: 'm-1', sessionId: 'sess-1' }])
})

test('minutes 透传 sessionId', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  await invoke(routeByName(routes, 'minutes'), {
    method: 'POST', url: '/note-taker/minutes', body: { id: 'm-1', force: true, sessionId: 'sess-1' },
  })
  assert.deepEqual(calls[0], ['minutes', { meetingId: 'm-1', force: true, sessionId: 'sess-1' }])
})

test('不传 sessionId 时行为与改造前一致（回归）', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  await invoke(routeByName(routes, 'transcribe'), {
    method: 'POST', url: '/note-taker/transcribe', body: { id: 'm-1', engine: 'local' },
  })
  assert.deepEqual(calls[0], ['transcribe', { meetingId: 'm-1', engine: 'local', sessionId: undefined }])

  await invoke(routeByName(routes, 'detail'), { url: '/note-taker/detail?id=m-1' })
  assert.deepEqual(calls[1], ['detail', { meetingId: 'm-1', sessionId: undefined }])
})

test('非法 sessionId 被拒且不调用 service', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  const bad = await invoke(routeByName(routes, 'transcribe'), {
    method: 'POST', url: '/note-taker/transcribe', body: { id: 'm-1', sessionId: 'a b/../../x' },
  })
  assert.equal(bad.payload.ok, false)
  assert.equal(bad.payload.detail.field, 'sessionId')
  assert.equal(calls.length, 0)
})

test('日志记录工作区解析（mode + 是否带会话）', async () => {
  const logger = loggerSpy()
  const { service } = fakeService()
  const routes = buildRoutes({ service, logger })

  await invoke(routeByName(routes, 'transcribe'), {
    method: 'POST', url: '/note-taker/transcribe', body: { id: 'm-1', sessionId: 'sess-1' },
  })

  const entry = logger.lines.find((line) => line.message === '动作转发')
  assert.equal(entry.fields.session, true)
})
