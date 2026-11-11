import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildRequestBody, recognizeWithHttp } from '../lib/asr/http.js'

function loggerSpy() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') }
}

const BASE_CONFIG = {
  apiKey: 'sk-test-key',
  endpoint: 'https://example.com/api/v1/services/aigc/multimodal-generation/generation',
  model: 'qwen-audio-3.0-asr-flash',
  sampleRate: 16000,
  requestTimeoutMs: 5000,
}

const OK_BODY = {
  request_id: 'req-1',
  sentence: {
    sentence_id: 1,
    begin_time: 200,
    end_time: 11640,
    text: '周会开始，今天讨论灰度范围。',
    sentence_end: true,
  },
  usage: { duration: 12 },
}

function fakeFetch({ status = 200, body = OK_BODY, throws } = {}) {
  const calls = []
  const impl = async (url, options) => {
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

const AUDIO = Buffer.from('RIFF....fake-wav-bytes....')

test('请求体与官方示例逐字段对齐', () => {
  const body = buildRequestBody({ model: 'qwen-audio-3.0-asr-flash', audioBase64: 'AAAA', format: 'wav', sampleRate: 16000 })

  assert.equal(body.model, 'qwen-audio-3.0-asr-flash')
  assert.equal(body.input.messages.length, 1)
  assert.equal(body.input.messages[0].role, 'user')
  const [audioPart] = body.input.messages[0].content
  assert.equal(audioPart.type, 'input_audio')
  assert.equal(audioPart.input_audio.data, 'data:audio/wav;base64,AAAA')
  assert.deepEqual(body.parameters, { format: 'wav', sample_rate: '16000' })
})

test('配置了术语时插入 input_text 上下文，且排在音频之前', () => {
  const body = buildRequestBody({ model: 'm', audioBase64: 'AA', terms: ['XXX', '康养'] })
  const content = body.input.messages[0].content

  assert.equal(content.length, 2)
  assert.equal(content[0].type, 'input_text')
  assert.match(content[0].text, /XXX/)
  assert.equal(content[1].type, 'input_audio')
})

test('200 正常返回：ok + payload，日志含请求与完成', async () => {
  const logger = loggerSpy()
  const fetchImpl = fakeFetch()
  const result = await recognizeWithHttp({ config: BASE_CONFIG, audio: AUDIO, logger, fetchImpl, runId: 'm-1' })

  assert.equal(result.ok, true)
  assert.equal(result.payload.sentence.text, '周会开始，今天讨论灰度范围。')
  assert.equal(fetchImpl.calls.length, 1)
  const headers = fetchImpl.calls[0].options.headers
  assert.equal(headers.Authorization, 'Bearer sk-test-key')
  assert.equal(headers['X-DashScope-SSE'], 'disable')

  const messages = logger.lines.map((line) => line.message)
  assert.ok(messages.includes('云端识别请求'))
  assert.ok(messages.includes('云端识别完成'))
  assert.ok(!JSON.stringify(logger.lines).includes('sk-test-key'), '日志不得含密钥')
})

test('401 → E_DEP（配置问题）', async () => {
  const result = await recognizeWithHttp({
    config: BASE_CONFIG,
    audio: AUDIO,
    logger: loggerSpy(),
    fetchImpl: fakeFetch({ status: 401, body: { message: 'Invalid API-key provided.' } }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_DEP')
  assert.equal(result.detail.httpStatus, 401)
})

test('429 → E_LLM（限流）', async () => {
  const result = await recognizeWithHttp({
    config: BASE_CONFIG,
    audio: AUDIO,
    logger: loggerSpy(),
    fetchImpl: fakeFetch({ status: 429, body: { message: 'Throttling' } }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_LLM')
  assert.match(result.message, /限流/)
})

test('500 → E_LLM 并带上服务端消息', async () => {
  const result = await recognizeWithHttp({
    config: BASE_CONFIG,
    audio: AUDIO,
    logger: loggerSpy(),
    fetchImpl: fakeFetch({ status: 500, body: { message: 'internal error' } }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_LLM')
  assert.equal(result.detail.serverMessage, 'internal error')
})

test('请求超时（AbortError）→ E_LLM', async () => {
  const abort = new Error('aborted')
  abort.name = 'AbortError'
  const result = await recognizeWithHttp({
    config: BASE_CONFIG,
    audio: AUDIO,
    logger: loggerSpy(),
    fetchImpl: fakeFetch({ throws: abort }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_LLM')
  assert.match(result.message, /超时/)
})

test('网络异常 → E_LLM', async () => {
  const result = await recognizeWithHttp({
    config: BASE_CONFIG,
    audio: AUDIO,
    logger: loggerSpy(),
    fetchImpl: fakeFetch({ throws: new Error('ECONNRESET') }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_LLM')
  assert.match(result.message, /网络请求失败/)
})

test('空音频 → E_AUDIO，不发请求', async () => {
  const fetchImpl = fakeFetch()
  const result = await recognizeWithHttp({ config: BASE_CONFIG, audio: Buffer.alloc(0), logger: loggerSpy(), fetchImpl })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_AUDIO')
  assert.equal(fetchImpl.calls.length, 0)
})

test('非 JSON 响应不抛错，按错误处理', async () => {
  const result = await recognizeWithHttp({
    config: BASE_CONFIG,
    audio: AUDIO,
    logger: loggerSpy(),
    fetchImpl: fakeFetch({ status: 502, body: '<html>bad gateway</html>' }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_LLM')
})

test('开启说话人分离时透传 speaker_diarization_enabled', () => {
  const on = buildRequestBody({ model: 'qwen-audio-3.1-asr-flash', audioBase64: 'AA', diarization: true })
  assert.equal(on.parameters.speaker_diarization_enabled, true)

  const off = buildRequestBody({ model: 'qwen-audio-3.0-asr-flash', audioBase64: 'AA' })
  assert.equal(off.parameters.speaker_diarization_enabled, undefined, '未开启时不得出现该字段')
})

test('config 的 diarization 开关会透传到请求体', async () => {
  const fetchImpl = fakeFetch()
  const result = await recognizeWithHttp({
    config: { ...BASE_CONFIG, model: 'qwen-audio-3.1-asr-flash', diarization: true },
    audio: AUDIO,
    logger: loggerSpy(),
    fetchImpl,
  })
  assert.ok(fetchImpl.calls[0], `未发起请求：${JSON.stringify(result)}`)
  const sent = JSON.parse(fetchImpl.calls[0].options.body)
  assert.equal(sent.parameters.speaker_diarization_enabled, true)
})

test('开启分人时不发送词表上下文（实测 input_text 会让 speaker_id 退化为 -1）', () => {
  const withDiar = buildRequestBody({ model: 'qwen-audio-3.1-asr-flash', audioBase64: 'AA', terms: ['XXX'], diarization: true })
  assert.equal(withDiar.input.messages[0].content.length, 1, '分人开启时不应有 input_text')
  assert.equal(withDiar.input.messages[0].content[0].type, 'input_audio')

  const noDiar = buildRequestBody({ model: 'qwen-audio-3.1-asr-flash', audioBase64: 'AA', terms: ['XXX'] })
  assert.equal(noDiar.input.messages[0].content.length, 2, '分人关闭时保留 input_text')
})
