/**
 * 会记客户端入口。
 *
 * 三个插槽（CR-02 起入口为全局，不再挂在会话输入框上）：
 * - sidebar.panellist：侧栏全局图标行「会记」（与 插件 / 自动化任务 同级，工作区之上）
 * - main（keyed = meeting-panel）：点图标后的全局「会记」页面
 * - settings.section：配置页（模型参数 / 路径 / Key / 引擎 + 历史纪要）
 *
 * apply 里不能抛错——抛了会连带 web 壳启动失败。
 */

import { SettingsPage } from './SettingsPage.jsx'
import { MeetingPanel } from './MeetingPanel.jsx'
import { RecordIcon } from './RecordIcon.jsx'
import { probeHost } from './host.js'

export const name = 'dsh-note-taker'
export const inject = ['slots']

/** 面板 id：sidebar.panellist 的 id 与 main 的 key 必须是同一个 */
const PANEL_ID = 'meeting-panel'

export function apply(ctx) {
  // 探测「能不能往会话发消息」：结果显示在页面底部（T-01）
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

  // 全局页面：必须与 sidebar.panellist 的 id 对应，否则点图标会抛错
  try {
    ctx.slots.inject('main', () => ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        inject: () => ({
          // 有 layout 才能切回会话；没有就退化成「用户自己点会话」（不影响功能）
          close: typeof ctx.layout?.selectPanel === 'function'
            ? () => { try { ctx.layout.selectPanel(null) } catch { /* 切不动就保持当前页 */ } }
            : undefined,
        }),
      },
      MeetingPanel,
    ))
  } catch (error) {
    console.warn('[note-taker] 注册 main 失败', error)
  }

  // 侧栏入口：与 插件（order 0）/ 自动化任务（10）/ 上下文观察（20）同级，排第 4
  try {
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: '会记' },
      RecordIcon,
    ))
  } catch (error) {
    console.warn('[note-taker] 注册 sidebar.panellist 失败', error)
  }
}

// 供测试直接渲染组件（不注册进任何插槽，不影响运行时）
export { QuickPanel } from './QuickPanel.jsx'
export { MeetingPanel } from './MeetingPanel.jsx'
export { RecordIcon } from './RecordIcon.jsx'
