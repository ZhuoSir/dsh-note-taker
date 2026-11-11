import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { resolveStreamConfig } from '../lib/asr/config.js'
import { ENV_KEYS, createSettingsSource, mergeSettings, saveSettings, validatePatch } from '../lib/settings.js'

const roots = []
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

function tmpRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'note-taker-settings-stream-'))
  roots.push(dir)
  return dir
}

test('流式字段校验：开关必须是布尔，模型名不能空（R-09）', () => {
  const okPatch = validatePatch({ asr: { stream: { enabled: true, model: 'qwen3-asr-flash-realtime' } } })
  assert.equal(okPatch.ok, true)
  assert.deepEqual(okPatch.patch.asr.stream, { enabled: true, model: 'qwen3-asr-flash-realtime' })

  assert.equal(validatePatch({ asr: { stream: { enabled: 'yes' } } }).ok, false, '字符串开关必须拒绝')
  assert.equal(validatePatch({ asr: { stream: { model: '   ' } } }).ok, false, '空模型名必须拒绝')
  assert.equal(validatePatch({ asr: { stream: 'on' } }).ok, false, '非对象必须拒绝')
})

test('保存：稀疏落盘 asr.stream，且 saved 里列出两项', async () => {
  const root = tmpRoot()
  const result = await saveSettings({ root, patch: { asr: { stream: { enabled: true, model: 'qwen3-asr-flash-realtime' } } } })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(result.saved.sort(), ['asr.stream.enabled', 'asr.stream.model'])

  const written = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))
  assert.deepEqual(written.asr.stream, { enabled: true, model: 'qwen3-asr-flash-realtime' })
  assert.equal(written.cloud, undefined, '没改的段不落盘')
})

test('合并优先级：文件 false 不被环境变量 true 覆盖（R-09 优先级）', () => {
  const file = { asr: { stream: { enabled: false, model: 'file-model' } } }
  const env = { [ENV_KEYS.streamEnabled]: '1', [ENV_KEYS.streamModel]: 'env-model' }
  const { settings, sources } = mergeSettings({ file, env })

  assert.equal(sources.streamEnabled, 'file')
  assert.equal(sources.streamModel, 'file')
  assert.equal(settings.asr.stream.enabled, false)
  assert.equal(settings.asr.stream.model, 'file-model')
})

test('合并：文件没配时用环境变量，""等空值不当成 false', () => {
  const { settings, sources } = mergeSettings({ file: {}, env: { [ENV_KEYS.streamEnabled]: 'true', [ENV_KEYS.streamModel]: 'env-model' } })
  assert.equal(sources.streamEnabled, 'env')
  assert.equal(settings.asr.stream.enabled, true)
  assert.equal(settings.asr.stream.model, 'env-model')

  const empty = mergeSettings({ file: {}, env: {} })
  assert.equal(empty.sources.streamEnabled, 'default')
  assert.equal(empty.settings.asr.stream.enabled, false, '缺省必须是关闭')
})

test('配置来源把开关映射成 NOTE_TAKER_STREAM_*，false 也要显式给 0', async () => {
  const root = tmpRoot()
  await saveSettings({ root, patch: { asr: { stream: { enabled: false } } } })
  const source = await createSettingsSource({ root, env: {} })
  assert.equal(source.get(ENV_KEYS.streamEnabled), '0', '显式关闭不能被当成「没配」')
  assert.equal(source.get(ENV_KEYS.streamModel), null, '模型没配时交给下游缺省')

  await saveSettings({ root, patch: { asr: { stream: { enabled: true } } } })
  const on = await createSettingsSource({ root, env: {} })
  assert.equal(on.get(ENV_KEYS.streamEnabled), '1')
})

test('resolveStreamConfig 吃到页面配置：开启 + 有 Key 即可用（端到端一致性）', async () => {
  const root = tmpRoot()
  await saveSettings({ root, patch: { asr: { stream: { enabled: true, model: 'qwen3-asr-flash-realtime' } } } })
  const source = await createSettingsSource({ root, env: { DASHSCOPE_API_KEY: 'sk-test' } })

  const resolved = resolveStreamConfig({ source })
  assert.equal(resolved.ok, true, JSON.stringify(resolved))
  assert.equal(resolved.config.enabled, true)
  assert.equal(resolved.config.available, true)
  assert.equal(resolved.config.model, 'qwen3-asr-flash-realtime')
})

test('resolveStreamConfig 吃到显式关闭：环境变量开着也不生效（页面优先）', async () => {
  const root = tmpRoot()
  await saveSettings({ root, patch: { asr: { stream: { enabled: false } } } })
  const source = await createSettingsSource({ root, env: { DASHSCOPE_API_KEY: 'sk-test', [ENV_KEYS.streamEnabled]: '1' } })

  const resolved = resolveStreamConfig({ source })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.config.enabled, false)
})