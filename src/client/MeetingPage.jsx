/**
 * 会记页面（settings.section 插槽）—— 列表 + 详情 + 动作 + 轮询。
 *
 * 纪律：
 * - 业务判断都在 ./logic.js，这里只做渲染与事件绑定
 * - 所有网络走 ./api.js（含云端二次确认闸门）
 * - 轮询在页面不可见时暂停，最长 30 分钟（R-06）
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createApi } from './api.js'
import {
  capabilitiesFrom,
  errorText,
  formatDuration,
  paginateTranscript,
  toDetailView,
  toListRows,
} from './logic.js'

const POLL_MS = 2000
const POLL_MAX_MS = 30 * 60 * 1000

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 2px', maxWidth: 980 },
  bar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  card: { border: '1px solid rgba(127,127,127,0.25)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid rgba(127,127,127,0.25)', fontWeight: 600, opacity: 0.75 },
  td: { padding: '6px 8px', borderBottom: '1px solid rgba(127,127,127,0.12)', verticalAlign: 'top' },
  btn: { padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13 },
  btnPrimary: { padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(90,150,255,0.6)', background: 'rgba(90,150,255,0.12)', color: 'inherit', cursor: 'pointer', fontSize: 13 },
  btnDisabled: { opacity: 0.45, cursor: 'not-allowed' },
  input: { padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.35)', background: 'transparent', color: 'inherit', fontSize: 13, minWidth: 220 },
  muted: { fontSize: 12, opacity: 0.65 },
  error: { fontSize: 12, color: '#e5484d' },
  ok: { fontSize: 12, color: '#30a46c' },
  pre: { margin: 0, maxHeight: 320, overflow: 'auto', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Consolas, monospace' },
  detail: { display: 'grid', gridTemplateColumns: '160px 1fr', gap: '4px 12px', fontSize: 13 },
  badge: (tone) => ({
    display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 11,
    border: '1px solid rgba(127,127,127,0.3)',
    color: tone === 'error' ? '#e5484d' : tone === 'ok' ? '#30a46c' : tone === 'active' ? '#5a96ff' : 'inherit',
    borderColor: tone === 'error' ? 'rgba(229,72,77,0.5)' : tone === 'ok' ? 'rgba(48,164,108,0.5)' : tone === 'active' ? 'rgba(90,150,255,0.5)' : 'rgba(127,127,127,0.3)',
  }),
}

function StatusBadge({ meta }) {
  return createElement('span', { style: styles.badge(meta.tone), title: meta.reason ?? '' }, meta.text)
}

export function MeetingPage() {
  const [rows, setRows] = useState([])
  const [health, setHealth] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [importPath, setImportPath] = useState('')
  const consentRef = useRef(false)

  const api = useMemo(() => createApi({
    // 云端动作前的二次确认（R-07）：确认一次后本页不再重复问
    confirmCloud: (text) => {
      if (consentRef.current) return true
      const ok = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : false
      if (ok) consentRef.current = true
      return ok
    },
  }), [])

  const caps = useMemo(() => capabilitiesFrom(health), [health])
  // 表格/轮询/录音检测统一用派生视图：原始 meeting 的字段是 status.record，派生后才是 record
  const listRows = useMemo(() => toListRows(rows, { limit: 50 }), [rows])

  const refresh = useCallback(async () => {
    const [listResult, healthResult] = await Promise.all([api.list({ limit: 50 }), api.health()])
    if (listResult.ok === false) {
      setError(errorText(listResult.code, listResult.detail))
      return
    }
    setError(null)
    setRows(listResult.meetings ?? [])
    if (healthResult.ok !== false) setHealth(healthResult)
    else setHealth(null)
  }, [api])

  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return }
    const result = await api.detail({ id })
    if (result.ok === false) {
      setError(errorText(result.code, result.detail))
      setDetail(null)
      return
    }
    setDetail(toDetailView(result))
  }, [api])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { loadDetail(selectedId) }, [selectedId, loadDetail])

  // 轮询：只在有进行中任务或详情打开时跑，页面不可见时跳过（R-06）
  const pollStart = useRef(Date.now())
  useEffect(() => {
    const running = listRows.some((row) => row.transcribe.status === 'running' || row.minutes.status === 'running' || row.record.status === 'running')
    if (!running && !selectedId) return undefined

    const timer = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      if (Date.now() - pollStart.current > POLL_MAX_MS) return
      await refresh()
      if (selectedId) await loadDetail(selectedId)
    }, POLL_MS)

    return () => clearInterval(timer)
  }, [listRows, selectedId, refresh, loadDetail])

  // 录音计时
  useEffect(() => {
    const recording = listRows.find((row) => row.record.status === 'running')
    if (!recording) { setRecordSeconds(0); return undefined }
    const timer = setInterval(() => setRecordSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [listRows])

  const runAction = useCallback(async (name, fn) => {
    setBusy(name)
    setError(null)
    setNotice(null)
    try {
      const result = await fn()
      if (result?.ok === false) {
        setError(errorText(result.code, result.detail))
        if (result.message) setNotice(result.message)
      } else if (result?.accepted) {
        setNotice('已提交，正在后台处理…')
      } else if (result?.meetingId) {
        setNotice(`完成：${result.meetingId}`)
      }
      await refresh()
      if (selectedId) await loadDetail(selectedId)
    } catch (thrown) {
      setError(String(thrown?.message ?? thrown))
    } finally {
      setBusy(null)
    }
  }, [refresh, loadDetail, selectedId])

  const recordingRow = listRows.find((row) => row.record.status === 'running')

  return createElement('div', { style: styles.wrap },
    createElement('div', { style: styles.bar },
      createElement('strong', { style: { fontSize: 15 } }, '会记'),
      createElement('button', { type: 'button', style: styles.btn, onClick: refresh }, '刷新'),
      createElement('span', { style: styles.muted },
        caps.cloudReady ? `云端可用${caps.cloudModel ? `（${caps.cloudModel}）` : ''}` : '云端未配置（需 DASHSCOPE_API_KEY）'),
      createElement('span', { style: styles.muted },
        caps.localModels.length > 0 ? `本地模型：${caps.localModels.join('/')}` : '本地模型未下载'),
    ),

    error ? createElement('div', { style: styles.error }, error) : null,
    notice ? createElement('div', { style: styles.muted }, notice) : null,

    createElement('div', { style: styles.card },
      createElement('div', { style: styles.bar },
        recordingRow
          ? createElement('button', {
              type: 'button', style: styles.btn,
              disabled: busy === 'stop',
              onClick: () => runAction('stop', () => api.record({ action: 'stop' })),
            }, `停止录音 ${formatDuration(recordSeconds)}`)
          : createElement('button', {
              type: 'button', style: styles.btnPrimary,
              disabled: busy === 'start' || !caps.recordingReady,
              title: caps.recordingReady ? '' : '录音依赖不可用',
              onClick: () => runAction('start', () => api.record({ action: 'start', label: '' })),
            }, '开始录音'),
        createElement('input', {
          style: styles.input,
          placeholder: '导入音频的本地路径，如 D:\\会议\\a.m4a',
          value: importPath,
          onChange: (event) => setImportPath(event.target.value),
        }),
        createElement('button', {
          type: 'button',
          style: importPath ? styles.btn : { ...styles.btn, ...styles.btnDisabled },
          disabled: !importPath || busy === 'import',
          onClick: () => runAction('import', async () => {
            const result = await api.importAudio({ path: importPath })
            if (result?.ok !== false) setImportPath('')
            return result
          }),
        }, '导入'),
      ),
    ),

    createElement('div', { style: styles.card },
      rows.length === 0
        ? createElement('div', { style: styles.muted }, '还没有任何会议。点上面「开始录音」，或填路径导入一段音频。')
        : createElement('table', { style: styles.table },
            createElement('thead', null,
              createElement('tr', null,
                createElement('th', { style: styles.th }, '时间'),
                createElement('th', { style: styles.th }, '标签'),
                createElement('th', { style: styles.th }, '时长'),
                createElement('th', { style: styles.th }, '引擎'),
                createElement('th', { style: styles.th }, '录音'),
                createElement('th', { style: styles.th }, '转写'),
                createElement('th', { style: styles.th }, '纪要'),
              ),
            ),
            createElement('tbody', null,
              listRows.map((row) => createElement('tr', {
                key: row.id,
                onClick: () => { setSelectedId(row.id === selectedId ? null : row.id); setShowAll(false) },
                style: { cursor: 'pointer', background: row.id === selectedId ? 'rgba(90,150,255,0.08)' : 'transparent' },
              },
                createElement('td', { style: styles.td }, row.startedText),
                createElement('td', { style: styles.td }, row.label),
                createElement('td', { style: styles.td }, row.durationText),
                createElement('td', { style: styles.td }, row.engineText),
                createElement('td', { style: styles.td }, createElement(StatusBadge, { meta: row.record })),
                createElement('td', { style: styles.td }, createElement(StatusBadge, { meta: row.transcribe })),
                createElement('td', { style: styles.td }, createElement(StatusBadge, { meta: row.minutes })),
              )),
            ),
          ),
    ),

    detail ? createElement('div', { style: styles.card },
      createElement('div', { style: styles.bar },
        createElement('strong', null, detail.label),
        createElement('span', { style: styles.muted }, `${detail.startedText} · ${detail.durationText} · ${detail.engineText}`),
        createElement('button', {
          type: 'button', style: caps.localModels.length > 0 ? styles.btn : { ...styles.btn, ...styles.btnDisabled },
          disabled: busy === 'local' || caps.localModels.length === 0,
          onClick: () => runAction('local', () => api.transcribe({ id: detail.id, engine: 'local' })),
        }, '本地转写'),
        createElement('button', {
          type: 'button', style: caps.cloudReady ? styles.btn : { ...styles.btn, ...styles.btnDisabled },
          disabled: busy === 'cloud' || !caps.cloudReady,
          title: caps.cloudReady ? '' : '未配置 DASHSCOPE_API_KEY',
          onClick: () => runAction('cloud', () => api.transcribe({ id: detail.id, engine: 'cloud' })),
        }, '云端转写'),
        createElement('button', {
          type: 'button', style: styles.btn,
          disabled: busy === 'minutes' || detail.transcribe.status !== 'done',
          onClick: () => runAction('minutes', () => api.minutes({ id: detail.id, force: false })),
        }, '生成纪要'),
        createElement('button', {
          type: 'button', style: styles.btn,
          disabled: busy === 'minutes2',
          onClick: () => runAction('minutes2', () => api.minutes({ id: detail.id, force: true })),
        }, '重新生成'),
      ),

      createElement('div', { style: styles.detail },
        createElement('span', { style: styles.muted }, '音频'),
        createElement('span', null, detail.audioPath ?? '—'),
        createElement('span', { style: styles.muted }, '统计'),
        createElement('span', null, detail.stats ? `${detail.stats.segments ?? '?'} 段 / ${detail.stats.chars ?? '?'} 字` : '—'),
      ),

      createElement('div', null,
        createElement('div', { style: styles.muted }, detail.hasTranscript ? '转写' : '转写（尚未生成）'),
        detail.hasTranscript
          ? createElement('div', null,
              createElement('pre', { style: styles.pre },
                paginateTranscript(detail.transcriptText, { showAll }).lines.join('\n')),
              paginateTranscript(detail.transcriptText, { showAll }).truncated
                ? createElement('button', {
                    type: 'button', style: styles.btn, onClick: () => setShowAll(true),
                  }, `展开剩余 ${paginateTranscript(detail.transcriptText, { showAll }).remaining} 行`)
                : null,
            )
          : null,
      ),

      createElement('div', null,
        createElement('div', { style: styles.muted }, detail.hasMinutes ? '纪要' : '纪要（尚未生成）'),
        detail.hasMinutes ? createElement('pre', { style: styles.pre }, detail.minutesText) : null,
      ),
    ) : null,
  )
}

