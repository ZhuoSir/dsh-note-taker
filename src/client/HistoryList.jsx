/**
 * 会记页面的「历史纪要」区块（CR-03）。
 *
 * 从 设置 → 会记 搬过来：用户录完、要找上一场，人就在会记页面，
 * 不该先跳设置再翻标签。
 *
 * 与搬运前的一处刻意差异：**所有会议都列**，不再用 `hasMinutes` 过滤。
 * 只列有纪要的，会让「刚录完还没生成纪要」的会议从列表里消失——
 * 正是用户 2026-11-12 反馈「刚录的那场找不到」的一类情形。
 *
 * 本组件只负责渲染，数据由 QuickPanel 取：保持纯展示，方便单测。
 */
import { createElement } from 'react'
import { paginateTranscript } from './logic.js'
import { theme } from './theme.js'

const styles = {
  card: {
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    background: theme.bg,
  },
  title: { fontSize: 13, fontWeight: 600 },
  muted: { fontSize: 11, color: theme.textMuted },
  row: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 6px',
    borderRadius: 6,
    cursor: 'pointer',
    border: '1px solid transparent',
  },
  itemOpen: { background: theme.accentBg, border: `1px solid ${theme.border}` },
  time: { fontSize: 12, minWidth: 108 },
  duration: { fontSize: 11, color: theme.textMuted, minWidth: 52 },
  badge: (tone) => {
    const color = tone === 'ok' ? theme.success : tone === 'error' ? theme.danger : tone === 'active' ? theme.accent : theme.textMuted
    return {
      fontSize: 10,
      padding: '1px 6px',
      borderRadius: 999,
      border: `1px solid ${color}`,
      color,
      whiteSpace: 'nowrap',
    }
  },
  btn: {
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 6,
    border: `1px solid ${theme.border}`,
    background: 'transparent',
    color: theme.text,
    cursor: 'pointer',
  },
  pre: {
    margin: 0,
    maxHeight: 260,
    overflow: 'auto',
    fontSize: 11,
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    background: theme.bgHover,
    padding: 8,
    borderRadius: 6,
  },
  mini: {
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 999,
    border: `1px solid ${theme.accentBorder ?? theme.accent}`,
    background: 'transparent',
    color: theme.accent,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  miniOff: {
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 999,
    border: `1px solid ${theme.border}`,
    background: 'transparent',
    color: theme.textMuted,
    cursor: 'not-allowed',
    whiteSpace: 'nowrap',
  },
  error: { fontSize: 11, color: theme.danger },
}

/** 一场会议在列表里显示成什么状态 */
export function historyBadge(row) {
  if (row?.minutes?.status === 'done' || row?.hasMinutes === true) return { text: '已生成纪要', tone: 'ok' }
  if (row?.transcribe?.status === 'failed') return { text: '识别失败', tone: 'error' }
  // 录音进程被杀掉时转写通常还停在 pending，先报「录音中断」更有用
  if (row?.record?.status === 'interrupted') return { text: '录音中断', tone: 'error' }
  if (row?.transcribe?.status === 'running' || row?.transcribe?.status === 'pending') return { text: '识别中', tone: 'active' }
  if (row?.transcribe?.status === 'done') return { text: '仅转写', tone: 'muted' }
  return { text: '仅录音', tone: 'muted' }
}

/**
 * 这行能不能「生成纪要」：得有转写；已经有纪要就不用再生成。
 * 生成方式与正常流程一致 —— 把转写发给当前会话，让会话里的 agent 生成并写回。
 */
export function minutesAction(row) {
  if (row?.minutes?.status === 'done' || row?.hasMinutes === true) return { enabled: false, reason: '已有纪要' }
  if (row?.transcribe?.status === 'done') return { enabled: true, reason: '' }
  if (row?.record?.status === 'interrupted') return { enabled: false, reason: '录音中断，没有转写' }
  if (row?.transcribe?.status === 'failed') return { enabled: false, reason: '识别失败，先重试识别' }
  return { enabled: false, reason: '等识别完成后才能生成' }
}

export default function HistoryList({
  rows = [], openedId = null, openedTitle = '', openedText = '', showAll = false,
  truncated = false, remaining = 0, error = null, limit = 20,
  generatingId = null, onOpen, onShowAll, onGenerate,
}) {
  const shown = rows.slice(0, limit)
  const hidden = rows.length - shown.length

  return createElement('div', { style: styles.card },
    createElement('div', { style: styles.row },
      createElement('span', { style: styles.title }, `历史纪要（${rows.length}）`),
      createElement('span', { style: styles.muted }, '点一行看正文'),
    ),

    error ? createElement('div', { style: styles.error }, error) : null,

    rows.length === 0
      ? createElement('div', { style: styles.muted }, '还没有会议。录一场之后这里会出现。')
      : createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          shown.map((row) => {
            const badge = historyBadge(row)
            const open = row.id === openedId
            return createElement('div', {
              key: row.id,
              role: 'button',
              tabIndex: 0,
              'aria-expanded': open,
              title: row.label,
              style: open ? { ...styles.item, ...styles.itemOpen } : styles.item,
              onClick: () => onOpen?.(row.id),
              onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen?.(row.id) } },
            },
              createElement('span', { style: styles.time }, row.startedText),
              createElement('span', { style: styles.duration }, row.durationText),
              createElement('span', { style: styles.badge(badge.tone) }, badge.text),
              createElement('span', { style: { ...styles.muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.rawLabel || ''),
              (() => {
                const action = minutesAction(row)
                // 已经有纪要的行不必再给按钮，避免「点了会不会覆盖」的顾虑
                if (action.reason === '已有纪要') return null
                const busy = generatingId === row.id
                const off = !action.enabled || busy || generatingId !== null
                return createElement('button', {
                  type: 'button',
                  style: off ? styles.miniOff : styles.mini,
                  disabled: off,
                  title: action.enabled ? '把这场转写发到当前会话，由会话生成纪要' : action.reason,
                  onClick: (event) => { event.stopPropagation(); if (!off) onGenerate?.(row) },
                }, busy ? '发送中…' : '生成纪要')
              })(),
            )
          }),
        ),

    hidden > 0
      ? createElement('div', null,
          createElement('button', { type: 'button', style: styles.btn, onClick: () => onShowAll?.('more') },
            `展开更多（还有 ${hidden} 场）`),
        )
      : null,

    openedId
      ? createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 } },
          createElement('div', { style: styles.row },
            createElement('span', { style: styles.title }, openedTitle || openedId),
            createElement('button', { type: 'button', style: styles.btn, onClick: () => onOpen?.(openedId) }, '收起'),
          ),
          openedText
            ? createElement('div', null,
                createElement('pre', { style: styles.pre }, paginateTranscript(openedText, { showAll }).lines.join('\n')),
                paginateTranscript(openedText, { showAll }).truncated
                  ? createElement('button', { type: 'button', style: styles.btn, onClick: () => onShowAll?.('text') },
                      `展开剩余 ${paginateTranscript(openedText, { showAll }).remaining} 行`)
                  : null,
              )
            : createElement('div', { style: styles.muted }, '这场会议还没有纪要，也没有转写正文'),
        )
      : null,
  )
}