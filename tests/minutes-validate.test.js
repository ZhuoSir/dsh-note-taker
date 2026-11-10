import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NO_ACTION_TEXT, validateMinutes } from '../lib/minutes.js'

function buildMinutes({ decisions = '## 决议\n- 下周开始 5% 灰度', actions = '| 负责人 | 事项 | 截止时间 |\n|---|---|---|\n| 张三 | 出灰度方案 | 2026-11-15 |' } = {}) {
  return [
    '# 周会纪要',
    '',
    '> 日期: 2026-11-10 | 时长: 40 分钟',
    '',
    '## 一句话摘要',
    '本周敲定了灰度范围与负责人。',
    '',
    '## 议题',
    '- 灰度范围',
    '',
    decisions,
    '',
    '## 行动项',
    actions,
  ].join('\n')
}

test('七项齐全判合格，无警告', () => {
  const result = validateMinutes(buildMinutes())

  assert.equal(result.ok, true)
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.actionItems, [{ owner: '张三', item: '出灰度方案', deadline: '2026-11-15' }])
})

test('缺「决议」章节判不合格并点名', () => {
  const result = validateMinutes(buildMinutes({ decisions: '## 决议\n' }))

  assert.equal(result.ok, false)
  assert.deepEqual(result.missing, ['决议'])
})

test('行动项表为空但写明「本次无行动项」判合格', () => {
  const result = validateMinutes(buildMinutes({ actions: NO_ACTION_TEXT }))

  assert.equal(result.ok, true)
  assert.deepEqual(result.actionItems, [])
})

test('行动项章节整个为空 → 不合格，点名为空章节', () => {
  const result = validateMinutes(buildMinutes({ actions: '' }))

  assert.equal(result.ok, false)
  assert.deepEqual(result.missing, ['行动项'])
})

test('行动项章节有内容但既无表格也未写说明 → 不合格，给出具体原因', () => {
  const result = validateMinutes(buildMinutes({ actions: '（见附件）' }))

  assert.equal(result.ok, false)
  assert.deepEqual(result.missing, ['行动项（既无表格也未写「本次无行动项」）'])
})

test('行动项缺负责人 → 不算不合格，但列出待补项', () => {
  const actions = '| 负责人 | 事项 | 截止时间 |\n|---|---|---|\n|  | 补灰度方案 | 2026-11-20 |'
  const result = validateMinutes(buildMinutes({ actions }))

  assert.equal(result.ok, true, '缺字段属待补，不是结构缺失')
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /缺负责人/)
  assert.match(result.warnings[0], /补灰度方案/)
})

test('截止时间写「待补」也算待补项', () => {
  const actions = '| 负责人 | 事项 | 截止时间 |\n|---|---|---|\n| 李四 | 对齐口径 | 待补 |'
  const result = validateMinutes(buildMinutes({ actions }))

  assert.equal(result.ok, true)
  assert.match(result.warnings[0], /缺截止时间/)
})

test('空字符串判不合格并列出全部缺失项', () => {
  const result = validateMinutes('')

  assert.equal(result.ok, false)
  assert.equal(result.missing.length, 6)
})

test('缺标题与日期时长也判出来', () => {
  const result = validateMinutes('## 一句话摘要\n摘要内容\n## 议题\n- a\n## 决议\n- b\n## 行动项\n本次无行动项')

  assert.deepEqual(result.missing, ['标题', '日期与时长'])
})

test('纯函数：同样输入两次结果一致，不改动入参', () => {
  const input = buildMinutes()
  const first = validateMinutes(input)
  const second = validateMinutes(input)

  assert.deepEqual(first, second)
  assert.equal(input, buildMinutes(), '入参不应被改写')
})
