import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { after, test } from 'node:test'

import { buildRoutes } from '../lib/routes.js'
import { createService } from '../lib/service.js'
import { parseSidecarStdout } from '../lib/py.js'
import { buildTools } from '../lib/tools.js'
import { pcmToWav } from '../lib/asr/wav.js'

const roots = []
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

const TRANSCRIPT_MD = '# 转写：周会\n\n[00:00:03] 张三：灰度先做 5%。\n'

function loggerSpy() {
  const lines = []
  const push = (level) => (message, fields = {}) => lines.push({ level, message, fields })
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') }
}

async function callRoute(routes, path, { method = 'GET', url = '', body = null } = {}) {
  const route = routes.find((item) => item.path === path)
  assert.ok(route, `路由 ${path} 未注册`)
  const chunks = body ? [Buffer.from(JSON.stringify(body))] : []
  const req = {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  let payload = null
  const res = { statusCode: 0, setHeader() {}, end(text) { payload = JSON.parse(text) } }
  await route.handler(req, res)
  return { status: res.statusCode, payload }
}

/** 假 service：只记录调用，供路由透传断言 */
function spyService() {
  const calls = []
  return {
    calls,
    list: (args) => (calls.push(['list', args]), { ok: true }),
    detail: (args) => (calls.push(['detail', args]), { ok: true }),
    capabilities: () => (calls.push(['capabilities']), { ok: true }),
    readConfig: () => ({ ok: true }),
    saveConfig: () => ({ ok: true }),
    transcribe: (args) => (calls.push(['transcribe', args]), { ok: true, accepted: true }),
    minutes: (args) => (calls.push(['minutes', args]), { ok: true }),
    importAudio: (args) => (calls.push(['importAudio', args]), { ok: true }),
    renameMeeting: (args) => (calls.push(['renameMeeting', args]), { ok: true }),
    live: (args) => (calls.push(['live', args]), { ok: true, data: { state: 'idle' } }),
    recordStart: (args) => (calls.push(['recordStart', args]), { ok: true }),
    recordStop: (args) => (calls.push(['recordStop', args]), { ok: true }),
  }
}

test('record 路由透传 stream 与 sessionId（不传时不伪造）', async () => {
  const service = spyService()
  const routes = buildRoutes({ service, logger: loggerSpy() })

  await callRoute(routes, '/note-taker/record', { method: 'POST', body: { action: 'start', label: 'a', stream: true, sessionId: 'sess:1' } })
  assert.deepEqual(service.calls[0], ['recordStart', { label: 'a', stream: true, sessionId: 'sess:1', workspaceDir: undefined }])

  await callRoute(routes, '/note-taker/record', { method: 'POST', body: { action: 'start', label: 'b' } })
  assert.equal(service.calls[1][1].stream, undefined, '没传 stream 时必须是 undefined，让 service 按配置决定')

  await callRoute(routes, '/note-taker/record', { method: 'POST', body: { action: 'stop', sessionId: 'sess:1' } })
  assert.deepEqual(service.calls[2], ['recordStop', { sessionId: 'sess:1', workspaceDir: undefined }])
})

test('共享面：七个工具仍全部注册，录音工具不需要新参数', () => {
  const tools = buildTools({ service: spyService() })
  assert.equal(tools.length, 7)
  const names = tools.map((tool) => tool.name)
  for (const expected of ['meeting_record_start', 'meeting_record_stop', 'meeting_transcribe', 'meeting_minutes', 'meeting_list', 'meeting_status', 'meeting_import']) {
    assert.ok(names.includes(expected), `工具 ${expected} 不应消失`)
  }
  const start = tools.find((tool) => tool.name === 'meeting_record_start')
  const required = start.parameters?.required ?? start.input?.required ?? []
  assert.ok(!required.includes('stream'), '工具不强制要求 stream 参数（向后兼容）')
})

test('共享面：非流式录音→转写→详情 全链路仍走原路径，产物可读', async () => {
  const root = mkdtempSync(join(tmpdir(), 'note-taker-route-stream-'))
  roots.push(root)

  const python = {
    parseSidecarStdout,
    spawnSidecar(script, args) {
      const outPath = args[args.indexOf('--out') + 1]
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.kill = () => {}
      child.stdin = {
        write() {},
        end() {
          writeFileSync(outPath, pcmToWav(Buffer.alloc(32_000, 3), { sampleRate: 16000 }))
          child.stdout.write(`${JSON.stringify({ ok: true, path: outPath, durationSec: 1, bytes: 32_000, sampleRate: 16000, channels: 1 })}\n`)
          setImmediate(() => child.emit('close', 0))
        },
      }
      setImmediate(() => child.stderr.write('note-taker/record - 录音开始, device=default\n'))
      return child
    },
    runSidecar(script, args) {
      const outDir = args[args.indexOf('--out-dir') + 1]
      const stem = args[args.indexOf('--stem') + 1]
      const mdPath = join(outDir, `${stem}.md`)
      writeFileSync(mdPath, TRANSCRIPT_MD, 'utf8')
      return Promise.resolve({ ok: true, payload: { ok: true, segments: 1, chars: 12, durationSec: 3, rtf: 0.2, mdPath }, exitCode: 0, stderr: '' })
    },
  }

  const source = { name: 'test', get: () => null }
  const config = { root, model: 'tiny', threads: 1, engine: 'local', cloudSource: source, streamOverrides: { enabled: '0' } }
  const service = createService({ config, logger: loggerSpy(), python, llm: { stream: () => (async function* gen() {})() } })
  const routes = buildRoutes({ service, logger: loggerSpy() })

  const started = await callRoute(routes, '/note-taker/record', { method: 'POST', body: { action: 'start', label: '旧路径' } })
  assert.equal(started.payload.ok, true)
  const meetingId = started.payload.meetingId

  const stopped = await callRoute(routes, '/note-taker/record', { method: 'POST', body: { action: 'stop' } })
  assert.equal(stopped.payload.ok, true)
  assert.equal(stopped.payload.stream, undefined, '非流式停录不应出现 stream 字段')
  assert.ok(existsSync(join(root, 'recordings', `${meetingId}.wav`)), 'WAV 必须照常落盘')

  const transcribed = await callRoute(routes, '/note-taker/transcribe', { method: 'POST', body: { id: meetingId } })
  assert.equal(transcribed.payload.ok, true)
  await new Promise((resolve) => setTimeout(resolve, 60))

  const detail = await callRoute(routes, '/note-taker/detail', { url: `/note-taker/detail?id=${meetingId}` })
  assert.equal(detail.payload.ok, true)
  assert.match(detail.payload.transcript ?? '', /灰度先做 5%/)

  const health = await callRoute(routes, '/note-taker/health')
  assert.equal(health.payload.ok, true)
  assert.equal(health.payload.stream.available, false, '没配 Key 时流式不可用')
  assert.equal(health.payload.stream.enabled, false, '缺省不启用流式（R-09）')
})