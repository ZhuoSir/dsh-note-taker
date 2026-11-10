import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { after, test } from 'node:test'

import { PRIVACY_NOTICE, createService } from '../lib/service.js'
import { parseSidecarStdout } from '../lib/py.js'

const roots = []
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

const GOOD_MINUTES = `# 周会纪要

> 日期: 2026-11-10 | 时长: 1 分钟

## 一句话摘要
定了灰度范围。

## 议题
- 灰度

## 决议
- 下周 5% 灰度

## 行动项
| 负责人 | 事项 | 截止时间 |
|---|---|---|
| 张三 | 出方案 | 2026-11-15 |
`

const BAD_MINUTES = `# 周会纪要

> 日期: 2026-11-10 | 时长: 1 分钟

## 一句话摘要
缺决议。

## 议题
- 灰度

## 行动项
本次无行动项
`

const TRANSCRIPT_MD = '# 转写：周会\n\n[00:00:05] 张三：灰度先做 5%。\n[00:00:12] 李四：我出方案。\n'

function createLoggerSpy() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') }
}

/** 假的录音子进程：收到 stop 就写一个 1 秒静音 wav 并回一行 JSON */
function fakeRecordChild(outPath) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => {}
  child.stdin = {
    write() {},
    end() {
      writeFileSync(outPath, Buffer.alloc(44 + 32000))
      child.stdout.write(`${JSON.stringify({ ok: true, path: outPath, durationSec: 1, bytes: 32000, sampleRate: 16000, channels: 1 })}\n`)
      setImmediate(() => child.emit('close', 0))
    },
  }
  setImmediate(() => child.stderr.write('note-taker/record - 录音开始, device=default, sampleRate=16000\n'))
  return child
}

function makeContext({ minutes = GOOD_MINUTES, transcribeOk = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'note-taker-svc-'))
  roots.push(root)

  const python = {
    parseSidecarStdout,
    spawnSidecar(script, args) {
      const outIndex = args.indexOf('--out')
      return fakeRecordChild(outIndex >= 0 ? args[outIndex + 1] : join(root, 'x.wav'))
    },
    runSidecar(script, args) {
      const outDir = args[args.indexOf('--out-dir') + 1]
      const stem = args[args.indexOf('--stem') + 1]
      if (!transcribeOk) {
        return Promise.resolve({ ok: false, payload: { ok: false, code: 'E_MODEL', message: '模型不可用' }, exitCode: 1, stderr: 'boom' })
      }
      const mdPath = join(outDir, `${stem}.md`)
      writeFileSync(mdPath, TRANSCRIPT_MD, 'utf8')
      return Promise.resolve({
        ok: true,
        payload: { ok: true, segments: 2, chars: 24, durationSec: 12, rtf: 0.2, mdPath },
        exitCode: 0,
        stderr: '',
      })
    },
  }

  const llm = {
    stream: () => {
      const chunks = [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: minutes },
        { type: 'finish', reason: { kind: 'stop' } },
      ]
      return (async function* gen() {
        for (const chunk of chunks) yield chunk
      })()
    },
  }

  const logger = createLoggerSpy()
  const config = { root, model: 'tiny', threads: 2, llmProvider: null, llmModel: null }
  const service = createService({ config, logger, llm, python })
  return { service, logger, root, config }
}

test('未录音时停止录音 → E_STATE', async () => {
  const { service } = makeContext()
  const result = await service.recordStop()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_STATE')
})

test('录音起停：状态迁移、音频落盘、sha256 与时长写入索引', async () => {
  const { service, logger, root } = makeContext()

  const started = await service.recordStart({ label: '周会' })
  assert.equal(started.ok, true)
  assert.ok(logger.lines.some((line) => line.message === '录音开始'))

  const stopped = await service.recordStop()
  assert.equal(stopped.ok, true)
  assert.equal(stopped.durationSec, 1)
  assert.ok(existsSync(stopped.audioPath))

  const meeting = service.store.get(stopped.meetingId)
  assert.equal(meeting.status.record, 'done')
  assert.match(meeting.audio.sha256, /^[0-9a-f]{64}$/)
  assert.ok(meeting.audio.path.startsWith(root))

  assert.ok(logger.lines.some((line) => line.message === '录音结束'))
  assert.ok(logger.lines.some((line) => line.message === '状态迁移' && line.fields.to === 'done'))
})

test('未转写就求纪要 → E_STATE', async () => {
  const { service } = makeContext()
  const started = await service.recordStart({})
  await service.recordStop()
  const result = await service.minutes({ meetingId: started.meetingId })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_STATE')
})

test('转写：成功后写回统计并置 done', async () => {
  const { service, logger } = makeContext()
  const started = await service.recordStart({ label: '周会' })
  await service.recordStop()

  const result = await service.transcribe({ meetingId: started.meetingId, model: 'tiny' })
  assert.equal(result.ok, true)
  assert.equal(result.segments, 2)
  assert.equal(result.stats.segments, 2, '统计应从 md 重新解析得出')

  const meeting = service.store.get(started.meetingId)
  assert.equal(meeting.status.transcribe, 'done')
  assert.ok(logger.lines.some((line) => line.message === '转写结束'))
})

test('转写失败：状态 failed 且错误写进索引', async () => {
  const { service } = makeContext({ transcribeOk: false })
  const started = await service.recordStart({})
  await service.recordStop()

  const result = await service.transcribe({ meetingId: started.meetingId })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_MODEL')

  const meeting = service.store.get(started.meetingId)
  assert.equal(meeting.status.transcribe, 'failed')
  assert.match(meeting.errors.transcribe, /模型不可用/)
})

test('不支持的模型档位 → E_STATE 且指名字段', async () => {
  const { service } = makeContext()
  const started = await service.recordStart({})
  await service.recordStop()

  const result = await service.transcribe({ meetingId: started.meetingId, model: 'large-v3' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_STATE')
  assert.equal(result.detail.field, 'model')
})

test('纪要成功：落盘、状态 done、首次调用带隐私提示', async () => {
  const { service, logger, root } = makeContext()
  const started = await service.recordStart({})
  await service.recordStop()
  await service.transcribe({ meetingId: started.meetingId })

  const result = await service.minutes({ meetingId: started.meetingId })
  assert.equal(result.ok, true)
  assert.equal(result.notice, PRIVACY_NOTICE)
  assert.ok(existsSync(result.minutesPath))
  assert.ok(result.minutesPath.startsWith(join(root, 'minutes')))
  assert.equal(service.store.get(started.meetingId).status.minutes, 'done')

  assert.ok(logger.lines.some((line) => line.message === '隐私提示首次触发'))
  assert.ok(logger.lines.some((line) => line.message === '纪要生成结束'))

  const again = await service.minutes({ meetingId: started.meetingId })
  assert.equal(again.cached, true)
  assert.equal(again.notice, null, '提示只出现一次')
})

test('纪要结构不合格：不落盘并置 failed', async () => {
  const { service, root } = makeContext({ minutes: BAD_MINUTES })
  const started = await service.recordStart({})
  await service.recordStop()
  await service.transcribe({ meetingId: started.meetingId })

  const result = await service.minutes({ meetingId: started.meetingId })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_STATE')
  assert.ok(!existsSync(join(root, 'minutes', `${started.meetingId}.md`)), '不合格不得落盘')
  assert.equal(service.store.get(started.meetingId).status.minutes, 'failed')
})

test('list 参数校验与结果排序', async () => {
  const { service } = makeContext()
  assert.equal(service.list({ limit: 0 }).code, 'E_STATE')
  assert.equal(service.list({ limit: 101 }).detail.field, 'limit')

  const started = await service.recordStart({ label: '第一个' })
  await service.recordStop()
  const listed = service.list({ limit: 10 })
  assert.equal(listed.ok, true)
  assert.equal(listed.meetings[0].id, started.meetingId)
})

test('status：未知会议返回 E_STATE', () => {
  const { service } = makeContext()
  assert.equal(service.status({ meetingId: 'nope' }).code, 'E_STATE')
  assert.equal(service.status({}).detail.field, 'meetingId')
})

test('录音并发：第二次 start 被拒', async () => {
  const { service } = makeContext()
  await service.recordStart({})
  const second = await service.recordStart({})
  assert.equal(second.ok, false)
  assert.equal(second.code, 'E_STATE')
  await service.recordStop()
})
