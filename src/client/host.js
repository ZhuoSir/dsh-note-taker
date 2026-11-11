/**
 * 宿主能力探针与会话发送（T-01 / T-02 / R-06）。
 *
 * 关键事实（从宿主源码里确认的，不是猜）：
 *   conversation.send 必须在**会话作用域**里调用，根上下文调用会抛
 *   `conversation.send requires a session scope — address one via ctx.sessions.scope(id).conversation`
 * 所以正确姿势是：sessions.scope(sessionId).get('conversation').send(text)
 *
 * 这个模块不 import React，可在 node 下单测。
 *
 * @module dsh-note-taker/client/host
 */

const state = {
  /** 'unknown' | 'available' | 'unavailable' */
  conversation: 'unknown',
  sessions: null,
  via: 'none',
  reason: '尚未探测',
  probedAt: null,
}

export function getHostStatus() {
  return { conversation: state.conversation, via: state.via, reason: state.reason, probedAt: state.probedAt }
}

export function resetHostStatus() {
  state.conversation = 'unknown'
  state.sessions = null
  state.via = 'none'
  state.reason = '尚未探测'
  state.probedAt = null
}

export function getSessions() {
  return state.sessions
}

function markAvailable(sessions, via) {
  state.conversation = 'available'
  state.sessions = sessions
  state.via = via
  state.reason = ''
  state.probedAt = new Date().toISOString()
}

function markUnavailable(reason, via = 'none') {
  state.conversation = 'unavailable'
  state.sessions = null
  state.via = via
  state.reason = reason
  state.probedAt = new Date().toISOString()
}

/** 判定一个候选 sessions 服务是否可用于「按会话发送」 */
function usable(candidate) {
  return Boolean(candidate && typeof candidate.scope === 'function')
}

/**
 * 探测宿主能力。绝不抛错（apply 里抛错会连带 web 壳起不来）。
 * @param {object} ctx 插件上下文
 * @param {{log?: Function}} [options]
 */
export function probeHost(ctx, { log } = {}) {
  const say = log ?? (() => {})

  // 途径 1：直接取（未声明注入时可能抛错，把错误当诊断信息留下）
  try {
    const direct = (typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined) ?? ctx?.sessions
    if (usable(direct)) {
      markAvailable(direct, 'direct')
      say('[note-taker] 交接能力：可用（sessions.scope，direct）')
      return getHostStatus()
    }
    markUnavailable('sessions 服务不存在或没有 scope 方法', 'direct')
  } catch (error) {
    markUnavailable(`直接取失败：${String(error?.message ?? error).slice(0, 80)}`, 'direct')
  }

  // 途径 2：可选注入
  try {
    if (typeof ctx?.inject === 'function') {
      ctx.inject(['sessions'], (inner) => {
        const sessions = inner?.sessions ?? (typeof inner?.get === 'function' ? inner.get('sessions') : undefined)
        if (usable(sessions)) {
          markAvailable(sessions, 'inject')
          say('[note-taker] 交接能力：可用（sessions.scope，inject）')
        } else {
          markUnavailable('注入后仍无 sessions.scope', 'inject')
          say('[note-taker] 交接能力：注入后仍无 sessions，走兜底')
        }
      })
    } else {
      markUnavailable('宿主上下文没有 inject，无法取得 sessions', 'none')
    }
  } catch (error) {
    markUnavailable(`注入失败：${String(error?.message ?? error).slice(0, 80)}`, 'inject')
    say(`[note-taker] 交接能力探测失败：${String(error?.message ?? error).slice(0, 80)}`)
  }

  return getHostStatus()
}

/** 给界面看的一句话结论 */
export function hostStatusText(status = getHostStatus()) {
  if (status.conversation === 'available') return `会话发送：可用（sessions.scope · ${status.via}）`
  if (status.conversation === 'unavailable') return `会话发送：不可用（${status.reason}）`
  return '会话发送：尚未探测'
}

/**
 * 当前打开的会话 id。
 *
 * 为什么需要它：`main` 面板拿到的是空 props（宿主源码里就是 `renderSlot("main", {}, …)`），
 * 搬到侧栏之后再也拿不到 `conversation.input.right` 注入的 sessionId，
 * 于是「交给会话」会在发送前卡在「拿不到当前会话 id」。
 *
 * 真相在宿主的 workspace 选择里，它持久化在 localStorage 的 `dsh.sessions.current`
 * （实测值：`{"sessionId":"session-b3e22b42-…"}`）。sessions 服务若恰好暴露了当前选择则优先用它。
 */
export function currentSessionId() {
  const sessions = getSessions()
  if (sessions) {
    for (const key of ['currentSessionId', 'current', 'activeSessionId']) {
      try {
        const value = sessions[key]
        const got = typeof value === 'function' ? value.call(sessions) : value
        if (typeof got === 'string' && got !== '') return got
        if (got && typeof got.sessionId === 'string' && got.sessionId !== '') return got.sessionId
        if (got && typeof got.id === 'string' && got.id !== '') return got.id
      } catch { /* 没有这个字段就算了 */ }
    }
  }

  try {
    const raw = globalThis.localStorage?.getItem(CURRENT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.sessionId === 'string' && parsed.sessionId !== '') return parsed.sessionId
    }
  } catch { /* localStorage 不可用就返回 null */ }

  return null
}

const CURRENT_KEY = 'dsh.sessions.current'

/** 直接借已保留的会话作用域发送（会话正开着时走这条） */
async function sendViaScope(sessions, sessionId, text) {
  let scoped
  try {
    scoped = sessions.scope(sessionId)
  } catch (error) {
    return { ok: false, reason: `取会话作用域失败：${String(error?.message ?? error).slice(0, 80)}` }
  }
  if (!scoped) return { ok: false, reason: 'scope-missing' }

  const conversation = typeof scoped.get === 'function' ? scoped.get('conversation') : scoped.conversation
  if (!conversation || typeof conversation.send !== 'function') {
    return { ok: false, reason: '会话作用域里没有 conversation.send' }
  }

  try {
    await conversation.send(text)
    return { ok: true }
  } catch (error) {
    const message = String(error?.message ?? error)
    // 另一个客户端（桌面版 / 网页版）正开着这个会话 → 它持有写句柄
    if (message.includes('writer-held')) return { ok: false, reason: 'writer-held' }
    return { ok: false, reason: `发送失败：${message.slice(0, 120)}` }
  }
}

/**
 * 把一条文本发进会话（默认发往当前打开的会话）。
 *
 * 两条途径：
 * 1. 会话正开着 → `sessions.scope(id)` 直接拿到作用域；
 * 2. 正在看「会记」页面 → 主区域被面板占用，会话作用域可能已释放，
 *    改用 `sessions.using(id, …)` 临时借一个（内部会 retain + open + release）。
 *
 * @param {{sessionId?: string, text: string}} input
 * @returns {Promise<{ok:true, sessionId:string} | {ok:false, reason:string, sessionId?:string}>}
 */
export async function sendToSession({ sessionId, text } = {}) {
  const sessions = getSessions()
  if (!sessions) return { ok: false, reason: '宿主未提供 sessions 服务（探针未通过）' }
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, reason: '消息内容为空' }

  const target = typeof sessionId === 'string' && sessionId !== '' ? sessionId : currentSessionId()
  if (!target) return { ok: false, reason: '拿不到当前会话 id' }

  const direct = await sendViaScope(sessions, target, text)
  if (direct.ok) return { ok: true, sessionId: target }
  if (direct.reason !== 'scope-missing') {
    if (direct.reason === 'writer-held') {
      return { ok: false, reason: '另一个客户端正开着这个会话（写锁被占用），可能同时开了桌面版和网页版', sessionId: target }
    }
    return { ok: false, reason: direct.reason, sessionId: target }
  }

  // 作用域不在，或写句柄被别的客户端占着：
  // 不要用 sessions.using 去「借」——它会 retain 出写句柄，而 conversation.send 还要再开一个，
  // 结果是插件自己和自己抢锁（实测报 session/writer-held）。
  return { ok: false, reason: 'scope-missing', sessionId: target }
}

/** 剪贴板兜底 */
export async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return { ok: true, via: 'clipboard' }
    }
    return { ok: false, reason: '当前环境没有 clipboard API' }
  } catch (error) {
    return { ok: false, reason: `复制失败：${String(error?.message ?? error).slice(0, 60)}` }
  }
}
