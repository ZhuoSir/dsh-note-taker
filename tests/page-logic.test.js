import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CLOUD_CONSENT_TEXT,
  capabilitiesFrom,
  errorText,
  formatDateTime,
  formatDuration,
  needsCloudConsent,
  paginateTranscript,
  statusMeta,
  PANEL_STATE_KEY,
  readPanelOpen,
  toDetailView,
  toListRows,
  triggerView,
  writePanelOpen,
} from '../src/client/logic.js'

const MEETING = {
  id: '20261110-1000-aaaa',
  label: '周会',
  startedAt: '2026-11-10T10:00:00+08:00',
  durationSec: 2826,
  engine: 'cloud',
  status: { record: 'done', transcribe: 'done', minutes: 'pending' },
  stats: { segments: 551, chars: 15613 },
  errors: { transcribe: null, minutes: null },
}

test('状态映射：三种正常态 + 失败态带原因', () => {
  assert.equal(statusMeta(MEETING, 'record').text, '完成')
  assert.equal(statusMeta(MEETING, 'transcribe').tone, 'ok')
  assert.equal(statusMeta(MEETING, 'minutes').text, '待处理')

  const failed = { ...MEETING, status: { ...MEETING.status, transcribe: 'failed' }, errors: { transcribe: '模型不可用' } }
  const meta = statusMeta(failed, 'transcribe')
  assert.equal(meta.text, '失败')
  assert.equal(meta.tone, 'error')
  assert.equal(meta.reason, '模型不可用')
})

test('缺字段时按 pending 处理，不抛错', () => {
  const meta = statusMeta({}, 'transcribe')
  assert.equal(meta.status, 'pending')
  assert.equal(meta.reason, null)
})

test('时长格式化', () => {
  assert.equal(formatDuration(2826), '47:06')
  assert.equal(formatDuration(3661), '1:01:01')
  assert.equal(formatDuration(5), '0:05')
  assert.equal(formatDuration(0), '0:00')
  assert.equal(formatDuration(null), '0:00')
})

test('时间格式化到分钟，非法值显示破折号', () => {
  assert.match(formatDateTime('2026-11-10T10:05:00+08:00'), /^11-10 \d{2}:05$/)
  assert.equal(formatDateTime('not-a-date'), '—')
})

test('列表：倒序 + limit + 派生字段', () => {
  const rows = toListRows([
    { ...MEETING, id: 'b', startedAt: '2026-11-10T12:00:00+08:00', label: '晚' },
    { ...MEETING, id: 'a', startedAt: '2026-11-10T09:00:00+08:00', label: '早' },
    { ...MEETING, id: 'c', startedAt: '2026-11-10T11:00:00+08:00', label: '中' },
  ], { limit: 2 })

  assert.deepEqual(rows.map((row) => row.label), ['晚', '中'])
  assert.equal(rows[0].durationText, '47:06')
  assert.equal(rows[0].engineText, '云端')
  assert.equal(rows[0].segments, 551)
})

test('列表：未命名显示开始时间，本地引擎正常', () => {
  const rows = toListRows([{ ...MEETING, label: '', engine: undefined }])
  assert.match(rows[0].label, /^11-10 \d{2}:\d{2}$/, '未命名应显示时间而不是占位符')
  assert.equal(rows[0].rawLabel, '')
  assert.equal(rows[0].engineText, '本地')
})

test('错误码映射为可读文案', () => {
  assert.match(errorText('E_DEP', { env: 'DASHSCOPE_API_KEY' }), /DASHSCOPE_API_KEY/)
  assert.match(errorText('E_LLM'), /模型或网络调用失败/, '没有服务端消息时用中性文案')
  assert.match(errorText('E_LLM', { message: '接口内部错误：boom', endpoint: '/list' }), /boom（\/list）/, '有服务端消息要原样透出并带接口')
  assert.match(errorText('E_MODEL'), /本地模型不可用/)
  assert.match(errorText('E_AUDIO'), /音频不可读/)
  assert.match(errorText('E_STATE', { message: '当前没有进行中的录音' }), /当前没有进行中的录音/)
  assert.match(errorText('E_UNKNOWN'), /E_UNKNOWN/)
  assert.equal(errorText(undefined), '操作失败')
})

test('云端二次确认只在「选云端且未确认」时触发', () => {
  assert.equal(needsCloudConsent('cloud', false), true)
  assert.equal(needsCloudConsent('cloud', true), false)
  assert.equal(needsCloudConsent('local', false), false)
  assert.match(CLOUD_CONSENT_TEXT, /阿里云百炼/)
})

test('正文分块：超过阈值截断，showAll 全量', () => {
  const text = Array.from({ length: 250 }, (_, index) => `[00:00:${index}] 第${index}句`).join('\n')

  const first = paginateTranscript(text, { chunk: 100 })
  assert.equal(first.lines.length, 100)
  assert.equal(first.truncated, true)
  assert.equal(first.remaining, 150)

  const all = paginateTranscript(text, { chunk: 100, showAll: true })
  assert.equal(all.lines.length, 250)
  assert.equal(all.truncated, false)
})

test('详情视图：缺转写/纪要时给 false 而不是空串', () => {
  const detail = toDetailView({ meeting: MEETING, transcript: '', minutes: null })
  assert.equal(detail.hasTranscript, false)
  assert.equal(detail.hasMinutes, false)
  assert.equal(detail.durationText, '47:06')
  assert.equal(toDetailView(null), null)
})

test('健康检查 → 按钮可用性', () => {
  const caps = capabilitiesFrom({ cloud: { configured: false }, recording: { available: true }, local: { models: ['tiny'] } })
  assert.equal(caps.cloudReady, false)
  assert.equal(caps.recordingReady, true)
  assert.deepEqual(caps.localModels, ['tiny'])
})

test('入口渲染数据：待机灰点、不显示计时', () => {
  assert.deepEqual(triggerView(), {
    tone: 'muted', label: '会记', timing: '', expanded: false, title: '会记', ariaLabel: '会记，打开面板',
  })
  // 非录音时即便有秒数也不显示计时（R-03）
  assert.equal(triggerView({ recording: false, seconds: 42 }).timing, '')
})

test('入口渲染数据：录制中绿点 + 计时 + 状态文字（不只靠颜色）', () => {
  const view = triggerView({ recording: true, seconds: 42 })
  assert.equal(view.tone, 'success')
  assert.equal(view.timing, '0:42')
  assert.equal(view.label, '会记')
  assert.match(view.title, /录制中 0:42/)
  assert.match(view.ariaLabel, /录制中 0:42/)
})

test('入口渲染数据：展开态跟随 open', () => {
  assert.equal(triggerView({ open: true }).expanded, true)
  assert.equal(triggerView({ open: false }).expanded, false)
  // 计时与开合互不影响
  const view = triggerView({ recording: true, seconds: 95, open: true })
  assert.equal(view.timing, '1:35')
  assert.equal(view.expanded, true)
})

// 假存储：既能记录写入，也能模拟抛异常（隐私模式）
function fakeStorage({ fail = false } = {}) {
  const data = new Map()
  return {
    data,
    getItem: (key) => { if (fail) throw new Error('blocked'); return data.has(key) ? data.get(key) : null },
    setItem: (key, value) => { if (fail) throw new Error('quota'); data.set(key, value) },
  }
}

test('卡片记忆：无记忆/无存储时按收起（R-05 不阻塞）', () => {
  assert.equal(readPanelOpen(null), false)
  assert.equal(readPanelOpen(fakeStorage()), false)
  assert.equal(readPanelOpen(fakeStorage({ fail: true })), false, '读抛异常按收起')
})

test('卡片记忆：写入后能读回，键名固定', () => {
  const storage = fakeStorage()
  assert.equal(writePanelOpen(true, storage), true)
  assert.equal(storage.data.get(PANEL_STATE_KEY), '1')
  assert.equal(readPanelOpen(storage), true)

  assert.equal(writePanelOpen(false, storage), true)
  assert.equal(storage.data.get(PANEL_STATE_KEY), '0')
  assert.equal(readPanelOpen(storage), false, '收起态被记住')
})

test('卡片记忆：写失败只是不记忆，不抛异常', () => {
  const storage = fakeStorage({ fail: true })
  assert.equal(writePanelOpen(true, storage), false)
  assert.equal(readPanelOpen(null), false)
})
