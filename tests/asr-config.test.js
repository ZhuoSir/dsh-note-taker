import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CLOUD_DEFAULTS, ENV, createEnvSource, parseTerms, resolveCloudAsrConfig, resolveDefaultEngine } from '../lib/asr/config.js'

function loggerSpy() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, warn: push('warn'), error: push('error'), info: push('info'), debug: push('debug') }
}

test('缺密钥返回 E_DEP，并指出需要的环境变量', () => {
  const logger = loggerSpy()
  const result = resolveCloudAsrConfig({ source: createEnvSource({}), logger })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_DEP')
  assert.equal(result.detail.env, ENV.apiKey)
  assert.ok(result.message.includes(ENV.apiKey))
  assert.ok(logger.lines.some((line) => line.message === '密钥缺失，云端 ASR 不可用'))
})

test('缺省值：非实时 HTTP 端点 + 实测可用的模型名', () => {
  const result = resolveCloudAsrConfig({ source: createEnvSource({ [ENV.apiKey]: 'sk' }) })

  assert.equal(result.config.model, 'qwen-audio-3.0-asr-flash')
  assert.match(result.config.endpoint, /\/api\/v1\/services\/aigc\/multimodal-generation\/generation$/)
  assert.equal(result.config.chunkSeconds, 300)
  assert.equal(result.config.sampleRate, 16000)
  assert.deepEqual(result.config.terms, [])
})

test('全量环境变量覆盖后解析正确', () => {
  const result = resolveCloudAsrConfig({
    source: createEnvSource({
      [ENV.apiKey]: 'sk-test',
      [ENV.model]: 'qwen-audio-3.1-asr-flash',
      [ENV.endpoint]: 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      [ENV.chunkSeconds]: '120',
      [ENV.terms]: 'XXX, 康养 ,社区食堂',
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.config.model, 'qwen-audio-3.1-asr-flash')
  assert.match(result.config.endpoint, /maas\.aliyuncs\.com/)
  assert.equal(result.config.chunkSeconds, 120)
  assert.deepEqual(result.config.terms, ['XXX', '康养', '社区食堂'])
})

test('非法分片时长回退默认', () => {
  const tooSmall = resolveCloudAsrConfig({ source: createEnvSource({ [ENV.apiKey]: 'sk', [ENV.chunkSeconds]: '3' }) })
  assert.equal(tooSmall.config.chunkSeconds, CLOUD_DEFAULTS.chunkSeconds)

  const nan = resolveCloudAsrConfig({ source: createEnvSource({ [ENV.apiKey]: 'sk', [ENV.chunkSeconds]: 'abc' }) })
  assert.equal(nan.config.chunkSeconds, CLOUD_DEFAULTS.chunkSeconds)
})

test('术语超过上限截断并告警', () => {
  const logger = loggerSpy()
  const many = Array.from({ length: 210 }, (_, index) => `词${index}`).join(',')
  const terms = parseTerms(many, { maxTerms: 200, logger })

  assert.equal(terms.total, 210)
  assert.equal(terms.kept, 200)
  assert.equal(terms.truncated, true)
  assert.ok(logger.lines.some((line) => line.level === 'warn' && line.message === '术语超限截断'))
})

test('配置来源可替换（页面配置的最小证明）', () => {
  const pageSource = {
    name: 'page',
    store: { [ENV.apiKey]: 'sk-page', [ENV.model]: 'custom-model' },
    get(key) {
      return this.store[key] ?? null
    },
  }
  const result = resolveCloudAsrConfig({ source: pageSource })

  assert.equal(result.config.apiKey, 'sk-page')
  assert.equal(result.config.model, 'custom-model')
  assert.equal(result.config.sourceName, 'page')
})

test('缺省引擎为 local，可被环境变量覆盖为 cloud', () => {
  assert.equal(resolveDefaultEngine({ source: createEnvSource({}) }), 'local')
  assert.equal(resolveDefaultEngine({ source: createEnvSource({ [ENV.engine]: 'cloud' }) }), 'cloud')
  assert.equal(resolveDefaultEngine({ source: createEnvSource({ [ENV.engine]: 'CLOUD' }) }), 'cloud')
  assert.equal(resolveDefaultEngine({ source: createEnvSource({ [ENV.engine]: 'whatever' }) }), 'local')
})
