import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import {
  DEFAULT_SETTINGS,
  ENV_KEYS,
  createSettingsSource,
  isMasked,
  maskKey,
  mergeSettings,
  readSettingsFile,
  saveSettings,
  settingsPath,
  validatePatch,
  writeSettingsFile,
} from '../lib/settings.js'

const roots = []
after(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }) })

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'note-taker-settings-'))
  roots.push(dir)
  return dir
}

test('Key 掩码：留头尾，太短全遮', () => {
  assert.equal(maskKey('sk-1234567890abcdef'), 'sk-…cdef')
  assert.equal(maskKey('abcdefgh'), 'abc…defgh'.replace('defgh', 'efgh'))
  assert.equal(maskKey('short'), '•••••')
  assert.equal(maskKey(''), '')
  assert.equal(maskKey(null), '')
})

test('掩码判定：含省略号或全点都算「未修改」', () => {
  assert.equal(isMasked('sk-…cdef'), true)
  assert.equal(isMasked('••••'), true)
  assert.equal(isMasked('sk-realkey123456'), false)
})

test('优先级：文件 > 环境变量 > 默认', () => {
  const merged = mergeSettings({
    file: { asr: { engine: 'cloud' }, cloud: { apiKey: 'sk-file' } },
    env: { [ENV_KEYS.engine]: 'local', [ENV_KEYS.apiKey]: 'sk-env', [ENV_KEYS.localModel]: 'tiny' },
  })

  assert.equal(merged.settings.asr.engine, 'cloud', '文件优先于环境变量')
  assert.equal(merged.settings.cloud.apiKey, 'sk-file')
  assert.equal(merged.settings.asr.localModel, 'tiny', '文件没有的用环境变量')
  assert.equal(merged.sources.engine, 'file')
  assert.equal(merged.sources.localModel, 'env')
  assert.equal(merged.sources.cloudModel, 'default')
})

test('空文件时全部走环境变量与默认', () => {
  const merged = mergeSettings({ file: {}, env: {} })
  assert.deepEqual(merged.settings.asr, DEFAULT_SETTINGS.asr)
  assert.equal(merged.settings.cloud.apiKey, null)
  assert.ok(merged.settings.cloud.endpoint.startsWith('https://'))
})

test('校验：分片秒数越界与非法枚举都被拒并指名字段', () => {
  const bad = validatePatch({ asr: { chunkSeconds: 0, engine: 'magic', localModel: 'huge' } })
  assert.equal(bad.ok, false)
  const fields = bad.errors.map((item) => item.field)
  assert.ok(fields.includes('asr.chunkSeconds'))
  assert.ok(fields.includes('asr.engine'))
  assert.ok(fields.includes('asr.localModel'))

  const good = validatePatch({ asr: { chunkSeconds: 120, engine: 'cloud', localModel: 'base' } })
  assert.equal(good.ok, true)
  assert.deepEqual(good.patch.asr, { chunkSeconds: 120, engine: 'cloud', localModel: 'base' })
})

test('校验：endpoint 必须是 http(s)，Key 空串被拒但 null 允许', () => {
  assert.equal(validatePatch({ cloud: { endpoint: 'file:///etc/passwd' } }).ok, false)
  assert.equal(validatePatch({ cloud: { endpoint: 'ftp://x/y' } }).ok, false)
  assert.equal(validatePatch({ cloud: { endpoint: 'https://ok.example/v1' } }).ok, true)

  assert.equal(validatePatch({ cloud: { apiKey: '' } }).ok, false)
  assert.equal(validatePatch({ cloud: { apiKey: null } }).ok, true)
})

test('校验：掩码回显视为未修改', () => {
  const result = validatePatch({ cloud: { apiKey: maskKey('sk-realkey-12345678') } })
  assert.equal(result.ok, true)
  assert.equal(result.patch.cloud, undefined, '掩码不应被当作新 Key')
})

test('校验：未知键进 ignored', () => {
  const result = validatePatch({ asr: { engine: 'local' }, hacker: true, cloud: { evil: 1 } })
  assert.equal(result.ok, true)
  assert.deepEqual(result.ignored, ['hacker'])
})

test('保存：写入文件、回读一致、保存项清单正确', async () => {
  const root = tempRoot()
  const saved = await saveSettings({ root, patch: { asr: { engine: 'cloud', chunkSeconds: 120 }, cloud: { model: 'm1' } } })

  assert.equal(saved.ok, true)
  assert.deepEqual(saved.saved.sort(), ['asr.chunkSeconds', 'asr.engine', 'cloud.model'])
  assert.deepEqual(saved.restartRequired, [])

  const file = JSON.parse(readFileSync(settingsPath(root), 'utf8'))
  assert.equal(file.asr.engine, 'cloud')
  assert.equal(file.asr.chunkSeconds, 120)
  assert.equal(file.cloud.model, 'm1')
  assert.equal(file.version, 1)
})

test('保存：非法值不落盘', async () => {
  const root = tempRoot()
  const result = await saveSettings({ root, patch: { asr: { chunkSeconds: 3 } } })

  assert.equal(result.ok, false)
  assert.match(result.message, /10–3600/)
  const read = await readSettingsFile(root)
  assert.deepEqual(read.file, {}, '不合法时不应创建配置')
})

test('保存：保存掩码不会覆盖真实 Key', async () => {
  const root = tempRoot()
  await saveSettings({ root, patch: { cloud: { apiKey: 'sk-real-key-98765432' } } })
  await saveSettings({ root, patch: { cloud: { apiKey: maskKey('sk-real-key-98765432'), model: 'm2' } } })

  const file = JSON.parse(readFileSync(settingsPath(root), 'utf8'))
  assert.equal(file.cloud.apiKey, 'sk-real-key-98765432', '掩码不得覆盖真 Key')
  assert.equal(file.cloud.model, 'm2')
})

test('保存：改数据目录进 restartRequired，且校验目录可访问', async () => {
  const root = tempRoot()
  const target = tempRoot()

  const okResult = await saveSettings({ root, patch: { dataRoot: target } })
  assert.equal(okResult.ok, true)
  assert.deepEqual(okResult.restartRequired, ['dataRoot'])

  const badResult = await saveSettings({ root, patch: { dataRoot: join(target, '不存在', 'x') } })
  assert.equal(badResult.ok, false)
  assert.equal(badResult.errors[0].field, 'dataRoot')
})

test('配置文件损坏时不抛错，按空配置处理', async () => {
  const root = tempRoot()
  writeFileSync(settingsPath(root), '{ 这不是 JSON', 'utf8')

  const read = await readSettingsFile(root)
  assert.deepEqual(read.file, {})
  assert.match(read.warning, /读取失败/)

  const source = await createSettingsSource({ root, env: { [ENV_KEYS.apiKey]: 'sk-env' } })
  assert.equal(source.get(ENV_KEYS.apiKey), 'sk-env', '损坏时应回落到环境变量')
})

test('原子写：不留临时文件', async () => {
  const root = tempRoot()
  await writeSettingsFile(root, { ...DEFAULT_SETTINGS, asr: { ...DEFAULT_SETTINGS.asr, engine: 'cloud' } })
  const { readdirSync } = await import('node:fs')
  const files = readdirSync(root)
  assert.deepEqual(files, ['config.json'])
})

test('配置来源：页面配置覆盖环境变量，缺省回落', async () => {
  const root = tempRoot()
  await saveSettings({ root, patch: { cloud: { apiKey: 'sk-file-key', model: 'file-model' }, asr: { engine: 'cloud' } } })

  const source = await createSettingsSource({
    root,
    env: { [ENV_KEYS.apiKey]: 'sk-env', [ENV_KEYS.engine]: 'local', [ENV_KEYS.localModel]: 'tiny' },
  })

  assert.equal(source.get(ENV_KEYS.apiKey), 'sk-file-key')
  assert.equal(source.get(ENV_KEYS.cloudModel), 'file-model')
  assert.equal(source.get(ENV_KEYS.engine), 'cloud')
  assert.equal(source.get(ENV_KEYS.localModel), 'tiny', '环境变量给的要生效')
  assert.equal(source.get(ENV_KEYS.dataRoot), null, '默认值不冒充显式配置')
  assert.equal(source.get('NOTE_TAKER_ASR_TERMS'), null)
})
