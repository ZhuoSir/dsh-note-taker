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
  toDetailView,
  toListRows,
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
  assert.match(errorText('E_LLM'), /云端识别失败/)
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
