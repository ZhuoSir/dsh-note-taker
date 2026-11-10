import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { theme, toneColors } from '../src/client/theme.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BUNDLE = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
const SOURCES = ['SettingsPage.jsx', 'QuickPanel.jsx']
  .map((name) => readFileSync(join(ROOT, 'src', 'client', name), 'utf8'))
  .join('\n')

test('所有颜色都来自宿主令牌或带色对象的语义色', () => {
  assert.match(theme.text, /--dsw-alias-label-primary/)
  assert.match(theme.bg, /--dsw-alias-bg-base/)
  assert.match(theme.border, /--dsw-alias-border/)
  assert.match(theme.accentBg, /--dsw-alias-state-info-bg/)
})

test('组件源码不得出现宿主不存在的主题变量', () => {
  // --dsh-elevated-surface 这类想当然的变量名在宿主里不存在，会静默落到 fallback
  assert.doesNotMatch(SOURCES, /--dsh-[a-z-]+(?!-)/, '不要用未经验证的 --dsh-* 变量')
  assert.doesNotMatch(SOURCES, /rgba\(24,24,26/, '不要硬编码近黑背景')
})

test('弹出面板使用令牌背景而不是深色常量', () => {
  assert.match(SOURCES, /background: theme\.bg/)
  assert.doesNotMatch(BUNDLE, /dsh-elevated-surface/)
})

test('状态色按 tone 成对返回', () => {
  for (const tone of ['error', 'ok', 'active', 'muted']) {
    const colors = toneColors(tone)
    assert.ok(colors.color, `${tone} 缺少文字色`)
    assert.ok(colors.borderColor, `${tone} 缺少边框色`)
  }
  assert.notEqual(toneColors('error').color, toneColors('ok').color)
})