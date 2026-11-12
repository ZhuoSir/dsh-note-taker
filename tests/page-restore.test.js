/**
 * 会记页「上一场会议」恢复（用户反馈：停止录制后切页面，回来内容没了）。
 *
 * 这里用一个极小的 hook 运行时真跑 effect：渲染 → 跑 effect → 放行 Promise → 再渲染，
 * 直到状态稳定。fetch 全部桩掉，只验「回来能不能把刚录完那场捡回来」。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BUNDLE = join(ROOT, 'lib', 'client.js')

const MEETING = {
  id: '20261112-1309-2625',
  label: '',
  startedAt: '2026-11-12T13:09:06+08:00',
  durationSec: 3874.5,
  status: { record: 'done', transcribe: 'done', minutes: 'pending' },
  errors: {},
}

const TRANSCRIPT = '# 转写：20261112-1309-2625\n\n[00:00:00] 这场会讨论交付会话。\n'

/** 极简 hook 运行时：让 effect 真的跑，setState 真的触发重渲染 */
function makeRuntime() {
  const state = []
  const refs = []
  const memos = []
  const callbacks = []
  const effectQueue = []
  const cleanups = []
  let cursor = 0
  let dirty = false

  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => {
      const slot = cursor++
      if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        const value = typeof next === 'function' ? next(state[slot]) : next
        if (Object.is(value, state[slot])) return
        state[slot] = value
        dirty = true
      }
      return [state[slot], set]
    },
    useRef: (value) => {
      const slot = cursor++
      if (!(slot in refs)) refs[slot] = { current: value }
      return refs[slot]
    },
    useMemo: (factory) => {
      const slot = cursor++
      if (!(slot in memos)) memos[slot] = factory()
      return memos[slot]
    },
    useCallback: (fn) => {
      const slot = cursor++
      if (!(slot in callbacks)) callbacks[slot] = fn
      return callbacks[slot]
    },
    useEffect: (fn) => { effectQueue.push(fn) },
  }

  return {
    react,
    resetCursor() { cursor = 0; effectQueue.length = 0 },
    runEffects() {
      const batch = effectQueue.splice(0)
      for (const fn of batch) {
        const cleanup = fn()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
    },
    takeDirty() { const value = dirty; dirty = false; return value },
    dispose() { for (const fn of cleanups.splice(0)) fn() },
  }
}

function loadQuickPanel(react) {
  const code = readFileSync(BUNDLE, 'utf8')
  let entry = null
  new Function('window', code)({ __ModuleLoader__: { load: (value) => { entry = value } } })
  assert.ok(entry, '产物必须注册到 __ModuleLoader__')
  return entry.factory((id) => (id === 'react' ? react : {})).QuickPanel
}

/** 渲染到稳定；每轮放行 Promise，让 async effect 的后续 setState 落地 */
async function renderUntilStable(rt, render, rounds = 12) {
  let flat = ''
  for (let i = 0; i < rounds; i++) {
    rt.resetCursor()
    const tree = render()
    flat = JSON.stringify(tree, (key, value) => (typeof value === 'function' ? '[fn]' : value))
    rt.runEffects()
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (!rt.takeDirty()) return flat
  }
  return flat
}

function stubFetch({ detail }) {
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    const path = String(url).replace(/^.*\/note-taker/, '')
    let payload = { ok: true }
    if (path.startsWith('/record')) payload = { ok: true, running: false }
    else if (path.startsWith('/detail')) payload = detail
    else if (path.startsWith('/health')) payload = { ok: true, cloud: { configured: true }, stream: { enabled: true, available: true }, recording: { available: true }, engine: 'cloud' }
    else if (path.startsWith('/list') || path.startsWith('/meetings')) payload = { ok: true, meetings: [] }
    else if (path.startsWith('/config')) payload = { ok: true, config: { asr: { engine: 'cloud' }, cloud: { apiKey: 'sk' } } }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
  }
  return calls
}

function installStorage(remembered) {
  const store = new Map()
  if (remembered) store.set('dsh.note-taker.last-meeting', JSON.stringify(remembered))
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
    get length() { return store.size },
    key: (i) => [...store.keys()][i] ?? null,
  }
  return store
}

async function withPanel(setup) {
  const rt = makeRuntime()
  try {
    const QuickPanel = loadQuickPanel(rt.react)
    const flat = await renderUntilStable(rt, () => QuickPanel({ page: true }))
    return { flat, rt }
  } finally {
    rt.dispose()
  }
}

test('回到会记页：记住的那场转写会恢复成确认区', async () => {
  installStorage({ meetingId: MEETING.id, at: Date.now() })
  stubFetch({
    detail: {
      ok: true,
      meeting: MEETING,
      transcript: TRANSCRIPT,
      outputPath: 'meetings/20261112-1309-2625.md',
      outputMode: 'workspace',
      workspaceRoot: 'D:/ws',
    },
  })

  const { flat } = await withPanel()
  assert.match(flat, /识别结果（可改错字）/, '应当回到确认区，而不是「空闲 + 开始录音」')
  assert.match(flat, /这场会讨论交付会话/, '刚录完的转写内容要回来')
})

test('记住的会议转写还没完成：给出提示，不硬造内容', async () => {
  installStorage({ meetingId: MEETING.id, at: Date.now() })
  stubFetch({
    detail: {
      ok: true,
      meeting: { ...MEETING, status: { record: 'done', transcribe: 'running', minutes: 'pending' } },
      transcript: null,
    },
  })

  const { flat } = await withPanel()
  assert.doesNotMatch(flat, /识别结果（可改错字）/, '没有转写就不该进确认区')
  assert.match(flat, /还没出转写结果/, '要明确告诉用户去哪找')
})

test('没有记忆时不打扰：停在空闲态', async () => {
  installStorage(null)
  stubFetch({ detail: { ok: true, meeting: MEETING, transcript: TRANSCRIPT } })

  const { flat } = await withPanel()
  assert.doesNotMatch(flat, /识别结果（可改错字）/)
  assert.match(flat, /开始录音/)
})