/**
 * 会话输入框旁的会记卡片（conversation.input.right）。
 *
 * 流程（R-03/R-05/R-06/R-07）：
 *   开始录音 → 停止 → 按配置的引擎自动识别 → 转写进可编辑确认区 → 确认后交给会话
 *
 * 「交给会话」主路径用宿主 conversation.send（探针已确认 inject 可用），
 * 拿不到时降级为复制到剪贴板并说明原因，不假装发送成功。
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createApi } from './api.js'
import { buildHandoffMessage } from './handoff.js'
import { copyText, hostStatusText, sendToSession } from './host.js'
import { capabilitiesFrom, errorText, formatDateTime, formatDuration } from './logic.js'
import { theme } from './theme.js'

const POLL_MS = 2000
const TRANSCRIBE_TIMEOUT_MS = 15 * 60 * 1000

const styles = {
  root: { position: 'relative', display: 'inline-block' },
  trigger: (active) => ({
    padding: '4px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
    border: `1px solid ${active ? theme.accentBorder : theme.border}`,
    background: active ? theme.accentBg : 'transparent', color: theme.text,
  }),
  panel: {
    position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 40, width: 380,
    padding: 12, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8,
    border: `1px solid ${theme.border}`, fontSize: 12,
    background: theme.bg, color: theme.text, fontFamily: theme.font,
    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
  },
  row: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  btn: { padding: '5px 10px', borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
  btnPrimary: { padding: '5px 10px', borderRadius: 8, border: `1px solid ${theme.accentBorder}`, background: theme.accentBg, color: theme.text, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
  muted: { color: theme.textMuted, fontSize: 11 },
  error: { color: theme.danger, fontSize: 11 },
  ok: { color: theme.success, fontSize: 11 },
  textarea: {
    width: '100%', boxSizing: 'border-box', minHeight: 120, maxHeight: 240, resize: 'vertical',
    padding: 8, borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent',
    color: theme.text, fontFamily: theme.mono, fontSize: 11, lineHeight: 1.5,
  },
}

const PHASE_TEXT = {
  starting: '启动录音…',
  stopping: '收尾录音…',
  transcribing: '识别中…',
  sending: '发送中…',
  sent: '已发送',
  error: '出错',
}

export function QuickPanel({ sessionId } = {}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [current, setCurrent] = useState(null)
  const [transcript, setTranscript] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [labelDraft, setLabelDraft] = useState('')
  const [refreshError, setRefreshError] = useState(null)
  const rootRef = useRef(null)

  const api = useMemo(() => createApi({
    confirmCloud: (text) => (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : false),
  }), [])
  const caps = useMemo(() => capabilitiesFrom(health), [health])

  const refresh = useCallback(async () => {
    const [listResult, healthResult] = await Promise.all([api.list({ limit: 3 }), api.health()])
    if (listResult.ok === false) {
      // 刷新失败是「后台拉列表」的问题，不能显示成「识别失败」误导用户
      setRefreshError(`刷新失败：${errorText(listResult.code, listResult.detail)}`)
      return
    }
    setRefreshError(null)
    setRows(listResult.meetings ?? [])
    setHealth(healthResult.ok === false ? null : healthResult)
  }, [api])

  useEffect(() => {
    if (!open) return undefined
    refresh()
    const timer = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) refresh() }, POLL_MS * 2)
    return () => clearInterval(timer)
  }, [open, refresh])

  // 点面板外部收起
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false) }
    if (typeof document !== 'undefined') document.addEventListener('mousedown', onDown)
    return () => { if (typeof document !== 'undefined') document.removeEventListener('mousedown', onDown) }
  }, [open])

  // 录音计时
  useEffect(() => {
    if (phase !== 'recording') { setSeconds(0); return undefined }
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [phase])

  // 识别计时
  useEffect(() => {
    if (phase !== 'transcribing') { setElapsed(0); return undefined }
    const startedAt = Date.now()
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [phase])

  const startRecord = useCallback(async () => {
    setError(null); setNotice(null); setPhase('starting')
    const result = await api.record({ action: 'start' })
    if (result.ok === false) { setPhase('error'); setError(errorText(result.code, result.detail)); return }
    setCurrent({ meetingId: result.meetingId, label: '', durationSec: null })
    setPhase('recording')
  }, [api])

  const runTranscribe = useCallback(async (meetingId, durationSec) => {
    setPhase('transcribing')
    setTranscript('')

    // 先取配置里的引擎，显式传下去（云端会触发二次确认）
    const config = await api.getConfig()
    const engine = config.ok === false ? undefined : config.config?.asr?.engine
    const accepted = await api.transcribe({ id: meetingId, engine })
    if (accepted.ok === false) {
      setPhase('error')
      setError(errorText(accepted.code, accepted.detail))
      if (accepted.message) setNotice(accepted.message)
      return
    }

    const deadline = Date.now() + TRANSCRIBE_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      const detail = await api.detail({ id: meetingId })
      if (detail.ok === false) { setPhase('error'); setError(errorText(detail.code, detail.detail)); return }

      const status = detail.meeting?.status?.transcribe
      if (status === 'done') {
        const label = detail.meeting?.label ?? ''
        setCurrent({ meetingId, label, startedAt: detail.meeting?.startedAt, durationSec: detail.meeting?.durationSec ?? durationSec })
        setLabelDraft(label)
        setTranscript(detail.transcript ?? '')
        setPhase('confirm')
        refresh()
        return
      }
      if (status === 'failed') {
        setPhase('error')
        setError(detail.meeting?.errors?.transcribe ?? '识别失败')
        return
      }
    }
    setPhase('error')
    setError('识别超时，请稍后在设置页查看状态')
  }, [api, refresh])

  const stopRecord = useCallback(async () => {
    setPhase('stopping')
    const result = await api.record({ action: 'stop' })
    if (result.ok === false) { setPhase('error'); setError(errorText(result.code, result.detail)); return }
    await runTranscribe(result.meetingId, result.durationSec)
  }, [api, runTranscribe])

  const handoff = useCallback(async () => {
    if (!current?.meetingId) return
    const built = buildHandoffMessage({
      meetingId: current.meetingId,
      label: current.label,
      durationSec: current.durationSec,
      transcript,
    })
    if (built.ok === false) { setPhase('error'); setError(built.reason); return }

    setPhase('sending')
    const sent = await sendToSession({ sessionId, text: built.text })
    if (sent.ok) {
      setPhase('sent')
      setNotice(`已发送到会话（${built.mode === 'summary' ? '摘要模式' : '全文'}，${built.chars} 字）`)
      return
    }
    setError(`无法自动发送：${sent.reason}`)

    // 兜底：复制到剪贴板，并说明真实情况
    const copied = await copyText(built.text)
    setPhase('sent')
    setNotice(copied.ok
      ? '宿主不支持自动发送，文本已复制到剪贴板，请粘贴到输入框发送'
      : `无法发送也无法复制（${copied.reason}），请手动重试`)
  }, [current, transcript, sessionId])

  const saveLabel = useCallback(async () => {
    if (!current?.meetingId) return
    const next = labelDraft.trim()
    if (next === (current.label ?? '')) return
    const result = await api.rename({ id: current.meetingId, label: next })
    if (result.ok === false) { setError(errorText(result.code, result.detail)); return }
    setCurrent((prev) => ({ ...prev, label: next }))
    setError(null)
  }, [api, current, labelDraft])

  const reset = useCallback(() => {
    setPhase('idle'); setCurrent(null); setTranscript(''); setLabelDraft(''); setError(null); setNotice(null)
  }, [])

  const recording = phase === 'recording'
  const busy = ['starting', 'stopping', 'transcribing', 'sending'].includes(phase)

  return createElement('div', { ref: rootRef, style: styles.root },
    createElement('button', {
      type: 'button', style: styles.trigger(open || recording), title: '会记',
      onClick: () => setOpen((value) => !value),
    }, recording ? `● ${formatDuration(seconds)}` : '会记'),

    open ? createElement('div', { style: styles.panel },
      createElement('div', { style: styles.row },
        createElement('strong', null, '会记'),
        createElement('span', { style: styles.muted }, caps.cloudReady ? `云端可用${caps.cloudModel ? `·${caps.cloudModel}` : ''}` : '云端未配置'),
      ),

      error ? createElement('div', { style: styles.error }, error) : null,
      refreshError ? createElement('div', { style: styles.muted }, refreshError) : null,
      notice ? createElement('div', { style: styles.ok }, notice) : null,

      createElement('div', { style: styles.row },
        recording
          ? createElement('button', { type: 'button', style: styles.btn, onClick: stopRecord }, `停止并识别 ${formatDuration(seconds)}`)
          : createElement('button', {
              type: 'button',
              style: (busy || !caps.recordingReady) ? { ...styles.btn, opacity: 0.5 } : styles.btn,
              disabled: busy || !caps.recordingReady,
              title: caps.recordingReady ? '' : '录音依赖不可用',
              onClick: startRecord,
            }, '开始录音'),
        createElement('button', { type: 'button', style: busy ? { ...styles.btn, opacity: 0.5 } : styles.btn, onClick: refresh, disabled: busy }, '刷新'),
      ),

      PHASE_TEXT[phase]
        ? createElement('div', { style: styles.muted }, phase === 'transcribing' ? `识别中… 已等待 ${formatDuration(elapsed)}` : PHASE_TEXT[phase])
        : null,

      // 当前这场会议：名字可编辑；未命名时以开始时间占位
      current?.meetingId
        ? createElement('div', { style: styles.row },
            createElement('input', {
              key: 'label',
              type: 'text',
              style: { ...styles.btn, flex: 1, minWidth: 0, cursor: 'text', textAlign: 'left' },
              value: labelDraft,
              placeholder: current.startedAt ? formatDateTime(current.startedAt) : '未命名（按时间显示）',
              maxLength: 60,
              title: '点这里改会议名，失焦即保存',
              onChange: (event) => setLabelDraft(event.target.value),
              onBlur: saveLabel,
              onKeyDown: (event) => { if (event.key === 'Enter') event.currentTarget.blur() },
            }),
            createElement('span', { style: styles.muted }, formatDuration(current.durationSec)),
          )
        : null,

      // 确认区：识别完成后出现，可编辑
      phase === 'confirm' || phase === 'sending' || phase === 'sent'
        ? createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            createElement('div', { style: styles.muted }, `识别结果（可改错字）· ${transcript.length} 字`),
            createElement('textarea', {
              style: styles.textarea, value: transcript,
              onChange: (event) => setTranscript(event.target.value),
              disabled: phase === 'sending',
            }),
            createElement('div', { style: styles.row },
              createElement('button', {
                type: 'button',
                style: phase === 'sent' ? { ...styles.btnPrimary, opacity: 0.5 } : styles.btnPrimary,
                disabled: phase === 'sending' || phase === 'sent' || transcript.trim() === '',
                onClick: handoff,
              }, phase === 'sending' ? '发送中…' : phase === 'sent' ? '已发送' : '交给会话生成纪要'),
              createElement('button', { type: 'button', style: styles.btn, onClick: reset }, '重新录'),
            ),
          )
        : null,

      phase === 'error' && current?.meetingId
        ? createElement('div', { style: styles.row },
            createElement('button', { type: 'button', style: styles.btn, onClick: () => runTranscribe(current.meetingId, current.durationSec) }, '重试识别'),
            createElement('button', { type: 'button', style: styles.btn, onClick: reset }, '放弃'),
          )
        : null,

      createElement('div', { style: styles.muted }, '全部会议在 设置 → 会记'),
      createElement('div', { style: { ...styles.muted, fontSize: 10 } }, hostStatusText()),
    ) : null,
  )
}

export default QuickPanel
