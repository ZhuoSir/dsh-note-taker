/**
 * 全局录音状态（CR-02 / R-11）。
 *
 * 为什么单独做一个模块级的共享订阅：
 * - 侧栏图标和「会记」页面都要显示同一份状态，但它们是两棵互不相干的组件树；
 * - 状态属于宿主，不属于会话 —— 切会话、甚至没有会话时，图标都要继续显示「录制中 0:12」；
 * - 只留一个轮询定时器：有订阅者才轮询，订阅者清空就停，避免空转。
 */

import { useEffect, useState } from 'react'
import { createApi } from './api.js'

const POLL_MS = 3000

const api = createApi({})

const listeners = new Set()
let snapshot = { running: false, seconds: 0, meetingId: null, label: '', startedAt: null, streaming: false, interrupted: null }
let timer = null
let inflight = false
let base = { seconds: 0, at: 0 }

function emit(next) {
  snapshot = { ...snapshot, ...next }
  for (const fn of listeners) {
    try { fn(snapshot) } catch { /* 单个订阅者出错不影响其他人 */ }
  }
}

/** 本地补秒：两次轮询之间让计时继续走，避免 3 秒一跳 */
function localSeconds() {
  const drift = base.at ? Math.floor((Date.now() - base.at) / 1000) : 0
  return Math.max(0, (base.seconds || 0) + drift)
}

async function tick() {
  if (inflight) return
  inflight = true
  try {
    const result = await api.recordState()
    if (result?.ok === false) {
      emit({ running: false, seconds: 0, reason: result.code ?? 'E_STATE' })
      return
    }
    const running = result?.running === true
    const seconds = Number.isFinite(result?.seconds) ? result.seconds : 0
    base = { seconds, at: Date.now() }
    emit({
      running,
      seconds,
      meetingId: result?.meetingId ?? null,
      label: result?.label ?? '',
      startedAt: result?.startedAt ?? null,
      streaming: result?.streaming === true,
      interrupted: result?.interrupted ?? null,
    })
  } catch {
    // 轮询失败保持上一次快照，不把「暂时连不上」显示成「没在录」
  } finally {
    inflight = false
  }
}

function startPolling() {
  if (timer) return
  tick()
  timer = setInterval(tick, POLL_MS)
}

function stopPolling() {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

/** 强制立刻刷新一次（点开始/停止录音后调，让图标马上变） */
export function refreshRecordState() {
  return tick()
}

export function subscribeRecordState(fn) {
  listeners.add(fn)
  startPolling()
  fn(snapshot)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) stopPolling()
  }
}

export function getRecordSnapshot() {
  return snapshot
}

/** 组件钩子：running + 逐秒自走的 seconds */
export function useRecordState() {
  const [state, setState] = useState(getRecordSnapshot())
  const [, setTick] = useState(0)

  useEffect(() => subscribeRecordState(setState), [])

  // 录制中每秒重算一次秒数（数据仍以宿主返回的 seconds 为基准）
  useEffect(() => {
    if (!state.running) return undefined
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [state.running])

  return {
    ...state,
    seconds: state.running ? localSeconds() : 0,
  }
}