/**
 * 「上一场会议」记忆：停止录制后切页面再回来，得能把刚录完那场捡回来。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

// 最小的 localStorage 替身（node 里没有）
const store = new Map()
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)) },
  removeItem: (key) => { store.delete(key) },
}

const { rememberMeeting, getRememberedMeeting, forgetMeeting } = await import('../src/client/lastMeeting.js')

test('记住后能取回同一个会议 id', () => {
  store.clear()
  assert.equal(rememberMeeting('20261112-1309-2625'), true)
  const got = getRememberedMeeting()
  assert.equal(got?.meetingId, '20261112-1309-2625')
  assert.ok(got.at > 0)
})

test('空 id 不记，免得写出无意义的恢复目标', () => {
  store.clear()
  assert.equal(rememberMeeting(''), false)
  assert.equal(rememberMeeting(undefined), false)
  assert.equal(getRememberedMeeting(), null)
})

test('超过 24 小时不再自动恢复', () => {
  store.clear()
  const old = Date.now() - 25 * 60 * 60 * 1000
  store.set('dsh.note-taker.last-meeting', JSON.stringify({ meetingId: '20261110-0000-aaaa', at: old }))
  assert.equal(getRememberedMeeting(), null)
})

test('坏数据不抛错', () => {
  store.clear()
  store.set('dsh.note-taker.last-meeting', '{不是 JSON')
  assert.equal(getRememberedMeeting(), null)
  store.set('dsh.note-taker.last-meeting', JSON.stringify({ meetingId: 42 }))
  assert.equal(getRememberedMeeting(), null)
})

test('忘掉之后取不到', () => {
  store.clear()
  rememberMeeting('20261112-1309-2625')
  forgetMeeting()
  assert.equal(getRememberedMeeting(), null)
})