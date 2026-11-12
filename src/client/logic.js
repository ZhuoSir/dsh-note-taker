/**
 * 会记页面的纯逻辑（无 React / 无 DOM / 无 fetch）。
 *
 * 抽出来的目的：这一层能被单测覆盖（R-09），组件只负责把它渲染出来。
 * 任何需要「判断」的事都放这里，组件里不许出现业务分支。
 *
 * @module dsh-note-taker/client/logic
 */

export const STATUS_TONE = Object.freeze({
  pending: 'muted',
  running: 'active',
  done: 'ok',
  failed: 'error',
})

const STATUS_TEXT = Object.freeze({
  pending: '待处理',
  running: '进行中',
  done: '完成',
  failed: '失败',
})

const ENGINE_TEXT = Object.freeze({
  local: '本地',
  cloud: '云端',
})

/** 会议某一维度的展示态：文案 + 色调 + 失败原因 */
export function statusMeta(meeting, field) {
  const status = meeting?.status?.[field] ?? 'pending'
  const tone = STATUS_TONE[status] ?? 'muted'
  const text = STATUS_TEXT[status] ?? status
  const reason = status === 'failed' ? (meeting?.errors?.[field] ?? '未知原因') : null
  return { status, text, tone, reason }
}

/** 时长：47 分钟 → `47:06`；超过 1 小时 → `1:02:03` */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const pad = (value) => String(value).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

/** 起止时间：只显示到分钟，避免列表太吵 */
export function formatDateTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 列表视图：倒序 + 截断 + 派生展示字段 */
export function toListRows(meetings, { limit = 20 } = {}) {
  const rows = [...(meetings ?? [])]
    .sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))
    .slice(0, limit)
    .map((meeting) => ({
      id: meeting.id,
      // 未命名不再显示占位符，直接显示开始时间，方便认领
      label: (typeof meeting.label === 'string' && meeting.label.trim() !== '') ? meeting.label.trim() : formatDateTime(meeting.startedAt),
      rawLabel: typeof meeting.label === 'string' ? meeting.label : '',
      startedAt: meeting.startedAt,
      startedText: formatDateTime(meeting.startedAt),
      durationText: formatDuration(meeting.durationSec),
      engineText: ENGINE_TEXT[meeting.engine ?? 'local'] ?? meeting.engine ?? '本地',
      record: statusMeta(meeting, 'record'),
      transcribe: statusMeta(meeting, 'transcribe'),
      // hasMinutes 来自服务端按文件判断（agent 直接写文件时状态位可能是旧的）
      minutes: meeting?.hasMinutes === true && meeting?.status?.minutes !== 'done'
        ? { ...statusMeta(meeting, 'minutes'), status: 'done', text: '完成', tone: 'ok', reason: null }
        : statusMeta(meeting, 'minutes'),
      hasMinutes: meeting?.hasMinutes === true,
      segments: meeting?.stats?.segments ?? null,
      chars: meeting?.stats?.chars ?? null,
    }))
  return rows
}

/** 错误码 → 用户能看懂的话（页面不直接展示技术码） */
export function errorText(code, detail = {}) {
  // 服务端给了具体原因就用它——泛化文案会把真因盖掉
  // （曾经把「路由 500」显示成「云端识别失败」，白查半天）
  const serverMessage = typeof detail?.message === 'string' && detail.message.trim() !== '' ? detail.message.trim() : null
  const where = typeof detail?.endpoint === 'string' ? `（${detail.endpoint}）` : ''

  switch (code) {
    case 'E_DEP':
      return detail?.env
        ? `缺少配置：${detail.env}，设置后重试`
        : (serverMessage ?? '缺少必要的依赖或配置，请检查插件设置')
    case 'E_LLM':
      return serverMessage ? `${serverMessage}${where}` : `模型或网络调用失败${where}，请稍后重试`
    case 'E_MODEL':
      return '本地模型不可用，请先下载模型或改用云端引擎'
    case 'E_AUDIO':
      return '音频不可读或已损坏'
    case 'E_DEVICE':
      return '录音设备不可用（被占用或未插入）'
    case 'E_STATE':
      return detail?.message ?? '当前状态下不允许这个操作'
    default:
      return code ? `操作失败（${code}）` : '操作失败'
  }
}

/** 云端动作前是否需要二次确认（R-07）：选云端且本会话还没确认过 */
export function needsCloudConsent(engine, acknowledged = false) {
  return engine === 'cloud' && acknowledged !== true
}

export const CLOUD_CONSENT_TEXT = '云端转写会把音频上传至阿里云百炼（DashScope）进行识别，是否继续？'

/** 流式识别：录音期间是持续上传，文案必须说清「持续」二字（R-08） */
export const STREAM_CONSENT_TEXT = '流式识别会在录音期间持续上传音频到阿里云百炼（DashScope）实时识别，是否继续？'

/** 流式首次启用是否需要再次确认（R-08）：本次会话确认过就不再问 */
export function needsStreamConsent({ streamEnabled, acknowledged } = {}) {
  return streamEnabled === true && acknowledged !== true
}

/**
 * 会话入口「会记」的渲染数据（纯函数，R-01/R-02/R-03/R-06）。
 *
 * 设计约定：
 * - 圆点只表达两态：待机灰 `muted`、录制中绿 `success`（用户 2026-11-12 选定）
 * - 状态不只靠颜色：title / ariaLabel 带文字说明
 * - 计时复用 formatDuration（`0:42` 形态），与卡片内时长显示保持同一格式
 */
export function triggerView({ recording = false, seconds = 0, open = false } = {}) {
  const timing = recording ? formatDuration(seconds) : ''
  return {
    tone: recording ? 'success' : 'muted',
    label: '会记',
    timing,
    expanded: open === true,
    title: recording ? `会记 · 录制中 ${timing}` : '会记',
    ariaLabel: recording ? `会记，录制中 ${timing}，打开面板` : '会记，打开面板',
  }
}

const LIVE_STATE_TEXT = Object.freeze({
  connecting: '连接中…',
  streaming: '实时识别中',
  finalizing: '收尾中…',
  done: '识别完成',
  degraded: '已降级',
})

/** 静默多少秒后提示「等待语音」（R-02 的可感知性） */
export const LIVE_WAIT_SECONDS = 5

/** 字幕轮询间隔（R-02）：500ms 比 3 秒的要求留足余量 */
export const LIVE_POLL_MS = 500

/** 该不该拉一次字幕（R-02/R-08）：只在流式录音期间，且页面可见时拉 */
export function shouldPollLive({ phase, streaming, hidden } = {}) {
  return phase === 'recording' && streaming === true && hidden !== true
}

/**
 * 流式快照 → 字幕区渲染数据（纯函数，R-02/R-03）。
 * 语义约定：finals 是已定稿的强文本，partial 是随时会被改写的弱文本。
 */
export function liveView(snapshot, { silenceSec = 0 } = {}) {
  const state = snapshot?.state
  if (!state || state === 'idle') return null

  const finals = (snapshot.finals ?? []).map((item, index) => ({
    key: `${index}-${item.startSec ?? 0}`,
    timeText: formatDuration(item.startSec ?? 0),
    text: String(item.text ?? ''),
  }))
  const partial = String(snapshot.partial ?? '')
  const degraded = state === 'degraded'

  return {
    state,
    // 色调只表达「正常/异常/完成」，具体颜色由组件从 theme 令牌取
    tone: degraded ? 'error' : state === 'done' ? 'ok' : 'active',
    statusText: LIVE_STATE_TEXT[state] ?? state,
    finals,
    partial,
    chars: Number(snapshot.chars ?? 0),
    elapsedText: formatDuration(snapshot.elapsedSec ?? 0),
    // 降级后不再更新字幕；只在「还在连/在识别」且长时间没字时才提示等待
    waiting: !degraded && state !== 'done' && partial === '' && Number(silenceSec) >= LIVE_WAIT_SECONDS,
    frozen: degraded || state === 'done',
    degradedReason: snapshot.degradedReason ?? null,
    blank: finals.length === 0 && partial === '',
  }
}

/** 详情页正文分块：默认只渲染前 N 段，避免 550 段卡死 */
export function paginateTranscript(text, { chunk = 100, showAll = false } = {}) {
  const lines = String(text ?? '').split('\n')
  if (showAll || lines.length <= chunk) return { lines, truncated: false, remaining: 0 }
  return { lines: lines.slice(0, chunk), truncated: true, remaining: lines.length - chunk }
}

/** 详情视图：把接口返回拼成渲染需要的形状 */
export function toDetailView(payload) {
  const meeting = payload?.meeting ?? null
  if (!meeting) return null
  return {
    id: meeting.id,
    label: meeting.label || '(未命名)',
    startedText: formatDateTime(meeting.startedAt),
    durationText: formatDuration(meeting.durationSec),
    engineText: ENGINE_TEXT[meeting.engine ?? 'local'] ?? '本地',
    audioPath: meeting?.audio?.path ?? null,
    record: statusMeta(meeting, 'record'),
    transcribe: statusMeta(meeting, 'transcribe'),
    minutes: statusMeta(meeting, 'minutes'),
    stats: meeting?.stats ?? null,
    hasTranscript: Boolean(payload?.transcript),
    hasMinutes: Boolean(payload?.minutes),
    transcriptText: payload?.transcript ?? '',
    minutesText: payload?.minutes ?? '',
  }
}

/** 健康检查结果 → 按钮可用性（缺 key 就禁用云端，不要让用户点了才报错） */
export function capabilitiesFrom(health) {
  return {
    cloudReady: health?.cloud?.configured === true,
    cloudHost: health?.cloud?.host ?? null,
    cloudModel: health?.cloud?.model ?? null,
    recordingReady: health?.recording?.available === true,
    localModels: health?.local?.models ?? [],
    // 流式：配置开启 + 密钥就绪才算可用（R-09），否则卡片不弹确认也不发流式请求
    streamEnabled: health?.stream?.enabled === true,
    streamAvailable: health?.stream?.available === true,
    streamModel: health?.stream?.model ?? null,
    streamReady: health?.stream?.enabled === true && health?.stream?.available === true,
  }
}
