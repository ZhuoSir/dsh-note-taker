/**
 * 会记客户端（浏览器侧）—— T-01 探针版。
 *
 * 目的：验证两个插槽能否承载真实 UI（设置区页面 + 会话输入框旁按钮）。
 * 探针通过后再往这里填真正的列表/详情/动作。
 *
 * 注意：apply 里不能抛错——抛了会连带 web 壳启动失败（沿用 sessions-manager 的教训）。
 */

import React, { useState } from 'react'

export const name = 'dsh-note-taker'
export const inject = ['slots']

function ProbeSection() {
  const [text, setText] = useState('')
  return React.createElement(
    'div',
    { style: { padding: '12px 2px', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 } },
    React.createElement('h3', { style: { margin: 0, fontSize: 15 } }, '会记 · 探针'),
    React.createElement('p', { style: { margin: 0, opacity: 0.7, fontSize: 13 } },
      '能看到这段文字说明 settings.section 插槽可用。'),
    React.createElement('input', {
      value: text,
      onChange: (event) => setText(event.target.value),
      placeholder: '在这里打字，验证输入框没被遮挡',
      style: { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.35)', background: 'transparent', color: 'inherit' },
    }),
    React.createElement('button', {
      type: 'button',
      onClick: () => setText(`${text} ✓`),
      style: { alignSelf: 'flex-start', padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
    }, '点我追加 ✓'),
    React.createElement('div', { style: { fontSize: 12, opacity: 0.6 } }, `当前值：${text || '(空)'}`),
  )
}

function ProbeButton() {
  const [count, setCount] = useState(0)
  return React.createElement('button', {
    type: 'button',
    onClick: () => setCount(count + 1),
    title: '会记探针按钮',
    style: { padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
  }, count === 0 ? '会记' : `会记 ${count}`)
}

export function apply(ctx) {
  try {
    ctx.slots.inject('settings.section', () => ctx.slots.register(
      { name: 'settings.section', id: 'meeting-page', order: 120, label: '会记' },
      ProbeSection,
    ))
  } catch (error) {
    console.warn('[note-taker] 注册 settings.section 失败', error)
  }

  try {
    ctx.slots.inject('conversation.input.right', function* () {
      yield ctx.slots.register(
        { name: 'conversation.input.right', id: 'meeting-quick', order: 60 },
        ProbeButton,
      )
    })
  } catch (error) {
    console.warn('[note-taker] 注册 conversation.input.right 失败', error)
  }
}
