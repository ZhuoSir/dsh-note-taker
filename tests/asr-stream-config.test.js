import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ENV,
  STREAM_DEFAULTS,
  STREAM_ENV,
  createEnvSource,
  deriveStreamEndpoint,
  resolveStreamConfig,
} from '../lib/asr/config.js'

function loggerSpy() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, warn: push('warn'), error: push('error'), info: push('info'), debug: push('debug') }
}

test('未做任何配置：流式关闭且不可用（不改变既有行为）', () => {
  const result = resolveStreamConfig({ source: createEnvSource({}) })

  assert.equal(result.ok, true)
  assert.equal(result.config.enabled, false)
  assert.equal(result.config.available, false)
  assert.equal(result.config.reason, 'missing_key')
  assert.equal(result.config.apiKey, null)
})

test('只配了 Key：可用但未启用', () => {
  const result = resolveStreamConfig({ source: createEnvSource({ [ENV.apiKey]: 'sk-test' }) })

  assert.equal(result.config.enabled, false)
  assert.equal(result.config.available, true)
  assert.equal(result.config.reason, null)
})

test('Key + 启用开关：enabled=true，模型走默认 qwen3-asr-flash-realtime', () => {
  const result = resolveStreamConfig({
    source: createEnvSource({ [ENV.apiKey]: 'sk-test', [STREAM_ENV.enabled]: '1' }),
  })

  assert.equal(result.config.enabled, true)
  assert.equal(result.config.available, true)
  assert.equal(result.config.model, 'qwen3-asr-flash-realtime')
  assert.equal(result.config.sampleRate, 16000)
  assert.equal(result.config.frameBytes, 3200)
})

test('启用了但缺 Key：给 missing_key 原因并告警，不抛错', () => {
  const logger = loggerSpy()
  const result = resolveStreamConfig({ source: createEnvSource({ [STREAM_ENV.enabled]: 'true' }), logger })

  assert.equal(result.ok, true)
  assert.equal(result.config.enabled, true)
  assert.equal(result.config.available, false)
  assert.equal(result.config.reason, 'missing_key')
  assert.ok(logger.lines.some((line) => line.message === '流式已启用但缺少密钥'))
})

test('端点缺省由 HTTP 端点 host 推导为 wss://<host>/api-ws/v1/realtime', () => {
  const result = resolveStreamConfig({
    source: createEnvSource({
      [ENV.apiKey]: 'sk-test',
      [ENV.endpoint]: 'https://llm-abc.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    }),
  })

  assert.equal(result.config.endpoint, 'wss://llm-abc.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime')
})

test('显式流式端点优先于推导', () => {
  const result = resolveStreamConfig({
    source: createEnvSource({
      [ENV.apiKey]: 'sk-test',
      [ENV.endpoint]: 'https://llm-abc.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      [STREAM_ENV.endpoint]: 'ws://127.0.0.1:9876/api-ws/v1/realtime',
    }),
  })

  assert.equal(result.config.endpoint, 'ws://127.0.0.1:9876/api-ws/v1/realtime')
})

test('环境变量覆盖模型名；source 名称如实回报', () => {
  const result = resolveStreamConfig({
    source: createEnvSource({ [ENV.apiKey]: 'sk', [STREAM_ENV.model]: 'qwen3-asr-flash-realtime-v2' }),
  })

  assert.equal(result.config.model, 'qwen3-asr-flash-realtime-v2')
  assert.equal(result.config.sourceName, 'env')
})

test('模型名非法（空白或含空格/斜杠/中文）→ E_STATE 并指名字段 streamModel', () => {
  for (const bad of ['  ', 'a b', 'foo/bar', '模型']) {
    const result = resolveStreamConfig({ source: createEnvSource({ [ENV.apiKey]: 'sk', [STREAM_ENV.model]: bad }) })
    assert.equal(result.ok, false, `模型名 ${JSON.stringify(bad)} 应被拒`)
    assert.equal(result.code, 'E_STATE')
    assert.equal(result.detail.field, 'streamModel')
  }
})

test('空字符串等同未设置（环境变量语义）→ 回落默认模型', () => {
  const result = resolveStreamConfig({ source: createEnvSource({ [ENV.apiKey]: 'sk', [STREAM_ENV.model]: '' }) })

  assert.equal(result.ok, true)
  assert.equal(result.config.model, 'qwen3-asr-flash-realtime')
})

test('端点不是 ws/wss → E_STATE 并指名字段 streamUrl', () => {
  const result = resolveStreamConfig({
    source: createEnvSource({ [ENV.apiKey]: 'sk', [STREAM_ENV.endpoint]: 'https://example.com/ws' }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_STATE')
  assert.equal(result.detail.field, 'streamUrl')
})

test('deriveStreamEndpoint：非法 URL 回落内置默认，不抛错', () => {
  assert.equal(deriveStreamEndpoint('not-a-url'), STREAM_DEFAULTS.endpoint)
  assert.equal(deriveStreamEndpoint(undefined), STREAM_DEFAULTS.endpoint)
  assert.equal(deriveStreamEndpoint('https://dashscope.aliyuncs.com/x'), 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime')
})

test('overrides 优先于 source（页面配置可直接注入）', () => {
  const result = resolveStreamConfig({
    source: createEnvSource({ [ENV.apiKey]: 'sk-env', [STREAM_ENV.enabled]: '0' }),
    overrides: { enabled: 'true', model: 'qwen3-asr-flash-realtime' },
  })

  assert.equal(result.config.enabled, true)
  assert.equal(result.config.model, 'qwen3-asr-flash-realtime')
  assert.equal(result.config.apiKey, 'sk-env')
})