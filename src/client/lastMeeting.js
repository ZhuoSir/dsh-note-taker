/**
 * 「上一场会议」记忆。
 *
 * 修的问题（用户反馈）：停止录制、等识别出结果后切到别的页面，再回到会记，
 * 刚录完的那场就找不到了 —— 因为会议 id / 转写内容只存在组件 state 里，
 * 页面一卸载就归零，回来只能是「空闲 + 开始录音」。
 *
 * 这里只记 id（真身在宿主里，回来用 /detail 重新取），放 localStorage 让刷新也还在；
 * 超过 MAX_AGE_MS 就不再自动恢复，免得每次进页面都翻出一场老会。
 */

const KEY = 'dsh.note-taker.last-meeting'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export function rememberMeeting(meetingId) {
  if (typeof meetingId !== 'string' || meetingId === '') return false
  try {
    const storage = globalThis.localStorage
    if (!storage) return false
    storage.setItem(KEY, JSON.stringify({ meetingId, at: Date.now() }))
    return true
  } catch {
    return false
  }
}

export function getRememberedMeeting() {
  try {
    const storage = globalThis.localStorage
    if (!storage) return null
    const raw = storage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.meetingId !== 'string' || parsed.meetingId === '') return null
    if (Number.isFinite(parsed.at) && Date.now() - parsed.at > MAX_AGE_MS) return null
    return { meetingId: parsed.meetingId, at: Number.isFinite(parsed.at) ? parsed.at : null }
  } catch {
    return null
  }
}

export function forgetMeeting() {
  try {
    const storage = globalThis.localStorage
    if (storage) storage.removeItem(KEY)
  } catch {
    /* 清不掉也无所谓，最多下次多恢复一次 */
  }
}