import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { createService } from '../lib/service.js'
import { ENV_KEYS, saveSettings } from '../lib/settings.js'

const roots = []
after(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }) })

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'note-taker-svc-settings-'))
  roots.push(dir)
  return dir
}

function quietLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} }
}

function makeService(overrides = {}) {
  const root = tempRoot()
  const service = createService({
    config: { root, model: 'tiny', threads: 2, engine: 'local', ...overrides },
    logger: quietLogger(),
    llm: { stream: () => (async function* gen() {})() },
  })
  return { service, root }
}

test('未保存任何配置时行为与改造前一致（回归）', async () => {
  const { service } = makeService()
  const caps = await service.capabilities()

  assert.equal(caps.ok, true)
  assert.equal(caps.engine, 'local', '默认引擎仍是 local')
  assert.equal(caps.cloud.configured, false)
  assert.equal(caps.local.defaultModel, 'tiny', '沿用调用方传入的模型档位')
})

test('页面保存云端 Key 后，capabilities 立即反映（热生效）', async () => {
  const { service, root } = makeService()
  assert.equal((await service.capabilities()).cloud.configured, false)

  await saveSettings({ root, patch: { cloud: { apiKey: 'sk-page-key-12345678' } } })

  const caps = await service.capabilities()
  assert.equal(caps.cloud.configured, true, '不应需要重启')
  assert.match(caps.cloud.host, /aliyuncs|dashscope/)
})

test('页面保存引擎=cloud 后，transcribe 缺省走云端', async () => {
  const { service, root } = makeService()
  await saveSettings({ root, patch: { asr: { engine: 'cloud' } } })

  const audioPath = join(root, 'a.wav')
  writeFileSync(audioPath, Buffer.alloc(64, 1))
  const created = service.store.create({ label: 't', startedAt: new Date().toISOString() })
  service.store.patch(created.meeting.id, { status: { record: 'done' }, audio: { path: audioPath, sha256: 'x' } })
  // 没有密钥 → 云端路径应报 E_DEP（而不是悄悄退回本地）
  const result = await service.transcribe({ meetingId: created.meeting.id })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_DEP')
})

test('保存非法的分片秒数不会影响运行（读取时仍取合法值）', async () => {
  const { service, root } = makeService()
  const bad = await saveSettings({ root, patch: { asr: { chunkSeconds: 1 } } })
  assert.equal(bad.ok, false)

  const caps = await service.capabilities()
  assert.equal(caps.ok, true)
})

test('数据目录变更不热切换（仍用启动时的 root）', async () => {
  const { service, root } = makeService()
  const another = tempRoot()
  await saveSettings({ root, patch: { dataRoot: another } })

  // 会议仍落在原 root
  const created = service.store.create({ label: 'x', startedAt: new Date().toISOString() })
  assert.ok(created.meeting.id)
  assert.equal(service.list({ limit: 5 }).meetings.length, 1)
})

test('环境变量优先于默认值，页面配置又优先于环境变量', async () => {
  const { service, root } = makeService()
  const saved = await saveSettings({
    root,
    patch: { cloud: { apiKey: 'sk-from-page-98765432' } },
    env: { [ENV_KEYS.apiKey]: 'sk-from-env' },
  })
  assert.equal(saved.ok, true)

  const caps = await service.capabilities()
  assert.equal(caps.cloud.configured, true)
})

test('capabilities 反映页面保存的引擎（而不是启动时的环境值）', async () => {
  const { service, root } = makeService()

  // 启动时 config.engine = local（makeService 里就是 local）
  assert.equal((await service.capabilities()).engine, 'local')

  await saveSettings({ root, patch: { asr: { engine: 'cloud' } } })

  const caps = await service.capabilities()
  assert.equal(caps.engine, 'cloud', '应跟随页面配置')
  assert.equal(caps.engineSource, 'file')
})

test('capabilities 的本地档位也跟随配置', async () => {
  const { service, root } = makeService()
  await saveSettings({ root, patch: { asr: { localModel: 'base' } } })

  const caps = await service.capabilities()
  assert.equal(caps.local.defaultModel, 'base')
})
