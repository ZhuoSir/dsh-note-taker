import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BUNDLE = join(ROOT, 'lib', 'client.js')

/**
 * 假 React：够组件函数跑完一次渲染即可。
 * stateOverrides 按 useState 的调用序号注入初值——用来模拟「列表里已经有会议」，
 * 这正是「原始对象 vs 派生视图混用」那类崩溃的现场。
 */
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

/** 从产物里取出注册到某个插槽的组件 */
function loadComponent(slotName, react) {
  const code = readFileSync(BUNDLE, 'utf8')
  let entry = null
  new Function('window', code)({ __ModuleLoader__: { load: (value) => { entry = value } } })
  assert.ok(entry, '产物必须注册到 __ModuleLoader__')

  const module = entry.factory((id) => {
    if (id === 'react') return react
    if (id === 'react-dom') return {}
    return {}
  })

  const registered = []
  const slots = {
    register: (definition, component) => {
      registered.push({ definition, component })
      return { definition, component }
    },
    inject: (name, factory) => {
      const produced = factory(() => {})
      if (produced && typeof produced[Symbol.iterator] === 'function') {
        // 生成器形态：yield 出来的是 register 的返回值
        for (const item of produced) void item
      }
      return () => {}
    },
  }

  module.apply({ slots })
  const hit = registered.find((item) => item.definition?.name === slotName)
  assert.ok(hit, `未注册到插槽 ${slotName}`)
  return hit.component
}

const RAW_MEETING = {
  id: '20261110-1434-1014',
  label: '云端 E2E',
  startedAt: '2026-11-10T14:34:10+08:00',
  durationSec: 2826,
  engine: 'cloud',
  // 注意：原始对象是 status.record，不是 record（派生视图才有）
  status: { record: 'done', transcribe: 'done', minutes: 'pending' },
  stats: { segments: 551, chars: 15613 },
  audio: { path: 'D:/data/recordings/a.m4a' },
  errors: {},
}

test('会记页面：列表非空时不崩（原始对象/派生视图混用回归）', () => {
  const react = makeReact({ 0: [RAW_MEETING] })
  const MeetingPage = loadComponent('settings.section', react)

  react.reset()
  const tree = MeetingPage()
  assert.ok(tree, '组件应返回渲染树')
  assert.equal(tree.type, 'div')
})

test('会记页面：有进行中任务时轮询分支不崩', () => {
  const running = { ...RAW_MEETING, status: { record: 'done', transcribe: 'running', minutes: 'pending' } }
  const react = makeReact({ 0: [running] })
  const MeetingPage = loadComponent('settings.section', react)

  react.reset()
  assert.doesNotThrow(() => MeetingPage())
})

test('会记页面：录音中时计时分支不崩', () => {
  const recording = { ...RAW_MEETING, status: { record: 'running', transcribe: 'pending', minutes: 'pending' } }
  const react = makeReact({ 0: [recording] })
  const MeetingPage = loadComponent('settings.section', react)

  react.reset()
  assert.doesNotThrow(() => MeetingPage())
})

test('快捷面板：列表非空时不崩', () => {
  const react = makeReact({ 1: [RAW_MEETING] })
  const QuickPanel = loadComponent('conversation.input.right', react)

  react.reset()
  assert.doesNotThrow(() => QuickPanel())
})

test('空列表：两个组件都能渲染空态', () => {
  const react = makeReact()

  const MeetingPage = loadComponent('settings.section', react)
  react.reset()
  assert.doesNotThrow(() => MeetingPage())

  const QuickPanel = loadComponent('conversation.input.right', react)
  react.reset()
  assert.doesNotThrow(() => QuickPanel())
})
