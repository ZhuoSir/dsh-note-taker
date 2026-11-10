import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'

import { resolveConfig } from '../lib/index.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const roots = []
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

function freshDataRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'note-taker-index-'))
  roots.push(dir)
  return dir
}

/** 在子进程里跑 apply()：既能拿到注册结果，也能看到真实 stdout 日志 */
function bootPlugin(dataRoot) {
  const code = [
    "import('./lib/index.js')",
    '.then((m) => {',
    '  const registered = []',
    '  const result = m.apply({ tools: { register: (tool) => registered.push(tool.name) }, llm: { stream() {} } })',
    '  console.log("__RESULT__" + JSON.stringify({ ok: result.ok, names: registered.sort() }))',
    '})',
  ].join('\n')

  return execFileSync(process.execPath, ['-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NOTE_TAKER_DATA: dataRoot, PYTHONUTF8: '1' },
  })
}

test('resolveConfig 默认值', () => {
  const config = resolveConfig({})
  assert.match(config.rootSource, /^default:/)
  assert.equal(config.model, 'small')
  assert.equal(config.threads, 6)
  assert.equal(config.llmProvider, null)
})

test('resolveConfig 支持全部环境变量覆盖', () => {
  const config = resolveConfig({
    NOTE_TAKER_DATA: 'D:\\tmp\\custom',
    NOTE_TAKER_MODEL: 'medium',
    NOTE_TAKER_THREADS: '4',
    NOTE_TAKER_LLM_PROVIDER: 'deepseek',
    NOTE_TAKER_LLM_MODEL: 'deepseek-chat',
  })

  assert.equal(config.root, 'D:\\tmp\\custom')
  assert.equal(config.rootSource, 'env:NOTE_TAKER_DATA')
  assert.equal(config.model, 'medium')
  assert.equal(config.threads, 4)
  assert.equal(config.llmProvider, 'deepseek')
  assert.equal(config.llmModel, 'deepseek-chat')
})

test('apply 注册六个工具并返回成功', () => {
  const output = bootPlugin(freshDataRoot())
  const line = output.split('\n').find((item) => item.startsWith('__RESULT__'))

  assert.ok(line, `子进程未输出结果行：${output.slice(0, 400)}`)
  const result = JSON.parse(line.slice('__RESULT__'.length))
  assert.equal(result.ok, true)
  assert.equal(result.names.length, 6)
})

test('apply 打出「插件启动」与「配置加载」两条日志，工具数为 6', () => {
  const output = bootPlugin(freshDataRoot())

  assert.match(output, /插件启动.*name=dsh-note-taker.*tools=6/)
  assert.match(output, /配置加载.*model=small.*threads=6/)
})

test('apply 会创建数据目录骨架', () => {
  const root = freshDataRoot()
  bootPlugin(root)

  const entries = readdirSync(root).sort()
  assert.ok(entries.includes('recordings'), `缺 recordings：${entries.join(',')}`)
  assert.ok(entries.includes('transcripts'))
  assert.ok(entries.includes('minutes'))
})

test('数据根不可写时 apply 返回失败但不抛异常', () => {
  const output = bootPlugin('Q:\\definitely-missing\\dir')
  const line = output.split('\n').find((item) => item.startsWith('__RESULT__'))

  assert.ok(line, '子进程应正常结束并输出结果')
  assert.equal(JSON.parse(line.slice('__RESULT__'.length)).ok, false)
  assert.match(output, /数据根不可写/)
})

test('宿主有 webServer 时通过可选注入注册九条路由', () => {
  const dataRoot = freshDataRoot()
  const code = [
    "import('./lib/index.js')",
    '.then((m) => {',
    '  const routes = []',
    '  const ctx = { tools: { register() {} }, llm: {}, inject(deps, cb) { cb({ webServer: { register: (r) => routes.push(r.path) } }) } }',
    '  const result = m.apply(ctx)',
    '  console.log("__ROUTES__" + JSON.stringify({ ok: result.ok, routes: routes.sort() }))',
    '})',
  ].join('\n')

  const out = execFileSync(process.execPath, ['-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NOTE_TAKER_DATA: dataRoot, PYTHONUTF8: '1' },
  })
  const line = out.split('\n').find((item) => item.startsWith('__ROUTES__'))
  const result = JSON.parse(line.replace('__ROUTES__', ''))

  assert.equal(result.ok, true)
  assert.equal(result.routes.length, 9)
  assert.ok(result.routes.includes('/note-taker/health'))
  assert.ok(result.routes.includes('/note-taker/import'))
})

test('宿主没有注入能力时不抛异常，插件仍启动', () => {
  const dataRoot = freshDataRoot()
  const code = [
    "import('./lib/index.js')",
    '.then((m) => {',
    '  const result = m.apply({ tools: { register() {} }, llm: {} })',
    '  console.log("__OK__" + JSON.stringify({ ok: result.ok }))',
    '})',
  ].join('\n')

  const out = execFileSync(process.execPath, ['-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NOTE_TAKER_DATA: dataRoot, PYTHONUTF8: '1' },
  })
  assert.match(out, /__OK__\{"ok":true\}/)
})
