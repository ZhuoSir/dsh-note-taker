import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createApi } from '../src/client/api.js'
import { LIVE_POLL_MS, STREAM_CONSENT_TEXT, liveView, needsStreamConsent, shouldPollLive } from '../src/client/logic.js'
import { theme } from '../src/client/theme.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BUNDLE = join(ROOT, 'lib', 'client.js')

const SNAPSHOT = {
  meetingId: 'm-1',
  state: 'streaming',
  elapsedSec: 65,
  audioSecondsSent: 65,
  chars: 7,
  partial: '正在说…',
  finals: [{ id: 'i1', startSec: 12, endSec: 15, text: '第一句。' }],
  error: null,
  degradedReason: null,
  engine: { stream: true, model: 'qwen3-asr-flash-realtime' },
}

// ---------- 纯逻辑 ----------

test('liveView：定稿强、中间结果弱的语义分开（R-03）', () => {
  const view = liveView(SNAPSHOT)
  assert.equal(view.state, 'streaming')
  assert.equal(view.statusText, '实时识别中')
  assert.equal(view.partial, '正在说…')
  assert.equal(view.finals.length, 1)
  assert.equal(view.finals[0].text, '第一句。')
  assert.equal(view.finals[0].timeText, '0:12')
  assert.equal(view.chars, 7)
  assert.equal(view.elapsedText, '1:05')
})

test('liveView：静默 5 秒才提示「等待语音」（R-02）', () => {
  const quiet = { ...SNAPSHOT, partial: '', finals: [] }
  assert.equal(liveView(quiet, { silenceSec: 4 }).waiting, false)
  assert.equal(liveView(quiet, { silenceSec: 5 }).waiting, true)
  // 有中间结果时不提示等待
  assert.equal(liveView(SNAPSHOT, { silenceSec: 30 }).waiting, false)
})

test('liveView：降级后冻结字幕并给出原因位（R-07）', () => {
  const view = liveView({ ...SNAPSHOT, state: 'degraded', degradedReason: 'reconnect_exceeded', partial: '' })
  assert.equal(view.tone, 'error')
  assert.equal(view.frozen, true)
  assert.equal(view.waiting, false, '降级后不该再提示等待语音')
  assert.equal(view.degradedReason, 'reconnect_exceeded')
})

test('liveView：idle 或空快照不渲染字幕区', () => {
  assert.equal(liveView({ state: 'idle' }), null)
  assert.equal(liveView(null), null)
})

test('轮询策略：只在流式录音且页面可见时拉字幕（R-02/R-08）', () => {
  assert.equal(LIVE_POLL_MS, 500, '轮询间隔必须是 500ms')
  assert.equal(shouldPollLive({ phase: 'recording', streaming: true }), true)
  assert.equal(shouldPollLive({ phase: 'recording', streaming: true, hidden: true }), false, '页面隐藏时暂停')
  assert.equal(shouldPollLive({ phase: 'recording', streaming: false }), false, '非流式不轮询')
  assert.equal(shouldPollLive({ phase: 'confirm', streaming: true }), false, '停录后不再轮询')
})

test('流式确认文案与一次性语义（R-08）', () => {
  assert.match(STREAM_CONSENT_TEXT, /录音期间持续上传音频到阿里云百炼/)
  assert.equal(needsStreamConsent({ streamEnabled: true, acknowledged: false }), true)
  assert.equal(needsStreamConsent({ streamEnabled: true, acknowledged: true }), false)
  assert.equal(needsStreamConsent({ streamEnabled: false, acknowledged: false }), false, '没开流式就不弹')
})

test('api：record 透传 stream/sessionId，live 带 id（R-02/R-09）', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null })
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, data: { state: 'idle' } }) }
  }
  const api = createApi({ fetchImpl })

  await api.record({ action: 'start', label: '周会', stream: true, sessionId: 'sess:1' })
  assert.equal(calls[0].url, '/note-taker/record')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(calls[0].body, { action: 'start', label: '周会', stream: true, sessionId: 'sess:1' })

  await api.live({ id: 'm-1' })
  assert.equal(calls[1].url, '/note-taker/live?id=m-1')
  assert.equal(calls[1].method, 'GET')

  await api.record({ action: 'stop', sessionId: 'sess:1' })
  assert.deepEqual(calls[2].body, { action: 'stop', sessionId: 'sess:1' })
})

// ---------- 渲染 ----------

function makeReact(stateOverrides = {}) {
  let index = 0
  return {
    reset() { index = 0 },
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => {
      const slot = index++
      const value = Object.hasOwn(stateOverrides, slot)
        ? stateOverrides[slot]
        : (typeof initial === 'function' ? initial() : initial)
      return [value, () => {}]
    },
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
    useEffect: () => {},
  }
}

function loadQuickPanel(react) {
  const code = readFileSync(BUNDLE, 'utf8')
  let entry = null
  new Function('window', code)({ __ModuleLoader__: { load: (value) => { entry = value } } })
  const module = entry.factory((id) => (id === 'react' ? react : {}))
  const registered = []
  module.apply({
    slots: {
      register: (definition, component) => { registered.push({ definition, component }); return definition },
      inject: (name, factory) => {
        const produced = factory(() => {})
        if (produced && typeof produced[Symbol.iterator] === 'function') for (const item of produced) void item
        return () => {}
      },
    },
    inject: () => {},
  })
  const hit = registered.find((item) => item.definition?.name === 'conversation.input.right')
  assert.ok(hit, '未注册到插槽 conversation.input.right')
  return hit.component
}

/** 深度遍历假 React 树 */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return }
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

function renderNodes({ live = null, silence = 0, phase = 'recording', health } = {}) {
  const react = makeReact({
    0: true,
    2: health ?? { ok: true, stream: { enabled: true, available: true, model: 'qwen3-asr-flash-realtime' }, recording: { available: true }, cloud: { configured: true } },
    5: phase,
    6: { meetingId: 'm-1', label: '', durationSec: null, streaming: true },
    12: live,
    13: silence,
  })
  const Panel = loadQuickPanel(react)
  react.reset()
  return Panel()
}

function collectText(nodes) {
  const out = []
  walk(nodes, (node) => {
    for (const child of node.children ?? []) if (typeof child === 'string') out.push(child)
  })
  return out.join(' ')
}

test('卡片字幕区：中间结果弱化显示、定稿强显示，字数与时长与快照一致（R-03）', () => {
  const nodes = renderNodes({ live: SNAPSHOT })
  const text = collectText(nodes)
  assert.match(text, /实时识别中/)
  assert.match(text, /1:05 · 7 字/, '已录时长与字数必须与快照一致')
  assert.match(text, /第一句。/)
  assert.match(text, /正在说…/)

  const partialNode = []
  walk(nodes, (node) => {
    for (const child of node.children ?? []) if (child === '正在说…') partialNode.push(node)
  })
  assert.equal(partialNode.length, 1, '中间结果应渲染一次')
  assert.equal(partialNode[0].props.style.color, theme.textMuted, '中间结果必须弱化（灰）')
  assert.equal(partialNode[0].props.style.fontStyle, 'italic')

  const finalNode = []
  walk(nodes, (node) => {
    for (const child of node.children ?? []) if (child === '第一句。') finalNode.push(node)
  })
  assert.equal(finalNode.length, 1)
  assert.equal(finalNode[0].props.style.color, theme.text, '定稿必须是正文色（比中间结果强）')
})

test('卡片字幕区：静默 5 秒显示「等待语音」', () => {
  assert.match(collectText(renderNodes({ live: { ...SNAPSHOT, partial: '', finals: [] }, silence: 6 })), /等待语音/)
  assert.doesNotMatch(collectText(renderNodes({ live: SNAPSHOT, silence: 30 })), /等待语音/)
})

test('卡片字幕区：降级显示提示，且不再更新', () => {
  const text = collectText(renderNodes({ live: { ...SNAPSHOT, state: 'degraded', partial: '' } }))
  assert.match(text, /已降级/)
  assert.match(text, /停录后会改用整段音频识别/)
  assert.match(text, /字幕已停止更新/)
})

test('卡片字幕区：idle 快照不渲染字幕区', () => {
  const text = collectText(renderNodes({ live: { state: 'idle' } }))
  assert.doesNotMatch(text, /实时识别中/)
  assert.doesNotMatch(text, /等待语音/)
  assert.doesNotMatch(text, /字幕/)
})

test('颜色只来自 theme 令牌，不出现裸 CSS 变量或硬编码黑色', () => {
  const source = readFileSync(join(ROOT, 'src', 'client', 'QuickPanel.jsx'), 'utf8')
  assert.doesNotMatch(source, /--dsh-/, '不得直接写宿主 CSS 变量')
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,6}/, '不得硬编码颜色')
  const nodes = renderNodes({ live: SNAPSHOT })
  const allowed = new Set(Object.values(theme).map(String))
  walk(nodes, (node) => {
    const style = node.props?.style
    if (!style || typeof style !== 'object') return
    if (typeof style.color === 'string') {
      assert.ok(allowed.has(style.color), `颜色必须来自 theme 令牌，实际 ${style.color}`)
    }
  })
})