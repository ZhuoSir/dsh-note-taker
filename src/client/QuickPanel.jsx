/**
 * 会话输入框旁的会记快捷面板（conversation.input.right 插槽）。
 *
 * 只做三件事：录音起停（带计时）、看最近 3 场状态、提示去设置区看全部（R-05）。
 * 面板不遮挡输入框：点击外部或再次点按钮收起。
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createApi } from './api.js'
import { capabilitiesFrom, errorText, formatDuration, toListRows } from './logic.js'
import { theme } from './theme.js'
import { hostStatusText } from './host.js'

const POLL_MS = 2000

const styles = {
  root: { position: 'relative', display: 'inline-block' },
  trigger: (active) => ({
    padding: '4px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
    border: `1px solid ${active ? theme.accentBorder : theme.border}`,
    background: active ? theme.accentBg : 'transparent', color: theme.text,
  }),
  panel: {
    position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 40, width: 320,
    padding: 12, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8,
    border: `1px solid ${theme.border}`, fontSize: 12,
    background: theme.bg, color: theme.text, fontFamily: theme.font,
    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
  },
  row: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  btn: { padding: '4px 10px', borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
  muted: { color: theme.textMuted },
  error: { color: theme.danger },
}

export function QuickPanel() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)
  const [seconds, setSeconds] = useState(0)
  const rootRef = useRef(null)

  const api = useMemo(() => createApi({
    confirmCloud: (text) => (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : false),
  }), [])
  const caps = useMemo(() => capabilitiesFrom(health), [health])
  // 用派生视图：原始 meeting 是 status.record，派生后才是 record
  const listRows = useMemo(() => toListRows(rows, { limit: 3 }), [rows])

  const refresh = useCallback(async () => {
    const [listResult, healthResult] = await Promise.all([api.list({ limit: 3 }), api.health()])
    if (listResult.ok === false) { setError(errorText(listResult.code, listResult.detail)); return }
    setError(null)
    setRows(listResult.meetings ?? [])
    setHealth(healthResult.ok === false ? null : healthResult)
  }, [api])

  useEffect(() => {
    if (!open) return undefined
    refresh()
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      refresh()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [open, refresh])

  // 点面板外部收起
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    if (typeof document !== 'undefined') document.addEventListener('mousedown', onDown)
    return () => { if (typeof document !== 'undefined') document.removeEventListener('mousedown', onDown) }
  }, [open])

  const recording = listRows.find((row) => row.record.status === 'running')
  useEffect(() => {
    if (!recording) { setSeconds(0); return undefined }
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [recording])

  const act = useCallback(async (fn) => {
    const result = await fn()
    if (result?.ok === false) setError(errorText(result.code, result.detail))
    else setError(null)
    await refresh()
  }, [refresh])

  return createElement('div', { ref: rootRef, style: styles.root },
    createElement('button', {
      type: 'button',
      style: styles.trigger(open),
      title: '会记',
      onClick: () => setOpen((value) => !value),
    }, recording ? `● ${formatDuration(seconds)}` : '会记'),

    open ? createElement('div', { style: styles.panel },
      createElement('div', { style: styles.row },
        createElement('strong', null, '会记'),
        createElement('span', { style: styles.muted }, caps.cloudReady ? '云端可用' : '云端未配置'),
      ),

      error ? createElement('div', { style: styles.error }, error) : null,

      createElement('div', { style: styles.row },
        recording
          ? createElement('button', { type: 'button', style: styles.btn, onClick: () => act(() => api.record({ action: 'stop' })) },
              `停止录音 ${formatDuration(seconds)}`)
          : createElement('button', {
              type: 'button', style: styles.btn,
              disabled: !caps.recordingReady,
              title: caps.recordingReady ? '' : '录音依赖不可用',
              onClick: () => act(() => api.record({ action: 'start' })),
            }, '开始录音'),
        createElement('button', { type: 'button', style: styles.btn, onClick: refresh }, '刷新'),
      ),

      createElement('div', { style: styles.muted }, '最近 3 场'),
      rows.length === 0
        ? createElement('div', { style: styles.muted }, '还没有会议')
        : listRows.map((row) => createElement('div', { key: row.id, style: { ...styles.row, alignItems: 'flex-start' } },
            createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.label),
            createElement('span', { style: styles.muted }, `${row.transcribe.text} · ${row.durationText}`),
          )),

      createElement('div', { style: styles.muted }, '全部会议在 设置 → 会记'),
      createElement('div', { style: { ...styles.muted, fontSize: 11 } }, hostStatusText()),
    ) : null,
  )
}

