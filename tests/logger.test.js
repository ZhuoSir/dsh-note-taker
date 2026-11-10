import assert from 'node:assert/strict'
import { test } from 'node:test'
import { homedir } from 'node:os'

import { createLogger, formatTime, maskPath } from '../lib/logger.js'

function capture(options = {}) {
  const lines = []
  const logger = createLogger({ module: 'note-taker', sink: (line) => lines.push(line), ...options })
  return { logger, lines }
}

test('时间格式为 yyyy-MM-dd HH:mm:ss.SSS', () => {
  assert.match(formatTime(new Date(2026, 10, 10, 11, 55, 15, 915)), /^2026-11-10 11:55:15\.915$/)
  assert.match(formatTime(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/)
})

test('日志行含时间、级别、runId、模块、消息与 k=v 字段', () => {
  const { logger, lines } = capture({ runId: 'run-1' })
  logger.info('插件启动', { tools: 6, rootSource: 'env:NOTE_TAKER_DATA' })

  assert.equal(lines.length, 1)
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} INFO {2}\[run-1\] note-taker - 插件启动, tools=6, rootSource=env:NOTE_TAKER_DATA$/)
})

test('级别文本按规范对齐', () => {
  const { logger, lines } = capture()
  logger.debug('d')
  logger.warn('w')
  logger.error('e')
  assert.match(lines[0], / DEBUG \[-\]/)
  assert.match(lines[1], / WARN {2}\[-\]/)
  assert.match(lines[2], / ERROR \[-\]/)
})

test('路径中的用户目录被脱敏为 <home>', () => {
  const home = homedir()
  const { logger, lines } = capture()
  logger.info('录音结束', { path: `${home}\\note-taker\\a.wav` })

  assert.ok(!lines[0].includes(home), '日志不得包含用户主目录')
  assert.ok(lines[0].includes('<home>'), '应替换为 <home> 占位')
})

test('maskPath 对前后斜杠两种写法都生效', () => {
  const home = homedir()
  assert.equal(maskPath(`${home}/a/b`), '<home>/a/b')
  assert.equal(maskPath(`${home}\\a\\b`), '<home>\\a\\b')
})

test('undefined / null 字段被丢弃，不输出 k=undefined', () => {
  const { logger, lines } = capture()
  logger.info('配置加载', { model: 'small', threads: undefined, firstRun: null })

  assert.ok(!lines[0].includes('undefined'))
  assert.ok(!lines[0].includes('null'))
  assert.match(lines[0], /model=small$/)
})

test('超长值被截断，避免打出大对象', () => {
  const { logger, lines } = capture()
  logger.info('大对象', { blob: 'x'.repeat(500) })

  assert.ok(lines[0].length < 400, `日志行过长: ${lines[0].length}`)
  assert.ok(lines[0].includes('…'))
})

test('消息里残留 {} 占位符直接抛错（防拼错）', () => {
  const { logger } = capture()
  assert.throws(() => logger.info('用户 {} 登录'), /占位符/)
})

test('未指定 module 直接抛错', () => {
  assert.throws(() => createLogger({}), /module/)
})
