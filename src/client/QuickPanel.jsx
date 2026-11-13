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
import { buildHandoffMessage, modeLabel } from './handoff.js'
import { copyText, hostStatusText, sendToSession } from './host.js'
import { STREAM_CONSENT_TEXT, capabilitiesFrom, errorText, formatDateTime, formatDuration, liveView, needsStreamConsent, shouldPollLive, triggerView } from './logic.js'
import { LIVE_POLL_MS } from './logic.js'
import { theme } from './theme.js'
import { useRecordState } from './recordState.js'
import { currentSessionId } from './host.js'
import { rememberMeeting, getRememberedMeeting, forgetMeeting } from './lastMeeting.js'
import HistoryList from './HistoryList.jsx'
import { toListRows } from './logic.js'

const POLL_MS = 2000
const TRANSCRIBE_TIMEOUT_MS = 15 * 60 * 1000

const styles = {
  // CR-01：root 撑满输入行高，使卡片的 bottom:100% 落在「输入行上沿」而不是「入口上沿」，
  // 避免卡片压进输入行、吃掉点输入框的点击（实测缺陷：光标进不去，缩放窗口才恢复）
  root: {
    position: 'relative', display: 'inline-flex', alignItems: 'center',
    alignSelf: 'stretch',
  },
  // 入口：图标 + 文字，无按钮外观（R-01）；开合状态由 aria-expanded 表达，不靠边框
  trigger: {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0,
    border: 'none', background: 'transparent', color: theme.textSecondary,
    cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', lineHeight: '16px',
  },
  dot: (tone) => ({
    width: 8, height: 8, borderRadius: 999, display: 'inline-block', flex: '0 0 auto',
    background: tone === 'success' ? theme.success : theme.textMuted,
  }),
  timing: { color: theme.textSecondary, fontVariantNumeric: 'tabular-nums' },
  // 卡片内确认条（替代 window.confirm）
  consent: {
    display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 8,
    border: `1px solid ${theme.accentBorder}`, background: theme.accentBg,
  },
  consentText: { color: theme.text, fontSize: 11, lineHeight: 1.6 },
  panel: {
    // CR-01：间距改用 marginBottom，bottom 只表达「贴着输入行上沿」，不再把偏移量算进锚点
    position: 'absolute', bottom: '100%', right: 0, zIndex: 40,
    width: 380, maxWidth: 'min(380px, calc(100vw - 24px))', marginBottom: 8,
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
  // 字幕区：定稿强（正文色）、中间结果弱（灰 + 斜体），不引入新颜色令牌
  liveBox: {
    display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 8,
    border: `1px solid ${theme.border}`, maxHeight: 168, overflowY: 'auto',
  },
  liveFinal: { color: theme.text, fontSize: 11, lineHeight: 1.6 },
  livePartial: { color: theme.textMuted, fontStyle: 'italic', fontSize: 11, lineHeight: 1.6 },
  liveTime: { color: theme.textMuted, fontSize: 10, fontFamily: theme.mono, marginRight: 6 },

  // 页面模式（CR-02）：入口搬到侧栏后，这里是主区域的「会记」页面，不再是浮在输入框上的卡片
  pageRoot: {
    display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
    boxSizing: 'border-box', overflowY: 'auto', padding: '20px 24px 28px',
    color: theme.text, fontFamily: theme.font, background: theme.bg,
  },
  pagePanel: {
    display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 860,
    fontSize: 13, border: 'none', padding: 0, background: 'transparent',
  },
}

/** 会话 id 太长，界面里只露尾巴 */
function shortId(id) {
  if (typeof id !== 'string' || id === '') return '（未识别到当前会话）'
  return id.length <= 16 ? id : `…${id.slice(-8)}`
}

const PHASE_TEXT = {
  starting: '启动录音…',
  stopping: '收尾录音…',
  transcribing: '识别中…',
  sending: '发送中…',
  sent: '已发送',
  error: '出错',
}

export function QuickPanel({ sessionId, page = false } = {}) {
  // 槽位 0 仍是 open；CR-01 撤销持久化：默认收起，不跨会话记忆
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
  const [live, setLive] = useState(null)
  const [liveSilence, setLiveSilence] = useState(0)
  const rootRef = useRef(null)
  const streamAckRef = useRef(false)
  const liveKeyRef = useRef('')
  const liveChangedAtRef = useRef(0)

  /**
   * 卡片内确认（替代 window.confirm）。
   *
   * 教训：Electron 里原生 confirm 会打断渲染进程的输入法编辑上下文——弹过之后宿主输入框
   * 收得到 keydown 却输不进字，要到窗口缩放才恢复。这里改成页面内的确认条，
   * 不再让宿主弹原生对话框。
   */
  const [consent, setConsent] = useState(null)
  const consentResolveRef = useRef(null)

  // 历史纪要区（CR-03）：从设置页搬来，状态留在页面里，切走重进重新拉
  const [historyId, setHistoryId] = useState(null)
  const [historyTitle, setHistoryTitle] = useState('')
  const [historyText, setHistoryText] = useState('')
  const [historyAll, setHistoryAll] = useState(false)
  const [historyListLimit, setHistoryListLimit] = useState(20)
  const [historyError, setHistoryError] = useState(null)
  const [generatingId, setGeneratingId] = useState(null)

  const askConsent = useCallback((text) => new Promise((resolve) => {
    consentResolveRef.current = resolve
    setConsent({ text })
  }), [])

  const answerConsent = useCallback((granted) => {
    const resolve = consentResolveRef.current
    consentResolveRef.current = null
    setConsent(null)
    if (resolve) resolve(granted)
  }, [])

  const api = useMemo(() => createApi({
    confirmCloud: (text) => askConsent(text),
  }), [askConsent])
  const caps = useMemo(() => capabilitiesFrom(health), [health])
  const historyRows = useMemo(() => toListRows(rows, { limit: 50 }), [rows])

  /** 展开/收起某场会议：有纪要显示纪要，没有则显示转写 */
  const openHistory = useCallback(async (id) => {
    if (historyId === id) { setHistoryId(null); setHistoryText(''); setError(null); return }
    setHistoryError(null)
    const result = await api.detail({ id })
    if (result.ok === false) { setHistoryError(errorText(result.code, result.detail)); return }
    const minutes = (result.minutes ?? '').trim()
    const transcript = (result.transcript ?? '').trim()
    setHistoryId(id)
    setHistoryTitle(result.meeting?.label || result.meeting?.startedAt || id)
    setHistoryText(minutes !== '' ? minutes : transcript)
    setHistoryAll(false)
    if (minutes === '' && transcript === '') setHistoryError('这场会议没有纪要，也没有转写正文')
  }, [api, historyId])

  const refresh = useCallback(async () => {
    const [listResult, healthResult] = await Promise.all([api.list({ limit: page ? 50 : 3 }), api.health()])
    if (listResult.ok === false) {
      // 刷新失败是「后台拉列表」的问题，不能显示成「识别失败」误导用户
      setRefreshError(`刷新失败：${errorText(listResult.code, listResult.detail)}`)
      return
    }
    setRefreshError(null)
    setRows(listResult.meetings ?? [])
    setHealth(healthResult.ok === false ? null : healthResult)
  }, [api])

  // 页面模式没有「展开」这一步：一进页面就该拉数据（否则会一直显示「云端未配置」）
  const visible = page || open

  useEffect(() => {
    if (!visible) return undefined
    refresh()
    const timer = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) refresh() }, POLL_MS * 2)
    return () => clearInterval(timer)
  }, [visible, refresh])

  // 点面板外部或按 Esc 收起（R-04）：两个监听合成一个 effect，Esc 不阻止默认行为
  useEffect(() => {
    if (!visible || page) return undefined // 页面模式没有「点外面收起」
    const close = () => { if (consentResolveRef.current) answerConsent(false); setOpen(false) }
    const onDown = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) close() }
    const onKey = (event) => { if (event.key === 'Escape') close() }
    if (typeof document !== 'undefined') {
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('mousedown', onDown)
        document.removeEventListener('keydown', onKey)
      }
    }
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

  /**
   * 全局录音态（CR-02 / R-14）。
   *
   * 放在 useState 之后、所有 effect 之前调用：不打乱 hook 序号，
   * 又让字幕轮询能看见「这个录音不是本组件发起的」——切走再切回来才不会把字幕框丢掉。
   */
  const globalRecord = useRecordState()
  const externalRunning = page && globalRecord.running === true
  const recording = phase === 'recording' || externalRunning
  const liveMeetingId = current?.meetingId ?? (externalRunning ? globalRecord.meetingId : null)
  const liveStreaming = current?.streaming === true || (externalRunning && globalRecord.streaming === true)

  // 外部（别的会话/上次进入）开着的录音：把当前会议补进组件状态，字幕轮询才有 context
  useEffect(() => {
    if (!externalRunning || !globalRecord.meetingId) return
    setPhase((value) => (value === 'idle' || value === 'error' || value === 'sent' ? 'recording' : value))
    setCurrent((value) => (value?.meetingId === globalRecord.meetingId
      ? value
      : {
          meetingId: globalRecord.meetingId,
          label: globalRecord.label ?? '',
          startedAt: globalRecord.startedAt ?? null,
          durationSec: null,
          streaming: globalRecord.streaming === true,
        }))
  }, [externalRunning, globalRecord.meetingId, globalRecord.label, globalRecord.startedAt, globalRecord.streaming])

  // 回到页面时把「刚录完的那场」捡回来（用户反馈：停止录制后切页面，回来内容没了）
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    if (!(page || open)) return
    if (recording) return
    const remembered = getRememberedMeeting()
    if (!remembered) { restoredRef.current = true; return }
    if (current?.meetingId === remembered.meetingId) { restoredRef.current = true; return }
    restoredRef.current = true
    let cancelled = false
    ;(async () => {
      const detail = await api.detail({ id: remembered.meetingId, sessionId })
      if (cancelled) return
      if (detail.ok === false) return
      const meeting = detail.meeting ?? {}
      const status = meeting.status?.transcribe
      if (status !== 'done' || !detail.transcript) {
        setNotice(`上一场会议 ${remembered.meetingId} 还没出转写结果，可在 设置 → 会记 查看`)
        return
      }
      setCurrent({
        meetingId: remembered.meetingId,
        label: meeting.label ?? '',
        startedAt: meeting.startedAt,
        durationSec: meeting.durationSec ?? null,
        outputPath: detail.outputPath ?? null,
        outputMode: detail.outputMode ?? 'fallback',
        workspaceRoot: detail.workspaceRoot ?? null,
        streaming: false,
      })
      setLabelDraft(meeting.label ?? '')
      setTranscript(detail.transcript ?? '')
      setPhase('confirm')
    })()
    return () => { cancelled = true }
  }, [page, open, recording, current?.meetingId, api, sessionId])

  // 字幕轮询（R-02）：只在流式录音期间开；页面隐藏时暂停，回来再继续
  useEffect(() => {
    const meetingId = liveMeetingId
    if (!recording || liveStreaming !== true || !meetingId) {
      setLive(null)
      setLiveSilence(0)
      return undefined
    }
    let stopped = false

    const tick = async () => {
      if (stopped) return
      if (!shouldPollLive({ phase: 'recording', streaming: true, hidden: typeof document !== 'undefined' && document.hidden === true })) return
      const result = await api.live({ id: meetingId })
      if (stopped || result.ok === false) return
      const snapshot = result.data ?? null
      setLive(snapshot)
      const key = `${snapshot?.chars ?? 0}|${snapshot?.partial ?? ''}`
      if (key !== liveKeyRef.current) {
        liveKeyRef.current = key
        liveChangedAtRef.current = Date.now()
      }
      const silence = liveChangedAtRef.current === 0 ? 0 : Math.floor((Date.now() - liveChangedAtRef.current) / 1000)
      setLiveSilence(silence)
    }

    liveKeyRef.current = ''
    liveChangedAtRef.current = Date.now()
    tick()
    const timer = setInterval(tick, LIVE_POLL_MS)
    return () => { stopped = true; clearInterval(timer) }
  }, [recording, liveMeetingId, liveStreaming, api])

  const startRecord = useCallback(async () => {
    setError(null); setNotice(null); setPhase('starting')

    // 流式开启且本次会话还没确认过 → 先确认「录音期间持续上传音频」（R-08）
    const wantStream = caps.streamReady === true
    if (wantStream && needsStreamConsent({ streamEnabled: true, acknowledged: streamAckRef.current })) {
      const granted = await askConsent(STREAM_CONSENT_TEXT)
      if (!granted) {
        setPhase('idle')
        setNotice('已取消：未确认录音期间上传音频')
        return
      }
      streamAckRef.current = true
    }

    const result = await api.record({ action: 'start', stream: wantStream ? true : undefined, sessionId })
    if (result.ok === false) { setPhase('error'); setError(errorText(result.code, result.detail)); return }
    setCurrent({ meetingId: result.meetingId, label: '', durationSec: null, streaming: result.stream?.stream === true })
    setPhase('recording')
  }, [api, askConsent, caps.streamReady, sessionId])

  const awaitTranscript = useCallback(async (meetingId, durationSec) => {
    const deadline = Date.now() + TRANSCRIBE_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      const detail = await api.detail({ id: meetingId, sessionId })
      if (detail.ok === false) { setPhase('error'); setError(errorText(detail.code, detail.detail)); return }

      const status = detail.meeting?.status?.transcribe
      if (status === 'done') {
        const label = detail.meeting?.label ?? ''
        setCurrent({
          meetingId,
          label,
          startedAt: detail.meeting?.startedAt,
          durationSec: detail.meeting?.durationSec ?? durationSec,
          outputPath: detail.outputPath ?? null,
          outputMode: detail.outputMode ?? 'fallback',
          workspaceRoot: detail.workspaceRoot ?? null,
          streaming: false,
        })
        setLabelDraft(label)
        setTranscript(detail.transcript ?? '')
        setPhase('confirm')
        rememberMeeting(meetingId)
        refresh()
        return
      }
      if (status === 'failed') {
        setPhase('error')
        setError(detail.meeting?.errors?.transcribe ?? '识别失败')
        rememberMeeting(meetingId)
        return
      }
    }
    setPhase('error')
    setError('识别超时，请稍后在设置页查看状态')
  }, [api, refresh, sessionId])

  const runTranscribe = useCallback(async (meetingId, durationSec) => {
    setPhase('transcribing')
    setTranscript('')

    // 先取配置里的引擎，显式传下去（云端会触发二次确认）
    const config = await api.getConfig()
    const engine = config.ok === false ? undefined : config.config?.asr?.engine
    const accepted = await api.transcribe({ id: meetingId, engine, sessionId })
    if (accepted.ok === false) {
      setPhase('error')
      setError(errorText(accepted.code, accepted.detail))
      if (accepted.message) setNotice(accepted.message)
      return
    }

    await awaitTranscript(meetingId, durationSec)
  }, [api, sessionId, awaitTranscript])

  const stopRecord = useCallback(async () => {
    setPhase('stopping')
    const result = await api.record({ action: 'stop', sessionId })
    if (result.ok === false) { setPhase('error'); setError(errorText(result.code, result.detail)); return }

    const stream = result.stream
    // 流式已在录音期间出字（R-05/R-06）：直接进入确认区，不再跑一次整段识别
    if (stream?.used === true) {
      setLive(null)
      setNotice(`流式识别完成：${stream.segments} 段 / ${stream.chars} 字${stream.timedOut ? '（末尾可能截断）' : ''}`)
      setPhase('transcribing')
      await awaitTranscript(result.meetingId, result.durationSec)
      return
    }
    // 降级（R-07）：音频还在，等后台整段识别出结果，如实说明
    if (stream?.degraded === true) {
      setLive(null)
      setNotice('流式未连上，已改用停录后的整段识别')
      setPhase('transcribing')
      await awaitTranscript(result.meetingId, result.durationSec)
      return
    }

    setLive(null)
    await runTranscribe(result.meetingId, result.durationSec)
  }, [api, sessionId, awaitTranscript, runTranscribe])

  /**
   * 组装交接消息：优先用 /detail 返回的绝对路径等事实，detail 失败才退回界面已有信息。
   * BUG-05：以前直接用界面状态里的相对路径，会话换工作区就读不到文件。
   */
  const buildFor = useCallback(async (meetingId, fallback = {}) => {
    const detail = await api.detail({ id: meetingId })
    if (detail.ok === false) {
      return buildHandoffMessage({
        meetingId,
        label: fallback.label,
        durationSec: fallback.durationSec,
        outputPath: fallback.outputPath,
        outputMode: fallback.outputMode,
        workspaceRoot: fallback.workspaceRoot,
        transcript: fallback.transcript,
      })
    }
    return buildHandoffMessage({
      meetingId,
      label: detail.meeting?.label ?? fallback.label,
      durationSec: detail.meeting?.durationSec ?? fallback.durationSec,
      outputAbs: detail.outputAbs ?? null,
      outputRelative: detail.outputRelative ?? null,
      outputBytes: detail.outputBytes ?? 0,
      outputPath: detail.outputPath ?? null,
      outputMode: detail.outputMode ?? 'workspace',
      workspaceRoot: detail.workspaceRoot ?? null,
      transcriptAbs: detail.transcriptAbs ?? null,
      transcriptChars: detail.transcriptChars ?? 0,
      transcript: detail.transcript ?? fallback.transcript ?? '',
    })
  }, [api])

  /**
   * 把文本交给当前会话。
   *
   * 交接（确认区）和历史纪要用同一条路：都发到「当前打开的会话」，
   * 由会话里的 agent 生成纪要并写回产物。失败时复述真实原因并兜底复制，
   * 不把「写锁被占」说成「不支持」。
   */
  const deliver = useCallback(async (text, built) => {
    // 页面态拿不到会话注入 → 用宿主记录的「当前打开的会话」
    const target = sessionId ?? currentSessionId()
    const sent = await sendToSession({ sessionId: target ?? undefined, text })
    if (sent.ok) {
      const label = modeLabel(built?.mode)
      const size = built?.mode === 'inline' ? `，${built?.chars ?? text.length} 字` : ''
      return {
        ok: true,
        notice: `已发送到会话 ${shortId(sent.sessionId)}（${label}${size}）· 点左侧该会话查看`,
      }
    }
    const copied = await copyText(text)
    const blocked = /写锁|writer-held|正开着这个会话/.test(String(sent.reason))
    return {
      ok: false,
      reason: sent.reason,
      notice: copied.ok
        ? (blocked
          ? '该会话正被另一个客户端占着，文本已复制到剪贴板——打开这个会话粘贴发送即可'
          : '宿主不支持自动发送，文本已复制到剪贴板，请粘贴到输入框发送')
        : `无法发送也无法复制（${copied.reason}），请手动重试`,
    }
  }, [sessionId])

  const handoff = useCallback(async () => {
    if (!current?.meetingId) return
    const built = await buildFor(current.meetingId, {
      label: current.label,
      durationSec: current.durationSec,
      outputPath: current.outputPath,
      outputMode: current.outputMode,
      workspaceRoot: current.workspaceRoot,
      transcript,
    })
    if (built.ok === false) { setPhase('error'); setError(built.reason); return }

    setPhase('sending')
    const result = await deliver(built.text, built)
    if (result.ok) { setPhase('sent'); setNotice(result.notice); return }
    setError(`无法自动发送：${result.reason}`)
    setPhase('sent')
    setNotice(result.notice)
  }, [current, transcript, deliver, buildFor])

  /** 历史行「生成纪要」：和正常流程一样，把这场的转写发给当前会话 */
  const generateMinutes = useCallback(async (row) => {
    if (!row?.id || generatingId) return
    setHistoryError(null)
    setGeneratingId(row.id)
    try {
      const built = await buildFor(row.id, { label: row.rawLabel ?? '' })
      if (built.ok === false) { setHistoryError(built.reason); return }
      const result = await deliver(built.text, built)
      if (result.ok) { setNotice(result.notice); return }
      setHistoryError(`无法自动发送：${result.reason}`)
      setNotice(result.notice)
    } finally {
      setGeneratingId(null)
    }
  }, [buildFor, deliver, generatingId])

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
    forgetMeeting()
    setLive(null); setLiveSilence(0)
  }, [])

  const liveSeconds = externalRunning ? globalRecord.seconds : seconds
  const busy = ['starting', 'stopping', 'transcribing', 'sending'].includes(phase)
  const liveCard = liveView(live, { silenceSec: liveSilence })
  const trigger = triggerView({ recording, seconds, open })

  // 页面模式：不渲染入口按钮（入口在侧栏），内容直接铺成主区域页面
  return createElement('div', { ref: rootRef, style: page ? styles.pageRoot : styles.root },
    page ? null : createElement('button', {
      type: 'button',
      style: styles.trigger,
      title: trigger.title,
      'aria-label': trigger.ariaLabel,
      'aria-expanded': trigger.expanded,
      onClick: () => setOpen((value) => !value),
    },
      createElement('span', { key: 'dot', style: styles.dot(trigger.tone), 'aria-hidden': 'true' }),
      createElement('span', { key: 'label' }, trigger.label),
      trigger.timing ? createElement('span', { key: 'timing', style: styles.timing }, trigger.timing) : null,
    ),

    (page || open) ? createElement('div', { style: page ? styles.pagePanel : styles.panel },
      createElement('div', { style: styles.row },
        createElement('strong', null, '会记'),
        createElement('span', { style: styles.muted }, caps.cloudReady ? `云端可用${caps.cloudModel ? `·${caps.cloudModel}` : ''}` : '云端未配置'),
      ),

      error ? createElement('div', { style: styles.error }, error) : null,
      refreshError ? createElement('div', { style: styles.muted }, refreshError) : null,
      notice ? createElement('div', { style: styles.ok }, notice) : null,

      // 卡片内确认条（替代 window.confirm：原生弹窗会打断宿主输入法的编辑上下文）
      consent ? createElement('div', { style: styles.consent },
        createElement('div', { style: styles.consentText }, consent.text),
        createElement('div', { style: styles.row },
          createElement('button', { type: 'button', style: styles.btnPrimary, onClick: () => answerConsent(true) }, '继续'),
          createElement('button', { type: 'button', style: styles.btn, onClick: () => answerConsent(false) }, '取消'),
        ),
      ) : null,

      createElement('div', { style: styles.row },
        recording
          ? createElement('button', { type: 'button', style: styles.btn, onClick: stopRecord }, `停止并识别 ${formatDuration(liveSeconds)}`)
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

      // 字幕区（R-02/R-03）：定稿强、中间结果弱；降级后冻结并说明
      liveCard
        ? createElement('div', { style: styles.liveBox },
            createElement('div', { style: styles.row },
              createElement('span', { style: liveCard.tone === 'error' ? styles.error : styles.muted }, liveCard.statusText),
              createElement('span', { style: styles.muted }, `${liveCard.elapsedText} · ${liveCard.chars} 字`),
            ),
            ...liveCard.finals.map((item) => createElement('div', { key: item.key, style: styles.liveFinal },
              createElement('span', { style: styles.liveTime }, item.timeText),
              item.text,
            )),
            liveCard.partial
              ? createElement('div', { key: 'partial', style: styles.livePartial }, liveCard.partial)
              : null,
            liveCard.waiting
              ? createElement('div', { style: styles.muted }, '等待语音…')
              : null,
            liveCard.blank && !liveCard.waiting
              ? createElement('div', { style: styles.muted }, liveCard.state === 'finalizing' ? '正在定稿…' : '正在聆听…')
              : null,
            liveCard.frozen
              ? createElement('div', { style: styles.muted }, '字幕已停止更新')
              : null,
            liveCard.tone === 'error'
              ? createElement('div', { style: styles.error }, '流式已降级：停录后会改用整段音频识别，字幕不再更新')
              : null,
          )
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

      // 产物位置：让用户知道文件落在哪（R-01）
      current?.meetingId && current.outputPath
        ? createElement('div', { style: styles.muted },
            `产物：${current.outputPath}${current.outputMode === 'workspace' ? '（工作区）' : '（回落数据目录）'}`,
          )
        : null,

      // 确认区：识别完成后出现，可编辑
      phase === 'confirm' || phase === 'sending' || phase === 'sent'
        ? createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            createElement('div', { style: styles.muted },
              `识别结果（可改错字）· ${transcript.length} 字 · 目标会话 ${shortId(sessionId ?? currentSessionId())}`),
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

      // 历史纪要（CR-03）：从设置页搬来，所有会议都列，没出纪要的也能找到
      page
        ? createElement(HistoryList, {
            rows: historyRows,
            openedId: historyId,
            openedTitle: historyTitle,
            openedText: historyText,
            showAll: historyAll,
            limit: historyListLimit,
            error: historyError,
            generatingId,
            onOpen: openHistory,
            onGenerate: generateMinutes,
            onShowAll: (what) => {
              if (what === 'more') setHistoryListLimit((n) => n + 20)
              else setHistoryAll(true)
            },
          })
        : null,

      createElement('div', { style: { ...styles.muted, fontSize: 10 } }, hostStatusText()),
    ) : null,
  )
}

export default QuickPanel
