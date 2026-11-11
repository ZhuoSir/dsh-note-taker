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
      readConfig: () => { calls.push(['readConfig']); return { ok: true, config: { cloud: { apiKey: 'sk-…5678' } } } },
      saveConfig: (args) => { calls.push(['saveConfig', args]); return { ok: true, saved: ['cloud.apiKey'], ignored: [], restartRequired: [] } },
    },
  }
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value },
    end(body) { this.body = body },
  }
}

async function invoke(route, req) {
  const res = fakeRes()
  await route.handler(req, res)
  return { res, payload: res.body ? JSON.parse(res.body) : null }
}

const configRoute = (routes) => routes.find((item) => item.path === '/note-taker/config')

test('10 条 exact 路由，含 config 与 label', () => {
  const { service } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  assert.equal(routes.length, 10)
  assert.ok(configRoute(routes))
  assert.ok(routes.every((item) => item.kind === 'exact'))
})

test('GET /config 走 readConfig', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })
  const { payload } = await invoke(configRoute(routes), { method: 'GET', url: '/note-taker/config' })

  assert.equal(payload.ok, true)
  assert.deepEqual(calls[0], ['readConfig'])
})

test('POST /config 透传 patch', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })
  const { payload } = await invoke(configRoute(routes), {
    method: 'POST',
    url: '/note-taker/config',
    body: { asr: { engine: 'cloud' }, cloud: { apiKey: 'sk-real-abcdefgh' } },
  })

  assert.equal(payload.ok, true)
  assert.equal(calls[0][0], 'saveConfig')
  assert.deepEqual(calls[0][1].patch, { asr: { engine: 'cloud' }, cloud: { apiKey: 'sk-real-abcdefgh' } })
})

test('日志里不出现 Key 值，只记字段名', async () => {
  const logger = loggerSpy()
  const { service } = fakeService()
  const routes = buildRoutes({ service, logger })

  await invoke(configRoute(routes), {
    method: 'POST',
    url: '/note-taker/config',
    body: { cloud: { apiKey: 'sk-super-secret-value-9999', endpoint: 'https://x.example/v1' } },
  })

  const serialized = JSON.stringify(logger.lines)
  assert.doesNotMatch(serialized, /sk-super-secret-value-9999/, '日志绝不能出现完整 Key')
  assert.match(serialized, /cloud\.apiKey|cloud\(apiKey|saveConfig/)
})

test('POST /config 的 body 非法 JSON 返回信封', async () => {
  const { service, calls } = fakeService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  // 用可迭代的流模拟非法 JSON
  const req = { method: 'POST', url: '/note-taker/config', async *[Symbol.asyncIterator]() { yield Buffer.from('{ not json') } }
  const { payload } = await invoke(configRoute(routes), req)

  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'E_STATE')
  assert.equal(calls.length, 0, '非法 body 不应调用 service')
})

test('service 返回校验错误时透出字段名', async () => {
  const routes = buildRoutes({
    service: {
      readConfig: () => ({ ok: true }),
      saveConfig: () => ({ ok: false, code: 'E_STATE', message: '分片秒数必须是 10–3600 的整数', detail: { field: 'asr.chunkSeconds' } }),
    },
    logger: loggerSpy(),
  })

  const { payload } = await invoke(configRoute(routes), {
    method: 'POST', url: '/note-taker/config', body: { asr: { chunkSeconds: 0 } },
  })
  assert.equal(payload.ok, false)
  assert.equal(payload.detail.field, 'asr.chunkSeconds')
})
