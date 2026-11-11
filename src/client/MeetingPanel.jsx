/**
 * 全局「会记」页面（main keyed slot，与 sidebar.panellist 同 id）。
 *
 * 为什么是页面而不是输入框旁的卡片（CR-02）：
 * 录音是宿主级行为，不属于某个会话。挂在 conversation.input.right 上时，
 * 切会话、空会话被回收都会让控制点消失，还会压住输入区。
 * 挂到 root 作用域后：任何会话、甚至没有会话时都能开始/停止录音。
 */

import { createElement } from 'react'
import { theme } from './theme.js'
import { QuickPanel } from './QuickPanel.jsx'
import { useRecordState } from './recordState.js'

const styles = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
    background: theme.bg, color: theme.text, fontFamily: theme.font,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10, flex: 'none',
    padding: '14px 24px', borderBottom: `1px solid ${theme.border}`,
  },
  title: { fontSize: 14, fontWeight: 600 },
  badge: (tone) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: 11, color: tone === 'recording' ? theme.success : theme.textMuted,
    fontVariantNumeric: 'tabular-nums',
  }),
  dot: (tone) => ({
    width: 7, height: 7, borderRadius: 999, flex: 'none',
    background: tone === 'recording' ? theme.success : theme.textMuted,
  }),
  spacer: { flex: 1 },
  body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
}

/**
 * @param {object} props
 * @param {() => void} [props.close] 由注册处注入：切回会话（selectPanel(null)）
 */
export function MeetingPanel({ close } = {}) {
  const { running, seconds, label } = useRecordState()
  const tone = running ? 'recording' : 'idle'

  return createElement('div', { style: styles.root },
    createElement('div', { style: styles.header },
      createElement('span', { style: styles.title }, '会记'),
      createElement('span', { style: styles.badge(tone) },
        createElement('span', { style: styles.dot(tone), 'aria-hidden': 'true' }),
        running ? `录制中 ${formatClock(seconds)}${label ? ` · ${label}` : ''}` : '空闲',
      ),
      createElement('span', { style: styles.spacer }),
      typeof close === 'function'
        ? createElement('button', {
            type: 'button',
            onClick: close,
            style: {
              padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
              border: `1px solid ${theme.border}`, background: 'transparent',
              color: theme.textSecondary, fontFamily: 'inherit',
            },
          }, '返回会话')
        : null,
    ),
    createElement('div', { style: styles.body }, createElement(QuickPanel, { page: true })),
  )
}

function formatClock(totalSec) {
  const sec = Math.max(0, Math.floor(Number(totalSec) || 0))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}