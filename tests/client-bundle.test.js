import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BUNDLE = join(ROOT, 'lib', 'client.js')

/** 载入产物并返回 __ModuleLoader__ 收到的条目（不依赖浏览器） */
function loadBundle() {
  const code = readFileSync(BUNDLE, 'utf8')
  let entry = null
  const window = { __ModuleLoader__: { load: (value) => { entry = value } } }

  // 产物用 window.__ModuleLoader__.load 注册自己，这里用 Function 模拟那个全局
  // eslint-disable-next-line no-new-func
  new Function('window', code)(window)
  assert.ok(entry, '产物必须调用 window.__ModuleLoader__.load 注册自己')
  return entry
}

function fakeRequire(id) {
  if (id === 'react') {
    return {
      default: { createElement: () => null, Fragment: 'Fragment' },
      createElement: () => null,
      useState: (initial) => [initial, () => {}],
    }
  }
  if (id === 'react-dom') return { default: {}, createRoot: () => ({ render: () => {} }) }
  throw new Error(`未预期的 require: ${id}`)
}

test('产物按宿主格式注册：id 正确、factory 可执行、导出 apply/inject', () => {
  const entry = loadBundle()
  assert.equal(entry.id, 'dsh-note-taker')
  assert.equal(typeof entry.factory, 'function')

  const mod = entry.factory(fakeRequire)
  assert.equal(typeof mod.apply, 'function')
  assert.deepEqual(mod.inject, ['slots'])
  assert.equal(mod.name, 'dsh-note-taker')
})

test('apply 注册两个插槽，且不抛异常', () => {
  const entry = loadBundle()
  const mod = entry.factory(fakeRequire)
  const registrations = []

  mod.apply({
    slots: {
      inject: (slotName, factory) => {
        // 页面侧注入是「给生成器」或「直接返回注册函数」两种形态，这里两种都接住
        const produced = factory(() => {})
        if (produced && typeof produced[Symbol.iterator] === 'function') {
          for (const item of produced) registrations.push({ slotName, registration: item })
        } else if (produced !== undefined) {
          registrations.push({ slotName, registration: produced })
        }
        return () => {}
      },
      register: (definition) => definition,
    },
  })

  assert.ok(registrations.length >= 2, `应注册两个插槽，实际 ${registrations.length}`)
})

test('插槽注册失败时不把异常抛给宿主', () => {
  const entry = loadBundle()
  const mod = entry.factory(fakeRequire)

  assert.doesNotThrow(() => {
    mod.apply({
      slots: {
        inject: () => { throw new Error('插槽不可用') },
        register: () => { throw new Error('不该走到这里') },
      },
    })
  })
})

test('apply 会触发宿主能力探测（否则面板永远显示「尚未探测」）', () => {
  const entry = loadBundle()
  const mod = entry.factory(fakeRequire)

  let injected = []
  let probes = 0
  mod.apply({
    slots: { inject: () => () => {}, register: (definition) => definition },
    inject: (deps, callback) => { injected = deps; probes += 1; void callback },
  })

  assert.ok(injected.includes('sessions'), '必须尝试注入 sessions（会话作用域发送的前提）')
  assert.equal(probes, 1)
})
