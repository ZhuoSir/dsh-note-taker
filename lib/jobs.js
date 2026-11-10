/**
 * 串行队列与状态迁移。
 *
 * 本机可用内存只有 3 GB 出头（plan 风险节），所以录音/转写/纪要必须串行：
 * 队列保证同一时刻只有一个重任务在跑，状态迁移保证不会从 done 被悄悄改回 pending。
 *
 * @module dsh-note-taker/jobs
 */

/** 单向状态机：pending → running → done|failed；failed 允许重试回 running */
export const TRANSITIONS = Object.freeze({
  pending: ['running'],
  running: ['done', 'failed'],
  done: [],
  failed: ['running'],
})

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to)
}

export function createQueue() {
  let tail = Promise.resolve()
  let depth = 0

  return {
    get depth() {
      return depth
    },
    /** 排队执行；前一个任务失败不影响后续任务 */
    run(task) {
      depth += 1
      const started = tail.then(task, task)
      tail = started.then(
        () => { depth -= 1 },
        () => { depth -= 1 },
      )
      return started
    },
  }
}

/**
 * 在 store 上做一次带校验的状态迁移。
 * @returns {object} 更新后的会议
 */
export function transition(store, meetingId, field, to, { logger, runId = '-' } = {}) {
  const meeting = store.get(meetingId)
  if (!meeting) throw new Error(`会议不存在: ${meetingId}`)
  const from = meeting.status[field]
  if (!canTransition(from, to)) {
    throw new Error(`非法状态迁移 ${field}: ${from} → ${to}`)
  }
  const updated = store.patch(meetingId, { status: { [field]: to } })
  logger?.info('状态迁移', { meetingId, field, from, to }, runId)
  return updated
}
