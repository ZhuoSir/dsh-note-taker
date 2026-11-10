/**
 * 宿主能力探针（T-01 / T-02）。
 *
 * 目的：搞清楚「往当前会话发消息」到底能不能用——这是本 spec 唯一没被证实的假设。
 * 结果会显示在会话卡片面板底部，让人一眼看到当前走的是哪一档：
 *
 *   自动发送（conversation.send）  →  填入输入框  →  复制文本
 *
 * 这个模块不 import React，可在 node 下单测。
 *
 * @module dsh-note-taker/client/host
 */

const state = {
  /** 'unknown' | 'available' | 'unavailable' */
  conversation: 'unknown',
  /** 拿到的服务实例（available 时非空） */
  instance: null,
  /** 拿到的途径：direct / inject / none */
  via: 'none',
  /** 不可用时的原因（给用户看的一句话） */
  reason: '尚未探测',
  /** 探测时间，便于判断是否过期 */
  probedAt: null,
}

export function getHostStatus() {
  return { ...state }
}

export function resetHostStatus() {
  state.conversation = 'unknown'
  state.instance = null
  state.via = 'none'
  state.reason = '尚未探测'
  state.probedAt = null
}

export function getConversation() {
  return state.instance
}

function markAvailable(instance, via) {
  state.conversation = 'available'
  state.instance = instance
  state.via = via
  state.reason = ''
  state.probedAt = new Date().toISOString()
}

function markUnavailable(reason, via = 'none') {
  state.conversation = 'unavailable'
  state.instance = null
  state.via = via
  state.reason = reason
  state.probedAt = new Date().toISOString()
}

/**
 * 探测宿主能力。绝不抛错（apply 里抛错会连带 web 壳起不来）。
 * @param {object} ctx 插件上下文
 * @param {{log?: Function}} [options]
 */
export function probeHost(ctx, { log } = {}) {
  const say = log ?? (() => {})

  // 途径 1：直接取。未声明注入时宿主可能直接抛错——把错误本身当成诊断信息
  try {
    const direct = (typeof ctx?.get === 'function' ? ctx.get('conversation') : undefined) ?? ctx?.conversation
    if (direct && typeof direct.send === 'function') {
      markAvailable(direct, 'direct')
      say('[note-taker] 交接能力：自动发送可用（direct）')
      return getHostStatus()
    }
    markUnavailable('conversation 服务存在但没有 send 方法', 'direct')
  } catch (error) {
    markUnavailable(`直接取失败：${String(error?.message ?? error).slice(0, 80)}`, 'direct')
  }

  // 途径 2：可选注入（拿得到才会回调）
  try {
    if (typeof ctx?.inject === 'function') {
      ctx.inject(['conversation'], (inner) => {
        const instance = inner?.conversation ?? inner?.get?.('conversation')
        if (instance && typeof instance.send === 'function') {
          markAvailable(instance, 'inject')
          say('[note-taker] 交接能力：自动发送可用（inject）')
        } else {
          markUnavailable('注入成功但没有 send 方法', 'inject')
          say('[note-taker] 交接能力：注入后仍无 send，走兜底')
        }
      })
    } else {
      markUnavailable('宿主上下文没有 inject，无法取得 conversation', 'none')
    }
  } catch (error) {
    markUnavailable(`注入失败：${String(error?.message ?? error).slice(0, 80)}`, 'inject')
    say(`[note-taker] 交接能力探测失败：${String(error?.message ?? error).slice(0, 80)}`)
  }

  return getHostStatus()
}

/** 给界面看的一句话结论 */
export function hostStatusText(status = getHostStatus()) {
  if (status.conversation === 'available') return `会话发送：可用（${status.via}）`
  if (status.conversation === 'unavailable') return `会话发送：不可用（${status.reason}）`
  return '会话发送：尚未探测'
}

/** 剪贴板兜底是否可用（T-02） */
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
