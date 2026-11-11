import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BUNDLE = join(ROOT, 'lib', 'client.js')

/**
 * 假 React：够组件函数跑完一次渲染。
 * stateOverrides 按 useState 的调用序号注入初值——用来模拟「配置已加载」「有历史纪要」等现场。
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

function loadComponent(slotName, react) {
  const code = readFileSync(BUNDLE, 'utf8')
  let entry = null
  new Function('window', code)({ __ModuleLoader__: { load: (value) => { entry = value } } })
  assert.ok(entry, '产物必须注册到 __ModuleLoader__')

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

  const hit = registered.find((item) => item.definition?.name === slotName)
  assert.ok(hit, `未注册到插槽 ${slotName}`)
  return hit.component
}

const CONFIG = {
  asr: { engine: 'cloud', localModel: 'small', chunkSeconds: 300 },
  cloud: { apiKey: 'sk-…cdef', endpoint: 'https://example.com/v1/generation', model: 'qwen-audio-3.1-asr-flash' },
  dataRoot: 'D:/data',
}

const RAW_MEETING = {
  id: '20261110-1434-1014',
  label: '云端 E2E',
  startedAt: '2026-11-10T14:34:10+08:00',
  durationSec: 2826,
  engine: 'cloud',
  status: { record: 'done', transcribe: 'done', minutes: 'done' },
  stats: { segments: 551, chars: 15613 },
  audio: { path: 'D:/data/recordings/a.m4a' },
  errors: {},
}

// SettingsPage 的 useState 顺序：
// 0=form 1=sources 2=fieldErrors 3=error 4=notice 5=saving 6=meetings 7=openedId 8=minutesText 9=showAll

function renderText(Page, react) {
  react.reset() // 每次渲染前重置 hook 序号，否则第二次调用拿不到注入的初值
  return JSON.stringify(Page(), (key, value) => (typeof value === 'function' ? '[fn]' : value))
}

test('配置未加载时显示占位，不崩', () => {
  const react = makeReact()
  const Page = loadComponent('settings.section', react)
  react.reset()
  assert.doesNotThrow(() => Page())
})

test('配置加载后渲染表单：引擎单选、模型下拉、Key 掩码都在', () => {
  const react = makeReact({ 1: CONFIG })
  const Page = loadComponent('settings.section', react)
  react.reset()

  const flat = renderText(Page, react)
  assert.match(flat, /默认引擎/)
  assert.match(flat, /faster-whisper/)
  assert.match(flat, /qwen-audio-3\.1-asr-flash/)
  assert.match(flat, /sk-…cdef/, 'Key 应以掩码回显')
  assert.match(flat, /保存配置/)
})

test('有历史纪要时列表渲染，原始对象不崩（派生视图回归）', () => {
  const react = makeReact({ 0: 'minutes', 1: CONFIG, 7: [RAW_MEETING] })
  const Page = loadComponent('settings.section', react)
  react.reset()

  assert.doesNotThrow(() => Page())
  const flat = renderText(Page, react)
  assert.match(flat, /历史纪要（1）/)
  assert.match(flat, /云端 E2E/)
})

test('没有纪要的会议不出现在列表里', () => {
  const pending = { ...RAW_MEETING, status: { ...RAW_MEETING.status, minutes: 'pending' } }
  const react = makeReact({ 0: 'minutes', 1: CONFIG, 7: [pending] })
  const Page = loadComponent('settings.section', react)
  react.reset()

  const flat = renderText(Page, react)
  assert.match(flat, /历史纪要（0）/)
  assert.match(flat, /还没有纪要/)
})

test('字段错误按位置渲染，不抛异常', () => {
  const react = makeReact({
    1: CONFIG,
    3: { 'asr.chunkSeconds': '分片秒数必须是 10–3600 的整数' },
  })
  const Page = loadComponent('settings.section', react)
  react.reset()

  assert.doesNotThrow(() => Page())
  assert.match(renderText(Page, react), /10–3600/)
})

test('快捷面板：空数据也能渲染', () => {
  const react = makeReact()
  const QuickPanel = loadComponent('conversation.input.right', react)
  react.reset()
  assert.doesNotThrow(() => QuickPanel())
})

test('tab 切换：配置页与历史纪要页互斥渲染', () => {
  const configTab = makeReact({ 0: 'config', 1: CONFIG, 7: [RAW_MEETING] })
  const ConfigPage = loadComponent('settings.section', configTab)
  configTab.reset()
  const configText = JSON.stringify(ConfigPage(), (key, value) => (typeof value === 'function' ? '[fn]' : value))
  assert.match(configText, /默认引擎/)
  assert.doesNotMatch(configText, /云端 E2E/, '配置 tab 不应渲染纪要数据行')

  const minutesTab = makeReact({ 0: 'minutes', 1: CONFIG, 7: [RAW_MEETING] })
  const MinutesPage = loadComponent('settings.section', minutesTab)
  minutesTab.reset()
  const minutesText = JSON.stringify(MinutesPage(), (key, value) => (typeof value === 'function' ? '[fn]' : value))
  assert.match(minutesText, /云端 E2E/)
  assert.doesNotMatch(minutesText, /默认引擎/, '纪要 tab 不应渲染配置表单')
})

// QuickPanel 的 useState 顺序：
// 0=open 1=rows 2=health 3=error 4=notice 5=phase 6=current 7=transcript 8=seconds 9=elapsed

test('卡片：录音中 / 识别中 / 确认区 三种阶段都能渲染', () => {
  const Host = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => {
      const slot = Host.index++
      const overrides = Host.overrides
      const value = Object.hasOwn(overrides, slot) ? overrides[slot] : (typeof initial === 'function' ? initial() : initial)
      return [value, () => {}]
    },
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
    useEffect: () => {},
    index: 0,
    overrides: {},
  }
  const withOverrides = (overrides) => {
    Host.overrides = overrides
    Host.index = 0
    const Panel = loadComponent('conversation.input.right', Host)
    Host.index = 0
    return Panel
  }

  // 面板打开 + 录音中
  let flat = JSON.stringify(withOverrides({ 0: true, 5: 'recording', 8: 42 })(), (k, v) => (typeof v === 'function' ? '[fn]' : v))
  assert.match(flat, /停止并识别/)
  assert.match(flat, /● 0:42/)

  // 识别中
  flat = JSON.stringify(withOverrides({ 0: true, 5: 'transcribing' })(), (k, v) => (typeof v === 'function' ? '[fn]' : v))
  assert.match(flat, /识别中/)

  // 确认区：有转写文本 + 交给会话按钮
  flat = JSON.stringify(withOverrides({ 0: true, 5: 'confirm', 7: '[00:00:00] 周会开始。' })(), (k, v) => (typeof v === 'function' ? '[fn]' : v))
  assert.match(flat, /交给会话生成纪要/)
  assert.match(flat, /识别结果（可改错字）/)

  // 当前会议：名字输入框 + 没有最近列表
  flat = JSON.stringify(withOverrides({ 0: true, 5: 'confirm', 7: '[00:00:00] 周会开始。', 6: { meetingId: 'm-1', label: '', startedAt: '2026-11-10T16:26:00+08:00', durationSec: 42, outputPath: 'meetings/m-1.md', outputMode: 'workspace' } })(), (k, v) => (typeof v === 'function' ? '[fn]' : v))
  assert.match(flat, /产物：meetings\/m-1\.md（工作区）/, '应显示产物位置')
  assert.doesNotMatch(flat, /最近 3 场/, '最近列表应已移除')
  assert.match(flat, /未命名（按时间显示）|11-10 \d{2}:\d{2}/, '未命名用时间占位')

  // 失败态给重试
  flat = JSON.stringify(withOverrides({ 0: true, 5: 'error', 6: { meetingId: 'm-1' }, 3: '识别失败' })(), (k, v) => (typeof v === 'function' ? '[fn]' : v))
  assert.match(flat, /重试识别/)
  assert.match(flat, /识别失败/)
})
