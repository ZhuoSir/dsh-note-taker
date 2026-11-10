/**
 * 页面配色：只用宿主自己的设计令牌（--dsw-alias-*），不硬编码颜色。
 *
 * 教训：写死深色背景 + 继承文字，在浅色主题下就是「一片黑，什么也看不清」；
 * `--dsh-elevated-surface` 这类想当然的变量名在宿主里根本不存在，会静默落到 fallback。
 * 这里每个令牌都带一个中性 fallback，且成对使用（背景用 bg-*，文字用 label-*）。
 *
 * @module dsh-note-taker/client/theme
 */

export const theme = {
  text: 'var(--dsw-alias-label-primary, #1f2023)',
  textSecondary: 'var(--dsw-alias-label-secondary, #55575c)',
  textMuted: 'var(--dsw-alias-label-tertiary, #8a8d93)',

  bg: 'var(--dsw-alias-bg-base, #ffffff)',
  bgHover: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))',

  border: 'var(--dsw-alias-border-default, rgba(127,127,127,0.32))',
  borderSoft: 'var(--dsw-alias-border-l3, rgba(127,127,127,0.18))',

  accent: 'var(--dsw-alias-state-business-primary, #3b82f6)',
  accentBg: 'var(--dsw-alias-state-info-bg, rgba(59,130,246,0.12))',
  accentBorder: 'var(--dsw-alias-state-info-border, rgba(59,130,246,0.45))',

  danger: '#e5484d',
  dangerBg: 'rgba(229,72,77,0.12)',
  dangerBorder: 'var(--dsw-alias-state-danger-border, rgba(229,72,77,0.45))',

  success: '#2f9e63',
  successBg: 'rgba(47,158,99,0.12)',
  successBorder: 'rgba(47,158,99,0.45)',

  font: 'var(--dsw-font-family, inherit)',
  mono: 'ui-monospace, SFMono-Regular, Consolas, monospace',
}

/** 状态色调 → 成对的文字/边框色 */
export function toneColors(tone) {
  if (tone === 'error') return { color: theme.danger, borderColor: theme.dangerBorder, background: theme.dangerBg }
  if (tone === 'ok') return { color: theme.success, borderColor: theme.successBorder, background: theme.successBg }
  if (tone === 'active') return { color: theme.accent, borderColor: theme.accentBorder, background: theme.accentBg }
  return { color: theme.textSecondary, borderColor: theme.border, background: 'transparent' }
}
