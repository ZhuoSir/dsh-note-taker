/**
 * 侧栏「会记」图标（sidebar.panellist）。
 *
 * 宿主约定：图标组件收到 `{ size, active }`，size 展开态 16、折叠态 18。
 * 录制中在图形旁补一个 mm:ss —— 折叠态（size 18）不加文字，避免把侧栏图标撑歪。
 *
 * 状态来自 recordState 的共享订阅：录音属于宿主，切会话/换页面都不影响这里的显示。
 */

import { createElement } from 'react'
import { theme } from './theme.js'
import { useRecordState } from './recordState.js'
import { formatDuration } from './logic.js'

export function RecordIcon({ size = 18 } = {}) {
  const { running, seconds } = useRecordState()
  const box = typeof size === 'number' ? size : 18
  const color = running ? theme.success : theme.textMuted

  const glyph = createElement(
    'svg',
    {
      width: box, height: box, viewBox: '0 0 16 16', 'aria-hidden': 'true',
      style: { display: 'block', flex: 'none' },
    },
    // 外圈：麦克风轮廓的极简版（模拟 "会记" 的圆点 + 环）
    createElement('circle', { cx: 8, cy: 8, r: 6.4, fill: 'none', stroke: color, strokeWidth: 1.4, opacity: running ? 0.75 : 0.55 }),
    createElement('circle', { cx: 8, cy: 8, r: running ? 3.4 : 2.6, fill: color }),
  )

  // 折叠态只有图标位（18px），不塞文字
  if (!running || box > 16) return glyph

  return createElement('span', {
    style: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  },
    glyph,
    createElement('span', {
      style: {
        fontSize: 10, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
        color: theme.success, whiteSpace: 'nowrap',
      },
    }, formatDuration(seconds)),
  )
}