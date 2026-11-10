import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CODES, err, isErr, ok } from '../lib/errors.js'

test('错误码集合与 R-07 一致，且被冻结', () => {
  assert.deepEqual(Object.keys(CODES).sort(), ['E_AUDIO', 'E_DEP', 'E_DEVICE', 'E_LLM', 'E_MODEL', 'E_STATE'])
  assert.ok(Object.isFrozen(CODES))
})

test('ok() 产出成功信封并平铺结果字段', () => {
  assert.deepEqual(ok({ meetingId: 'm-1' }), { ok: true, meetingId: 'm-1' })
  assert.deepEqual(ok(), { ok: true })
})

test('err() 产出失败信封', () => {
  assert.deepEqual(err(CODES.E_DEVICE, '默认输入设备不可用', { device: 'none' }), {
    ok: false,
    code: 'E_DEVICE',
    message: '默认输入设备不可用',
    detail: { device: 'none' },
  })
})

test('未知错误码直接抛错（不允许随手造码）', () => {
  assert.throws(() => err('E_PARAM', '参数错误'), /未知错误码/)
})

test('空消息直接抛错', () => {
  assert.throws(() => err(CODES.E_STATE, ''), /错误消息不能为空/)
})

test('detail 中的堆栈与 Error 实例被剔除', () => {
  const result = err(CODES.E_LLM, '模型调用失败', {
    provider: 'deepseek',
    stack: 'at foo (bar.js:1)',
    cause: new Error('boom'),
    code: 'ERR_HTTP',
  })

  assert.deepEqual(result.detail, { provider: 'deepseek', code: 'ERR_HTTP' })
})

test('isErr 只认 ok===false', () => {
  assert.equal(isErr(err(CODES.E_AUDIO, '音频不可读')), true)
  assert.equal(isErr(ok()), false)
  assert.equal(isErr(undefined), false)
})
