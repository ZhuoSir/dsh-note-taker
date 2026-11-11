import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createApi } from '../src/client/api.js'

function fakeFetch({ status = 200, body = { ok: true }, throws } = {}) {
  const calls = []
  const impl = async (url, options = {}) => {
    calls.push({ url, options })
    if (throws) throw throws
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }
  }
  impl.calls = calls
  return impl
}

test('列表：路径与查询串拼接正确', async () => {
  const fetchImpl = fakeFetch()
  const api = createApi({ fetchImpl })
  await api.list({ limit: 5 })

  assert.equal(fetchImpl.calls[0].url, '/note-taker/list?limit=5')
  assert.equal(fetchImpl.calls[0].options.method, 'GET')
})

test('详情：id 被正确编码，缺省参数不进查询串', async () => {
  const fetchImpl = fakeFetch()
  const api = createApi({ fetchImpl })
  await api.detail({ id: 'a b/c' })
  assert.equal(fetchImpl.calls[0].url, '/note-taker/detail?id=a%20b%2Fc')

  await api.list({})
  assert.equal(fetchImpl.calls[1].url, '/note-taker/list')
})

test('POST 动作带 JSON body', async () => {
  const fetchImpl = fakeFetch()
  const api = createApi({ fetchImpl })
  await api.record({ action: 'start', label: '周会' })

  const call = fetchImpl.calls[0]
  assert.equal(call.url, '/note-taker/record')
  assert.equal(call.options.method, 'POST')
  assert.deepEqual(JSON.parse(call.options.body), { action: 'start', label: '周会' })
})

test('非 200：按服务端错误码返回信封', async () => {
  const fetchImpl = fakeFetch({ status: 500, body: { ok: false, code: 'E_LLM', message: '云端失败' } })
  const api = createApi({ fetchImpl })
  const result = await api.detail({ id: 'x' })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_LLM')
  assert.equal(result.detail.httpStatus, 500)
})

test('401 映射为 E_DEP', async () => {
  const fetchImpl = fakeFetch({ status: 401, body: {} })
  const api = createApi({ fetchImpl })
  const result = await api.health()
  assert.equal(result.code, 'E_DEP')
})

test('响应非 JSON 不抛异常', async () => {
  const fetchImpl = fakeFetch({ status: 200, body: '<html>oops</html>' })
  const api = createApi({ fetchImpl })
  const result = await api.list({})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_LLM')
  assert.match(result.message, /不是 JSON/)
})

test('网络异常与超时都收敛成信封', async () => {
  const api = createApi({ fetchImpl: fakeFetch({ throws: new Error('ECONNRESET') }) })
  const failed = await api.health()
  assert.equal(failed.code, 'E_LLM')
  assert.match(failed.message, /网络请求失败/)

  const abort = new Error('aborted')
  abort.name = 'AbortError'
  const timeoutApi = createApi({ fetchImpl: fakeFetch({ throws: abort }), timeoutMs: 50 })
  const timedOut = await timeoutApi.health()
  assert.match(timedOut.message, /超时/)
})

test('云端动作：未确认则不发请求', async () => {
  const fetchImpl = fakeFetch()
  const api = createApi({ fetchImpl, confirmCloud: async () => false })
  const result = await api.transcribe({ id: 'm-1', engine: 'cloud' })

  assert.equal(result.ok, false)
  assert.equal(result.detail.cancelled, true)
  assert.equal(fetchImpl.calls.length, 0, '未确认时绝不能发请求')
})

test('云端动作：确认后才发请求', async () => {
  const fetchImpl = fakeFetch()
  const api = createApi({ fetchImpl, confirmCloud: async () => true })
  const result = await api.transcribe({ id: 'm-1', engine: 'cloud' })

  assert.equal(result.ok, true)
  assert.equal(fetchImpl.calls.length, 1)
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), { id: 'm-1', engine: 'cloud' })
})

test('本地动作不需要确认', async () => {
  const fetchImpl = fakeFetch()
  const api = createApi({ fetchImpl, confirmCloud: async () => { throw new Error('不该被调用') } })
  const result = await api.transcribe({ id: 'm-1', engine: 'local' })

  assert.equal(result.ok, true)
  assert.equal(fetchImpl.calls.length, 1)
})

test('sessionId 只在该传的地方出现', async () => {
  const fetchImpl = fakeFetch()
  const api = createApi({ fetchImpl, confirmCloud: async () => true })

  await api.transcribe({ id: 'm-1', engine: 'cloud', sessionId: 'sess-1' })
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), { id: 'm-1', engine: 'cloud', sessionId: 'sess-1' })

  await api.detail({ id: 'm-1', sessionId: 'sess-1' })
  assert.match(fetchImpl.calls[1].url, /sessionId=sess-1/)

  await api.transcribe({ id: 'm-1', engine: 'local' })
  const body = JSON.parse(fetchImpl.calls[2].options.body)
  assert.ok(!('sessionId' in body) || body.sessionId === undefined, '不传时不应出现 sessionId')
})
