/**
 * 流式字幕的实时快照登记处（只放内存，不落盘）。
 *
 * 为什么单独一个模块：卡片 500ms 轮询拿到的必须是**服务端持有**的状态（L-15 的教训——
 * 展示值不能由前端另算一份），但 service.js 已经很大，所以把「当前这场录音的字幕长什么样」
 * 抽成无副作用的登记处，由 service 在流式会话上挂/更新/摘除。
 *
 * @module dsh-note-taker/live
 */

export const LIVE_IDLE = 'idle'

function idlePayload(meetingId) {
  return {
    meetingId: meetingId ?? null,
    state: LIVE_IDLE,
    elapsedSec: 0,
    audioSecondsSent: 0,
    chars: 0,
    partial: '',
    finals: [],
    error: null,
    degradedReason: null,
    engine: null,
  }
}

const round1 = (value) => Math.round(value * 10) / 10

/**
 * @param {object} [options]
 * @param {Function} [options.now] 测试注入时钟
 */
export function createLiveRegistry({ now = () => Date.now() } = {}) {
  let current = null

  function attach(meetingId, { engine = null, startedAt = now() } = {}) {
    current = {
      meetingId,
      engine,
      startedAt,
      elapsedSec: 0,
      snapshot: { state: 'connecting', audioSecondsSent: 0, chars: 0, partial: '', finals: [], error: null, degradedReason: null },
    }
    return snapshotFor(meetingId)
  }

  function update(meetingId, snapshot = {}) {
    if (!current || current.meetingId !== meetingId) return false
    current.snapshot = {
      ...current.snapshot,
      ...snapshot,
      finals: Array.isArray(snapshot.finals) ? snapshot.finals.map((item) => ({ startSec: item.startSec, endSec: item.endSec, text: item.text })) : current.snapshot.finals,
    }
    if (isActive(current.snapshot.state)) current.elapsedSec = round1((now() - current.startedAt) / 1000)
    return true
  }

  function detach(meetingId) {
    if (!current) return false
    if (meetingId && current.meetingId !== meetingId) return false
    current = null
    return true
  }

  function snapshotFor(meetingId) {
    if (!current || current.meetingId !== meetingId) return idlePayload(meetingId ?? null)
    if (isActive(current.snapshot.state)) current.elapsedSec = round1((now() - current.startedAt) / 1000)
    return {
      meetingId: current.meetingId,
      ...current.snapshot,
      elapsedSec: current.elapsedSec,
      engine: current.engine,
    }
  }

  return {
    attach,
    update,
    detach,
    snapshotFor,
    get meetingId() {
      return current?.meetingId ?? null
    },
  }
}

function isActive(state) {
  return state === 'connecting' || state === 'streaming' || state === 'finalizing'
}