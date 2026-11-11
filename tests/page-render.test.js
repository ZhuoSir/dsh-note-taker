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

function loadModule(react) {
  const code = readFileSync(BUNDLE, 'utf8')
  let entry = null
  new Function('window', code)({ __ModuleLoader__: { load: (value) => { entry = value } } })
  assert.ok(entry, '产物必须注册到 __ModuleLoader__')
  return entry.factory((id) => (id === 'react' ? react : {}))
}

/** 注册表快照：验证插槽是否按 CR-02 挂对位置 */
function loadRegistry(react) {
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
  return registered
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

test('全局页面：页面模式不渲染入口按钮，内容照常渲染', () => {
  const react = makeReact()
  const { QuickPanel } = loadModule(react)
  react.reset()
  const page = QuickPanel({ page: true })
  const flat = JSON.stringify(page, (key, value) => (typeof value === 'function' ? '[fn]' : value))
  assert.match(flat, /开始录音/, '页面里能开始录音')
  assert.doesNotMatch(flat, /aria-expanded/, '页面模式不再有开合入口按钮')
  assert.match(flat, /"overflowY":"auto"/, '页面自己滚动，不再浮在输入框上')
  assert.doesNotMatch(flat, /"position":"absolute"/, '页面里没有绝对定位的浮层')
})

// QuickPanel 的 useState 顺序（页面/卡片共用）：
// 0=open 1=rows 2=health 3=error 4=notice 5=phase 6=current 7=transcript 8=seconds 9=elapsed
// 10=labelDraft 11=refreshError 12=live 13=liveSilence 14=consent
test('会记页：录音中 / 识别中 / 确认区 三种阶段都能渲染', () => {
  const render = (overrides) => {
    const react = makeReact({ ...overrides })
    const { QuickPanel } = loadModule(react)
    react.reset()
    return JSON.stringify(QuickPanel({ page: true }), (k, v) => (typeof v === 'function' ? '[fn]' : v))
  }

  let flat = render({ 5: 'recording', 8: 42 })
  assert.match(flat, /停止并识别 0:42/, '录制中按钮上带计时')
  // 入口已搬到侧栏（CR-02）：页面里不再有绿点入口按钮，绿色只出现在侧栏图标
  assert.doesNotMatch(flat, /"aria-expanded"/, '页面里没有入口按钮')

  flat = render({ 5: 'transcribing' })
  assert.match(flat, /识别中/)

  flat = render({ 5: 'confirm', 7: '[00:00:00] 周会开始。' })
  assert.match(flat, /交给会话生成纪要/)
  assert.match(flat, /识别结果（可改错字）/)

  flat = render({ 5: 'confirm', 7: '[00:00:00] 周会开始。', 6: { meetingId: 'm-1', label: '', startedAt: '2026-11-10T16:26:00+08:00', durationSec: 42, outputPath: 'meetings/m-1.md', outputMode: 'workspace' } })
  assert.match(flat, /产物：meetings\/m-1\.md（工作区）/, '应显示产物位置')
  assert.doesNotMatch(flat, /最近 3 场/, '最近列表应已移除')
  assert.match(flat, /未命名（按时间显示）|11-10 \d{2}:\d{2}/, '未命名用时间占位')

  flat = render({ 5: 'error', 6: { meetingId: 'm-1' }, 3: '识别失败' })
  assert.match(flat, /重试识别/)
  assert.match(flat, /识别失败/)
})

test('CR-02：入口挂到侧栏与全局页面，不再占用会话输入框', () => {
  const react = makeReact()
  const registered = loadRegistry(react)
  const names = registered.map((item) => item.definition?.name)

  assert.ok(names.includes('sidebar.panellist'), '必须有侧栏入口')
  assert.ok(names.includes('main'), '必须有全局页面')
  assert.equal(names.includes('conversation.input.right'), false, '会话输入框旁不再有入口')

  const panel = registered.find((item) => item.definition?.name === 'sidebar.panellist')
  const main = registered.find((item) => item.definition?.name === 'main')
  assert.equal(panel.definition.id, main.definition.key, '侧栏 id 必须与 main 的 key 一致，否则点图标会抛错')
  assert.equal(panel.definition.order, 30, '排在插件(0)/自动化任务(10)/上下文观察(20)之后')
  assert.equal(panel.definition.label, '会记')
})

test('CR-02：侧栏图标能渲染（空闲态不显示计时）', () => {
  const react = makeReact()
  const { RecordIcon } = loadModule(react)
  react.reset()
  const icon = RecordIcon({ size: 16 })
  const flat = JSON.stringify(icon, (key, value) => (typeof value === 'function' ? '[fn]' : value))
  assert.match(flat, /"viewBox":"0 0 16 16"/, '图标是矢量图，跟随侧栏 size')
  assert.doesNotMatch(flat, /tabular-nums/, '空闲态不显示计时')
})

test('CR-02：会记页面标题栏显示状态与返回入口', () => {
  const react = makeReact()
  const { MeetingPanel } = loadModule(react)
  react.reset()
  const flat = JSON.stringify(MeetingPanel({ close: () => {} }), (key, value) => (typeof value === 'function' ? '[fn]' : value))
  assert.match(flat, /会记/)
  assert.match(flat, /空闲|录制中/)
  assert.match(flat, /返回会话/)
})
