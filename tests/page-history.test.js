/**
 * 会记页面「历史纪要」区（CR-03）。
 *
 * 从 设置 → 会记 搬来；与搬运前的一处刻意差异：**所有会议都列**，
 * 不再只列有纪要的——否则刚录完还没生成纪要的那场会从列表里消失。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BUNDLE = join(ROOT, 'lib', 'client.js')

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
  assert.ok(entry, '产物必须注册到 __ModuleLoader__')
  return entry.factory((id) => (id === 'react' ? react : {})).QuickPanel
}

/**
 * 把函数组件展开成纯数据，才能断言里面真实渲染了什么。
 * （页面里嵌了 HistoryList，不展开的话只能看到一个 [fn]。）
 */
function flatten(node) {
  if (node === null || node === undefined || node === false) return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flatten)
  const { type } = node
  const props = node.props ?? {}
  const childNodes = (node.children ?? []).filter((child) => child !== undefined)
  if (typeof type === 'function') return flatten(type({ ...props, children: childNodes }))
  return {
    type,
    props: Object.fromEntries(Object.entries(props).map(([key, value]) => [
      key,
      typeof value === 'function' ? '[fn]' : value,
    ])),
    children: childNodes.map(flatten),
  }
}

// QuickPanel 的 useState 顺序：0=open 1=rows 2=health … 6=current 7=transcript
function renderPage(overrides) {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  const react = makeReact(overrides)
  const QuickPanel = loadQuickPanel(react)
  react.reset()
  const tree = QuickPanel({ page: true })
  return JSON.stringify(flatten(tree))
}

const WITH_MINUTES = {
  id: '20261110-1744-0019',
  label: '乾坤大厦A区会议',
  startedAt: '2026-11-10T17:44:00+08:00',
  durationSec: 3135,
  engine: 'cloud',
  status: { record: 'done', transcribe: 'done', minutes: 'done' },
  stats: { segments: 551, chars: 15613 },
  hasMinutes: true,
  errors: {},
}

// 用户 2026-11-12 丢的那类：转写有了、纪要还没生成
const TRANSCRIPT_ONLY = {
  id: '20261112-1309-2625',
  label: '',
  startedAt: '2026-11-12T13:09:06+08:00',
  durationSec: 3874.5,
  engine: 'cloud',
  status: { record: 'done', transcribe: 'done', minutes: 'pending' },
  stats: { segments: 639, chars: 24912 },
  errors: {},
}

const INTERRUPTED = {
  id: '20261111-1403-3ea6',
  label: '',
  startedAt: '2026-11-11T14:03:00+08:00',
  durationSec: 42,
  engine: 'local',
  status: { record: 'interrupted', transcribe: 'pending', minutes: 'pending' },
  errors: {},
}

test('页面列出历史会议：有纪要 / 仅转写 都能看到', () => {
  const flat = renderPage({ 1: [WITH_MINUTES, TRANSCRIPT_ONLY] })
  assert.match(flat, /历史纪要（2）/, '区块标题带条数')
  assert.match(flat, /已生成纪要/, '有纪要的标出来')
  assert.match(flat, /仅转写/, '没纪要但转写完成的也要列——这正是会消失的那类')
  assert.match(flat, /乾坤大厦A区会议/)
  assert.match(flat, /点一行看正文/)
})

test('没有纪要的会议不再被过滤掉', () => {
  const flat = renderPage({ 1: [TRANSCRIPT_ONLY] })
  assert.match(flat, /历史纪要（1）/)
  assert.match(flat, /20261112-1309-2625|11-12 13:09/)
})

test('录音中断的会议单独标出', () => {
  const flat = renderPage({ 1: [INTERRUPTED] })
  assert.match(flat, /录音中断/)
})

test('空历史显示引导文案，不崩', () => {
  const flat = renderPage({ 1: [] })
  assert.match(flat, /历史纪要（0）/)
  assert.match(flat, /还没有会议。录一场之后这里会出现。/)
})

test('设置页不再有历史纪要（搬到页面后不留两处）', () => {
  const react = makeReact({ 0: { asr: { engine: 'cloud', localModel: 'small', chunkSeconds: 300 }, cloud: { apiKey: 'sk' }, dataRoot: 'D:/d' } })
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
  const Page = registered.find((item) => item.definition?.name === 'settings.section').component
  react.reset()
  const flat = JSON.stringify(flatten(Page()))
  assert.doesNotMatch(flat, /历史纪要（\d+）/, '设置页不应再有历史列表')
  assert.doesNotMatch(flat, /role":"tab"/, '设置页不再需要标签栏')
  assert.match(flat, /只放配置；录音、历史纪要与生成纪要在侧栏「会记」页面里/)
})