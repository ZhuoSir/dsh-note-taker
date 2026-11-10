/**
 * 会记客户端入口。
 *
 * 两个插槽：
 * - settings.section：配置页（模型参数 / 路径 / Key / 引擎 + 历史纪要）
 * - conversation.input.right：会话输入框旁的卡片（录音 → 识别 → 确认 → 交会话）
 *
 * apply 里不能抛错——抛了会连带 web 壳启动失败。
 */

import { SettingsPage } from './SettingsPage.jsx'
import { QuickPanel } from './QuickPanel.jsx'
import { probeHost } from './host.js'

export const name = 'dsh-note-taker'
export const inject = ['slots']

export function apply(ctx) {
  // 探测「能不能往会话发消息」：结果显示在卡片面板底部（T-01）
  try {
    probeHost(ctx, { log: (message) => console.info(message) })
  } catch (error) {
    console.warn('[note-taker] 宿主能力探测失败', error)
  }

  try {
    ctx.slots.inject('settings.section', () => ctx.slots.register(
      { name: 'settings.section', id: 'meeting-page', order: 120, label: '会记' },
      SettingsPage,
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
