/**
 * 会记客户端入口。
 *
 * 两个插槽：
 * - settings.section：完整页面（列表 / 详情 / 动作 / 轮询）
 * - conversation.input.right：会话输入框旁的快捷面板（录音起停 + 最近 3 场）
 *
 * apply 里不能抛错——抛了会连带 web 壳启动失败。
 */

import { MeetingPage } from './MeetingPage.jsx'
import { QuickPanel } from './QuickPanel.jsx'

export const name = 'dsh-note-taker'
export const inject = ['slots']

export function apply(ctx) {
  try {
    ctx.slots.inject('settings.section', () => ctx.slots.register(
      { name: 'settings.section', id: 'meeting-page', order: 120, label: '会记' },
      MeetingPage,
    ))
  } catch (error) {
    console.warn('[note-taker] 注册 settings.section 失败', error)
  }

  try {
    ctx.slots.inject('conversation.input.right', function* () {
      yield ctx.slots.register(
        { name: 'conversation.input.right', id: 'meeting-quick', order: 60 },
        QuickPanel,
      )
    })
  } catch (error) {
    console.warn('[note-taker] 注册 conversation.input.right 失败', error)
  }
}
