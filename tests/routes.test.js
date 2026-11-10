import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildRoutes } from '../lib/routes.js'

function loggerSpy() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') }
}

function fakeService(overrides = {}) {
  const calls = []
  const base = {
    list: (args) => { calls.push(['list', args]); return { ok: true, meetings: [] } },
    detail: (args) => { calls.push(['detail', args]); return { ok: true, meeting: { id: args.meetingId }, transcript: null, minutes: null } },
    capabilities: () => { calls.push(['capabilities']); return { ok: true, cloud: { configured: false } } },
    transcribe: (args) => { calls.push(['transcribe', args]); return Promise.resolve({ ok: true }) },
    minutes: (args) => { calls.push(['minutes', args]); return { ok: true, minutesPath: '/x.md' } },
    recordStart: (args) => { calls.push(['recordStart', args]); return { ok: true, meetingId: 'm-1' } },
    recordStop: () => { calls.push(['recordStop']); return { ok: true, durationSec: 5 } },
    readConfig: () => { calls.push(['readConfig']); return { ok: true, config: {} } },
    saveConfig: (args) => { calls.push(['saveConfig', args]); return { ok: true, saved: [] } },
    renameMeeting: (args) => { calls.push(['renameMeeting', args]); return { ok: true, meetingId: args.meetingId, label: args.label } },
    importAudio: (args) => { calls.push(['importAudio', args]); return { ok: true, meetingId: 'm-imp', durationSec: 60 } },
  }
  return { service: { ...base, ...overrides }, calls }
}

function fakeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value },
    end(body) { this.body = body },
  }
  return res
}

function fakeReq({ method = 'GET', url = '/note-taker/list', body } = {}) {
  return { method, url, body }
}

async function invoke(route, req) {
  const res = fakeRes()
  await route.handler(req, res)
  return { res, payload: res.body ? JSON.parse(res.body) : null }
}

function routeByName(routes, name) {
  return routes.find((item) => item.path === `/note-taker/${name}`)
}

test('注册九条 exact 路由', () => {
  const { service } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  assert.equal(routes.length, 9)
  assert.deepEqual(routes.map((item) => item.path).sort(), [
    '/note-taker/config', '/note-taker/detail', '/note-taker/health', '/note-taker/import', '/note-taker/label', '/note-taker/list',
    '/note-taker/minutes', '/note-taker/record', '/note-taker/transcribe',
  ])
  assert.ok(routes.every((item) => item.kind === 'exact'))
})

test('list：缺省 limit 20，透传 limit', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  await invoke(routeByName(routes, 'list'), fakeReq({ url: '/note-taker/list' }))
  assert.deepEqual(calls[0], ['list', { limit: 20 }])

  await invoke(routeByName(routes, 'list'), fakeReq({ url: '/note-taker/list?limit=5' }))
  assert.deepEqual(calls[1], ['list', { limit: '5' }])
})

test('detail：缺 id / 非法 id 都被拒，且不调用 service', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  const missing = await invoke(routeByName(routes, 'detail'), fakeReq({ url: '/note-taker/detail' }))
  assert.equal(missing.payload.ok, false)
  assert.equal(missing.payload.detail.field, 'id')

  const traversal = await invoke(routeByName(routes, 'detail'), fakeReq({ url: '/note-taker/detail?id=../../etc/passwd' }))
  assert.equal(traversal.payload.ok, false, '路径穿越必须被拒')

  assert.equal(calls.length, 0)
})

test('detail：正常 id 透传', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })
  const { payload } = await invoke(routeByName(routes, 'detail'), fakeReq({ url: '/note-taker/detail?id=20261110-1000-abcd' }))

  assert.equal(payload.ok, true)
  assert.deepEqual(calls[0], ['detail', { meetingId: '20261110-1000-abcd' }])
})

test('health 走到 capabilities', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })
  const { payload } = await invoke(routeByName(routes, 'health'), fakeReq({ url: '/note-taker/health' }))

  assert.equal(payload.ok, true)
  assert.deepEqual(calls[0], ['capabilities'])
})

test('transcribe：立即返回 accepted，不等待任务完成', async () => {
  let resolveTask
  const { service, calls } = fakeService({
    transcribe: (args) => {
      calls.push(['transcribe', args])
      return new Promise((resolve) => { resolveTask = resolve })
    },
  })
  const routes = buildRoutes({ service, logger: loggerSpy() })

  const { payload } = await invoke(routeByName(routes, 'transcribe'), fakeReq({
    method: 'POST', url: '/note-taker/transcribe', body: { id: 'm-1', engine: 'cloud' },
  }))

  assert.equal(payload.ok, true)
  assert.equal(payload.accepted, true)
  assert.deepEqual(calls[0], ['transcribe', { meetingId: 'm-1', engine: 'cloud' }])
  resolveTask?.({ ok: true })
})

test('minutes：force 透传', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })
  await invoke(routeByName(routes, 'minutes'), fakeReq({ method: 'POST', url: '/note-taker/minutes', body: { id: 'm-1', force: true } }))

  assert.deepEqual(calls[0], ['minutes', { meetingId: 'm-1', force: true }])
})

test('record：非法 action 被拒，start/stop 分派正确', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  const bad = await invoke(routeByName(routes, 'record'), fakeReq({ method: 'POST', url: '/note-taker/record', body: { action: 'pause' } }))
  assert.equal(bad.payload.ok, false)
  assert.equal(bad.payload.detail.field, 'action')
  assert.equal(calls.length, 0)

  await invoke(routeByName(routes, 'record'), fakeReq({ method: 'POST', url: '/note-taker/record', body: { action: 'start', label: '周会' } }))
  assert.deepEqual(calls[0], ['recordStart', { label: '周会' }])

  await invoke(routeByName(routes, 'record'), fakeReq({ method: 'POST', url: '/note-taker/record', body: { action: 'stop' } }))
  assert.deepEqual(calls[1], ['recordStop'])
})

test('日志：请求/响应成对，非法入参打 WARN，且不含正文', async () => {
  const logger = loggerSpy()
  const { service } = fakeService()
  const routes = buildRoutes({ service, logger })

  await invoke(routeByName(routes, 'list'), fakeReq({ url: '/note-taker/list?limit=3' }))
  await invoke(routeByName(routes, 'record'), fakeReq({ method: 'POST', url: '/note-taker/record', body: { action: 'nope' } }))

  const messages = logger.lines.map((line) => line.message)
  assert.ok(messages.includes('路由请求'))
  assert.ok(messages.includes('路由响应'))
  assert.ok(logger.lines.some((line) => line.level === 'warn' && line.message === '非法入参'))
  const serialized = JSON.stringify(logger.lines)
  assert.ok(!serialized.includes('sk-'), '日志不得出现密钥')
})

test('service 抛异常时返回 500 信封，不泄漏堆栈', async () => {
  const { service } = fakeService({ list: () => { throw new Error('boom at /secret/path') } })
  const routes = buildRoutes({ service, logger: loggerSpy() })
  const { res, payload } = await invoke(routeByName(routes, 'list'), fakeReq({ url: '/note-taker/list' }))

  assert.equal(res.statusCode, 500)
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'E_LLM')
})

test('响应头是 JSON，body 是信封', async () => {
  const { service } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })
  const { res } = await invoke(routeByName(routes, 'health'), fakeReq({ url: '/note-taker/health' }))

  assert.match(res.headers['content-type'], /application\/json/)
  assert.equal(typeof JSON.parse(res.body).ok, 'boolean')
})

test('import：缺 path 被拒，正常路径透传', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  const bad = await invoke(routeByName(routes, 'import'), fakeReq({ method: 'POST', url: '/note-taker/import', body: {} }))
  assert.equal(bad.payload.ok, false)
  assert.equal(bad.payload.detail.field, 'path')
  assert.equal(calls.length, 0)

  const okResult = await invoke(routeByName(routes, 'import'), fakeReq({
    method: 'POST', url: '/note-taker/import', body: { path: 'D:\\会议\\a.m4a', label: '导入' },
  }))
  assert.equal(okResult.payload.ok, true)
  assert.deepEqual(calls[0], ['importAudio', { fromPath: 'D:\\会议\\a.m4a', label: '导入' }])
})

test('label：改名透传并校验 id', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  const bad = await invoke(routeByName(routes, 'label'), fakeReq({ method: 'POST', url: '/note-taker/label', body: { id: '../x', label: 'a' } }))
  assert.equal(bad.payload.ok, false)
  assert.equal(calls.length, 0)

  await invoke(routeByName(routes, 'label'), fakeReq({ method: 'POST', url: '/note-taker/label', body: { id: 'm-1', label: '周会' } }))
  assert.deepEqual(calls[0], ['renameMeeting', { meetingId: 'm-1', label: '周会' }])
})
