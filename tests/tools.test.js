import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { buildTools } from '../lib/tools.js'

const roots = []
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

function makeTools() {
  // service 用假实现：工具层只负责转发与序列化，不该有业务判断
  const calls = []
  const service = {
    recordStart: (args) => {
      calls.push(['recordStart', args])
      return { ok: true, meetingId: 'm-1' }
    },
    recordStop: () => {
      calls.push(['recordStop'])
      return { ok: false, code: 'E_STATE', message: '当前没有进行中的录音', detail: {} }
    },
    transcribe: (args) => {
      calls.push(['transcribe', args])
      return { ok: true, segments: 3 }
    },
    minutes: (args) => {
      calls.push(['minutes', args])
      return { ok: true, minutesPath: '/tmp/x.md' }
    },
    list: (args) => {
      calls.push(['list', args])
      return { ok: true, meetings: [] }
    },
    status: (args) => {
      calls.push(['status', args])
      return { ok: true, status: {} }
    },
  }
  return { tools: buildTools({ service }), calls }
}

test('注册且只注册六个工具，名字精确匹配', () => {
  const { tools } = makeTools()
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ['meeting_list', 'meeting_minutes', 'meeting_record_start', 'meeting_record_stop', 'meeting_status', 'meeting_transcribe'],
  )
})

test('每个工具都有描述、参数表与 execute，且输出类型为 text', () => {
  const { tools } = makeTools()
  for (const tool of tools) {
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 10, `${tool.name} 描述太短`)
    assert.equal(typeof tool.execute, 'function')
    assert.equal(tool.output.type, 'text', '旧版宿主需要 type')
  assert.equal(typeof tool.output.render, 'function', '新版宿主需要 render')
  assert.deepEqual(tool.output.schema, { type: 'string' })
    assert.equal(typeof tool.parameters, 'object')
  }
})

test('execute 把信封序列化成 JSON 文本', () => {
  const { tools } = makeTools()
  const start = tools.find((tool) => tool.name === 'meeting_record_start')
  const result = start.execute({ label: '周会' })

  assert.equal(typeof result, 'string')
  assert.deepEqual(JSON.parse(result), { ok: true, meetingId: 'm-1' })
})

test('失败也是信封文本，不抛异常', () => {
  const { tools } = makeTools()
  const stop = tools.find((tool) => tool.name === 'meeting_record_stop')
  const parsed = JSON.parse(stop.execute())

  assert.equal(parsed.ok, false)
  assert.equal(parsed.code, 'E_STATE')
})

test('缺省参数按契约填默认值', () => {
  const { tools, calls } = makeTools()

  tools.find((tool) => tool.name === 'meeting_record_start').execute()
  tools.find((tool) => tool.name === 'meeting_list').execute()
  tools.find((tool) => tool.name === 'meeting_minutes').execute({})

  assert.deepEqual(calls[0], ['recordStart', { label: '' }])
  assert.deepEqual(calls[1], ['list', { limit: 20 }])
  assert.deepEqual(calls[2], ['minutes', { meetingId: undefined, force: false }])
})

test('显式传参与布尔值不被吞掉', () => {
  const { tools, calls } = makeTools()

  tools.find((tool) => tool.name === 'meeting_minutes').execute({ meetingId: 'm-9', force: true })
  tools.find((tool) => tool.name === 'meeting_transcribe').execute({ meetingId: 'm-9', model: 'small', engine: 'cloud' })

  assert.deepEqual(calls[0], ['minutes', { meetingId: 'm-9', force: true }])
  assert.deepEqual(calls[1], ['transcribe', { meetingId: 'm-9', model: 'small', engine: 'cloud' }])
})
