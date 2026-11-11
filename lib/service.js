/**
 * 会记的编排层：把「录音 → 转写 → 纪要」串起来，对外只吐统一信封。
 *
 * 纪律：
 * - 所有方法都返回信封，不向调用方抛异常（R-07）
 * - 重任务进串行队列（lib/jobs.js），状态迁移单向（lib/jobs.js）
 * - 纪要生成会把转写文本发给已配置模型，首次调用必须显式提示（R-08）
 * - 校验不通过就**不落盘**（R-06）
 *
 * @module dsh-note-taker/service
 */

import { createHash } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'

import { CODES, err, ok } from './errors.js'
import { createQueue, transition } from './jobs.js'
import { createLlmClient } from './llm.js'
import { createLiveRegistry } from './live.js'
import { createStore } from './meetings.js'
import { generateMinutes } from './minutes.js'
import { parseTranscript } from './parse.js'
import * as defaultPy from './py.js'
import { aggregateHttpPayload } from './asr/aggregate.js'
import { mergeSegments, splitPcm } from './asr/chunk.js'
import { CLOUD_DEFAULTS, ENV as CLOUD_ENV, createEnvSource, resolveCloudAsrConfig, resolveDefaultEngine, resolveStreamConfig } from './asr/config.js'
import { createStreamSession } from './asr/stream.js'
import { createSettingsSource, maskSettings, mergeSettings, readSettingsFile, saveSettings } from './settings.js'
import { checkSize, deriveLabel, missingPathHint, pickExtension } from './import.js'
import { extractMinutes, extractTranscript, mergeMinutes, renderProduct, resolveProductPaths } from './output.js'
import { recognizeWithHttp } from './asr/http.js'
import { decodeToPcm } from './asr/pcm.js'
import { pcmToWav } from './asr/wav.js'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

export const PRIVACY_NOTICE = '纪要生成会把转写文本发送给 DSH 中已配置的模型服务；音频与转写本身不离开本机。'
export const CLOUD_NOTICE = '云端转写会把音频上传至阿里云百炼（DashScope）进行识别；音频与识别结果不经过其它第三方。'
export const ALLOWED_MODELS = Object.freeze(['tiny', 'base', 'small', 'medium'])
export const ALLOWED_ENGINES = Object.freeze(['local', 'cloud'])

function safeHost(endpoint) {
  try {
    return new URL(endpoint).host
  } catch {
    return 'unknown'
  }
}

function fmtTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
}

function buildTranscriptMarkdown(stem, segments) {
  const lines = [`# 转写：${stem}`, '']
  for (const segment of segments) {
    const who = segment.speakerId === undefined || segment.speakerId === null ? '' : `S${segment.speakerId}：`
    lines.push(`[${fmtTimestamp(segment.start)}] ${who}${segment.text}`)
  }
  return `${lines.join('\n')}\n`
}
const RECORD_READY_TIMEOUT_MS = 8000
const RECORD_STOP_TIMEOUT_MS = 15000
const TRANSCRIBE_TIMEOUT_MS = 60 * 60 * 1000

function nowIso() {
  return new Date().toISOString()
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function writeAtomic(path, text) {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text, 'utf8')
  try {
    renameSync(tmp, path)
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true })
  }
}

export function createService({ config, logger, llm, python = defaultPy, store, now = nowIso, cloudFetch = globalThis.fetch, streamWebSocket = globalThis.WebSocket }) {
  const dataRoot = config.root
  const recordingsDir = join(dataRoot, 'recordings')
  const transcriptsDir = join(dataRoot, 'transcripts')
  const minutesDir = join(dataRoot, 'minutes')
  for (const dir of [recordingsDir, transcriptsDir, minutesDir]) mkdirSync(dir, { recursive: true })

  const liveRegistry = createLiveRegistry()
  const pendingFallbacks = new Set()

  /**
   * 每次请求重新解析配置（R-02 热生效）：
   * 页面保存的 config.json > 环境变量 > 默认，所以读文件而不是缓存。
   * 数据目录不参与热切换——它决定的就是「配置放在哪」，换了必须重启。
   */
  async function currentSource() {
    if (config.settingsSource) return config.settingsSource
    return createSettingsSource({ root: dataRoot, env: process.env })
  }
  const meetingStore = store ?? createStore({ root: dataRoot })
  const queue = createQueue()
  let recording = null
  let privacyNoticeShown = false
  let cloudNoticeShown = false

  function resolveMeeting(meetingId) {
    if (meetingId) return meetingStore.get(meetingId)
    const [latest] = meetingStore.list()
    return latest ?? null
  }

  function recordPath(id) {
    return join(recordingsDir, `${id}.wav`)
  }
  function transcriptPath(id) {
    return join(transcriptsDir, `${id}.md`)
  }
  function minutesPath(id) {
    return join(minutesDir, `${id}.md`)
  }

  function pcmPath(id) {
    return join(recordingsDir, `${id}.pcm`)
  }

  /** tail 旁路 PCM：按偏移增量读，推给流式会话（决策 2：读文件，不开管道） */
  function startPcmTail({ meetingId, file, session }) {
    let fd = null
    let offset = 0
    let timer = null

    const readMore = () => {
      try {
        if (fd === null) {
          if (!existsSync(file)) return
          fd = openSync(file, 'r')
        }
        const size = statSync(file).size
        if (size <= offset) return
        const length = Math.min(size - offset, 32000 * 60)
        const buffer = Buffer.allocUnsafe(length)
        const read = readSync(fd, buffer, 0, length, offset)
        if (read > 0) {
          offset += read
          session.push(buffer.subarray(0, read))
        }
      } catch (error) {
        logger.warn('PCM 旁路读取失败', { meetingId, reason: String(error?.message ?? error).slice(0, 120) }, meetingId)
      }
    }

    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
      readMore() // 把最后一块读干净，否则末尾一句会丢
      try {
        if (fd !== null) closeSync(fd)
      } catch { /* 忽略 */ }
      fd = null
    }

    timer = setInterval(readMore, 100)
    if (typeof timer.unref === 'function') timer.unref()
    return { stop, get bytes() { return offset } }
  }

  async function recordStart({ label = '', stream = null, sessionId = null, workspaceDir = null } = {}) {
    if (recording) {
      return err(CODES.E_STATE, `正在录音中（${recording.meetingId}），请先停止`, { meetingId: recording.meetingId })
    }
    if (typeof label !== 'string' || label.length > 60) {
      return err(CODES.E_STATE, 'label 必须是不超过 60 字的字符串', { field: 'label' })
    }

    // 流式配置（R-09）：不传 stream 时按配置；配置默认关闭，所以缺省行为不变
    const source = await currentSource()
    const streamResolved = resolveStreamConfig({
      source: config.cloudSource ?? source,
      logger,
      overrides: config.streamOverrides ?? {},
    })
    if (!streamResolved.ok) return streamResolved
    const streamConfig = streamResolved.config
    const wantStream = stream === true || (stream !== false && streamConfig.enabled === true)
    if (wantStream && !streamConfig.available) {
      return err(CODES.E_DEP, '流式识别已启用但缺少云端密钥（DASHSCOPE_API_KEY）', { field: 'stream', reason: streamConfig.reason })
    }

    const created = meetingStore.create({ label, startedAt: now() })
    const meetingId = created.meeting.id
    const outPath = recordPath(meetingId)
    const sidecarArgs = ['--out', outPath]
    if (wantStream) sidecarArgs.push('--pcm-out', pcmPath(meetingId))

    // 状态先落到 running，收尾时才能 running → done/failed（单向状态机不允许 pending → done）
    transition(meetingStore, meetingId, 'record', 'running', { logger, runId: meetingId })

    const child = python.spawnSidecar('record.py', sidecarArgs)
    const state = {
      meetingId,
      child,
      outPath,
      stdout: '',
      stderr: '',
      ready: false,
      closed: null,
      sessionId,
      workspaceDir,
      stream: null,
    }

    // 监听必须在 spawn 之后立刻挂好：子进程可能马上就有输出，等到 stop 再挂会丢
    state.closed = new Promise((resolve) => {
      child.on('close', (code) => resolve(code))
    })
    child.stdout.on('data', (chunk) => { state.stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8') })

    recording = state

    /**
   * 取一个「能带 Authorization 头」的 WebSocket 实现。
   *
   * Node 自带的 WebSocket 只接受子协议、不接受自定义头部，而 DashScope 实时识别
   * 只认 `Authorization: Bearer`（探针确认），所以这里优先用 ws；没有 ws 时退回
   * 内置实现——连不上就降级，行为仍然安全。
   */
  async function resolveWebSocketImpl() {
    if (config.streamWebSocket) return config.streamWebSocket
    try {
      const mod = await import('ws')
      const impl = mod?.WebSocket ?? mod?.default ?? null
      if (typeof impl === 'function') return impl
    } catch { /* 没装 ws：退回内置实现 */ }
    return streamWebSocket
  }

  const readyPromise = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(state.ready), RECORD_READY_TIMEOUT_MS)
      child.stderr.on('data', () => {
        if (!state.ready && state.stderr.includes('录音开始')) {
          state.ready = true
          clearTimeout(timer)
          resolve(true)
        }
      })
      state.closed.then(() => {
        clearTimeout(timer)
        resolve(state.ready)
      })
    })

    return readyPromise.then(async (opened) => {
      if (!opened) {
        recording = null
        const detail = { meetingId, stderr: state.stderr.trim().split('\n').slice(-5).join('\n') }
        logger.error('录音失败', { meetingId, code: 'E_DEVICE', reason: detail.stderr.slice(0, 200) }, meetingId)
        try {
          transition(meetingStore, meetingId, 'record', 'failed', { logger, runId: meetingId })
        } catch { /* 状态可能已是 failed */ }
        return err(CODES.E_DEVICE, '录音启动失败：设备打不开或被占用', detail)
      }

      logger.info('录音开始', { meetingId, path: outPath, mode: wantStream ? 'mic+stream' : 'mic' }, meetingId)
      const engine = { stream: wantStream, model: wantStream ? streamConfig.model : null, source: wantStream ? streamConfig.sourceName : null }

      if (wantStream) {
        // 流式链路：连上就开始 tail PCM 推流；连不上只降级，录音本身照常
        const session = createStreamSession({
          config: streamConfig,
          logger,
          runId: meetingId,
          WebSocketImpl: await resolveWebSocketImpl(),
          settleMs: config.streamSettleMs,
          reconnectDelayMs: config.streamReconnectDelayMs,
          onEvent: ({ snapshot }) => liveRegistry.update(meetingId, snapshot),
        })
        const tail = startPcmTail({ meetingId, file: pcmPath(meetingId), session })
        state.stream = { session, tail, config: streamConfig }

        liveRegistry.attach(meetingId, { engine })
        session.connect().then((result) => {
          if (!result.ok) logger.warn('流式连接失败，将继续录音并在停录后降级识别', { meetingId, code: result.code }, meetingId)
        }).catch(() => {})
      }

      return ok({
        meetingId,
        startedAt: created.meeting.startedAt,
        status: { record: 'running' },
        stream: engine,
      })
    })
  }

  async function recordStop({ sessionId = null, workspaceDir = null } = {}) {
    if (!recording) return err(CODES.E_STATE, '当前没有进行中的录音')

    const current = recording
    if (sessionId) current.sessionId = sessionId
    if (workspaceDir) current.workspaceDir = workspaceDir
    recording = null

    // 约定：写 stop 让 sidecar 正常收尾（Windows 下 SIGINT 不可靠）
    try {
      current.child.stdin.write('stop\n')
      current.child.stdin.end()
    } catch {
      current.child.kill()
    }

    const timedOut = await Promise.race([
      current.closed.then(() => false),
      new Promise((resolve) => setTimeout(() => resolve(true), RECORD_STOP_TIMEOUT_MS)),
    ])

    if (timedOut) {
      current.child.kill()
      try {
        transition(meetingStore, current.meetingId, 'record', 'failed', { logger, runId: current.meetingId })
      } catch { /* 记账尽力而为 */ }
      return err(CODES.E_DEVICE, '录音收尾超时（sidecar 未在限定时间内退出）', { meetingId: current.meetingId })
    }

    const payload = defaultPy.parseSidecarStdout(current.stdout)
    if (!payload || payload.ok !== true) {
      try {
        transition(meetingStore, current.meetingId, 'record', 'failed', { logger, runId: current.meetingId })
      } catch { /* 忽略：只为记账 */ }
      logger.error('录音失败', { meetingId: current.meetingId, code: payload?.code ?? 'E_DEVICE' }, current.meetingId)
      return err(CODES.E_DEVICE, payload?.message ?? '录音收尾失败', { meetingId: current.meetingId })
    }

    let sha = null
    try {
      sha = sha256File(current.outPath)
    } catch {
      return err(CODES.E_AUDIO, '录音文件不可读', { meetingId: current.meetingId, path: current.outPath })
    }

    const updated = meetingStore.patch(current.meetingId, {
      endedAt: now(),
      durationSec: payload.durationSec,
      audio: {
        path: current.outPath,
        sha256: sha,
        sampleRate: payload.sampleRate,
        channels: payload.channels,
      },
    })
    transition(meetingStore, current.meetingId, 'record', 'done', { logger, runId: current.meetingId })
    logger.info('录音结束', { meetingId: current.meetingId, duration: payload.durationSec, bytes: payload.bytes }, current.meetingId)

    // 流式收尾（R-04/R-05）：停止 tail → 等服务端定稿 → 落盘；失败则降级走非流式
    const streamOutcome = current.stream
      ? await finalizeStreamRecording({ current, meetingId: current.meetingId, durationSec: payload.durationSec })
      : null

    return ok({
      meetingId: current.meetingId,
      durationSec: payload.durationSec,
      audioPath: updated.audio.path,
      ...(streamOutcome ? { stream: streamOutcome } : {}),
    })
  }

  /** 流式录音的收尾：定稿 → 落盘 → 清理旁路文件；decide 降级时排一次非流式识别 */
  async function finalizeStreamRecording({ current, meetingId, durationSec }) {
    const { session, tail, config: streamConfig } = current.stream
    const sessionId = current.sessionId ?? undefined
    const workspaceDir = current.workspaceDir ?? undefined

    tail?.stop()
    const degradedBefore = session.snapshot().state === 'degraded'
    const finalized = await session.finalize()
    const segments = finalized.ok ? finalized.segments : []
    const timedOut = finalized.ok ? finalized.timedOut === true : false
    const degraded = degradedBefore || !finalized.ok || finalized.degraded === true

    liveRegistry.update(meetingId, { ...session.snapshot(), state: degraded ? 'degraded' : 'done', finals: segments, partial: '' })
    // 让卡片有机会看到最后一帧 done/degraded，再回到 idle
    const releaseTimer = setTimeout(() => liveRegistry.detach(meetingId), 2000)
    if (typeof releaseTimer.unref === 'function') releaseTimer.unref()

    const meeting = meetingStore.get(meetingId)
    let chars = segments.reduce((sum, item) => sum + item.text.length, 0)
    const useStream = segments.length > 0 && !degraded

    if (useStream) {
      const stats = { segments: segments.length, durationSec: Math.round((durationSec ?? 0) * 100) / 100, chars }
      const target = meetingOutputTarget({ meeting, sessionId, workspaceDir })
      let mdPath
      if (target.legacy) {
        mdPath = transcriptPath(meetingId)
        writeAtomic(mdPath, buildTranscriptMarkdown(meetingId, segments.map((item) => ({ start: item.startSec, text: item.text }))))
      } else {
        writeProductFile({ target, meeting, segments, engine: 'cloud', model: streamConfig.model, stats })
        mdPath = target.file
      }
      writeAtomic(join(transcriptsDir, `${meetingId}.json`), `${JSON.stringify({
        meetingId,
        engine: 'cloud',
        mode: 'stream',
        model: streamConfig.model,
        segments,
        stats,
        timedOut,
        elapsedSec: null,
      }, null, 2)}\n`)

      meetingStore.patch(meetingId, { stats, engine: 'cloud', stream: true })
      try {
        transition(meetingStore, meetingId, 'transcribe', 'running', { logger, runId: `${meetingId}-stream` })
        transition(meetingStore, meetingId, 'transcribe', 'done', { logger, runId: `${meetingId}-stream` })
      } catch { /* 状态位尽力而为，产物为准 */ }

      logger.info('流式转写完成', { meetingId, segments: segments.length, chars, timedOut }, `${meetingId}-stream`)
      if (timedOut) logger.warn('收尾超时，末尾可能截断', { meetingId }, `${meetingId}-stream`)
    } else {
      logger.warn('降级为停录后整段识别', { meetingId, reason: session.snapshot().degradedReason ?? 'no_segments', finals: segments.length }, `${meetingId}-stream`)
      const fallback = transcribe({ meetingId, engine: 'cloud', sessionId, workspaceDir })
      pendingFallbacks.add(fallback)
      Promise.resolve(fallback).finally(() => pendingFallbacks.delete(fallback)).catch(() => {})
    }

    // 旁路 PCM 是临时件，收尾后删掉（异常路径也删，避免堆垃圾）
    try {
      const file = pcmPath(meetingId)
      if (existsSync(file)) rmSync(file, { force: true })
      logger.debug('旁路 PCM 已清理', { meetingId, path: file, 是否存在: false }, meetingId)
    } catch { /* 删不掉不影响结果 */ }

    return {
      enabled: true,
      used: useStream,
      degraded,
      timedOut,
      segments: segments.length,
      chars,
      model: streamConfig.model,
      fallback: useStream ? null : 'queued',
    }
  }

  function markTranscribeFailed(meetingId, message) {
    meetingStore.patch(meetingId, { errors: { transcribe: message } })
    const current = meetingStore.get(meetingId)?.status?.transcribe
    if (current === 'pending') {
      try {
        transition(meetingStore, meetingId, 'transcribe', 'running', { logger })
      } catch { /* 忽略 */ }
    }
    try {
      transition(meetingStore, meetingId, 'transcribe', 'failed', { logger })
    } catch {
      meetingStore.patch(meetingId, { status: { transcribe: 'failed' } })
    }
  }

  async function transcribe({ meetingId, model, engine, sessionId, workspaceDir } = {}) {
    const meeting = resolveMeeting(meetingId)
    if (!meeting) {
      return err(CODES.E_STATE, meetingId ? `会议不存在: ${meetingId}` : '还没有任何会议记录', { meetingId: meetingId ?? null })
    }
    if (!meeting.audio?.path || !existsSync(meeting.audio.path)) {
      return err(CODES.E_STATE, '该会议没有可用录音，请先录音', { meetingId: meeting.id })
    }

    const source = await currentSource()
    const chosenEngine = engine ?? resolveDefaultEngine({ source })
    if (!ALLOWED_ENGINES.includes(chosenEngine)) {
      return err(CODES.E_STATE, `不支持的引擎: ${chosenEngine}`, { field: 'engine', supported: ALLOWED_ENGINES })
    }

    logger.info('引擎分派', { meetingId: meeting.id, engine: chosenEngine }, `${meeting.id}-asr`)
    return chosenEngine === 'cloud'
      ? transcribeCloud({ meeting, source, sessionId, workspaceDir })
      : transcribeLocal({ meeting, model, source, sessionId, workspaceDir })
  }

  async function transcribeLocal({ meeting, model, source, sessionId, workspaceDir } = {}) {
    const chosenModel = model ?? source?.get('NOTE_TAKER_MODEL') ?? config.model
    if (!ALLOWED_MODELS.includes(chosenModel)) {
      return err(CODES.E_STATE, `不支持的模型档位: ${chosenModel}`, { field: 'model', supported: ALLOWED_MODELS })
    }
    // 模型目录：优先 NOTE_TAKER_MODEL_DIR（模型通常下到用户目录，不跟数据目录绑死），
    // 其次数据根下的 models/。目录里没有对应档位时，sidecar 会退回按档位名去 Hub 取。
    const modelDir = process.env.NOTE_TAKER_MODEL_DIR || join(dataRoot, 'models')
    const started = Date.now()
    const runId = `${meeting.id}-asr`

    transition(meetingStore, meeting.id, 'transcribe', 'running', { logger, runId })

    const result = await queue.run(() =>
      python.runSidecar(
        'transcribe.py',
        [
          '--audio', meeting.audio.path,
          '--out-dir', transcriptsDir,
          '--stem', meeting.id,
          '--model', chosenModel,
          '--model-dir', modelDir,
          '--threads', String(config.threads),
        ],
        { timeoutMs: TRANSCRIBE_TIMEOUT_MS, onStderr: (text) => logger.debug('转写 sidecar 输出', { meetingId: meeting.id, text: text.trim().slice(0, 200) }, runId) },
      ),
    )

    if (!result.ok) {
      const code = result.payload?.code && CODES[result.payload.code] ? result.payload.code : CODES.E_MODEL
      meetingStore.patch(meeting.id, { errors: { transcribe: result.payload?.message ?? '转写失败' } })
      transition(meetingStore, meeting.id, 'transcribe', 'failed', { logger, runId })
      logger.error('转写失败', { meetingId: meeting.id, code, stderr: (result.stderr ?? '').trim().split('\n').slice(-3).join(' | ') }, runId)
      return err(code, result.payload?.message ?? '转写失败', { meetingId: meeting.id, exitCode: result.exitCode })
    }

    const sourceMdPath = result.payload.mdPath ?? transcriptPath(meeting.id)
    const md = readFileSync(sourceMdPath, 'utf8')
    const parsed = parseTranscript(md)
    const { stats } = parsed

    const target = meetingOutputTarget({ meeting, sessionId, workspaceDir })
    let mdPath = sourceMdPath
    if (!target.legacy) {
      writeProductFile({ target, meeting, segments: parsed.segments, engine: 'local', model: chosenModel, stats })
      mdPath = target.file
      // 单文件模式下删掉 sidecar 写的那份 md，避免同一场会议两份内容（R-04）
      try { if (sourceMdPath !== mdPath && existsSync(sourceMdPath)) rmSync(sourceMdPath) } catch { /* 忽略 */ }
    }

    meetingStore.patch(meeting.id, { stats })
    transition(meetingStore, meeting.id, 'transcribe', 'done', { logger, runId })
    logger.info('转写结束', {
      meetingId: meeting.id,
      segments: result.payload.segments,
      chars: result.payload.chars,
      rtf: result.payload.rtf,
      elapsed: Math.round((Date.now() - started) / 1000),
    }, runId)

    return ok({
      meetingId: meeting.id,
      segments: result.payload.segments,
      chars: result.payload.chars,
      durationSec: result.payload.durationSec,
      rtf: result.payload.rtf,
      transcriptPath: mdPath,
      outputPath: target.legacy ? mdPath : target.relative,
      outputMode: target.mode,
      stats,
    })
  }

  /**
   * 云端引擎（CR-01）：解码 → 分片 → 逐片 HTTP 识别 → 按偏移合并 → 落盘。
   * 失败只写 errors.transcribe，不覆盖既有产物（R-09）。
   */
  async function transcribeCloud({ meeting, source, sessionId, workspaceDir } = {}) {
    const runId = `${meeting.id}-cloud`
    const started = Date.now()

    const resolved = resolveCloudAsrConfig({
      source: config.cloudSource ?? source ?? createEnvSource(),
      logger,
      overrides: config.cloudOverrides ?? {},
    })
    if (!resolved.ok) {
      markTranscribeFailed(meeting.id, resolved.message)
      return resolved
    }
    const cloudConfig = resolved.config

    const notice = cloudNoticeShown ? null : CLOUD_NOTICE
    if (notice) {
      cloudNoticeShown = true
      logger.info('云端外发告知', { meetingId: meeting.id, host: safeHost(cloudConfig.endpoint) }, meeting.id)
    }

    transition(meetingStore, meeting.id, 'transcribe', 'running', { logger, runId })

    const decoded = await decodeToPcm(meeting.audio.path, { workDir: transcriptsDir, runner: python.runSidecar })
    if (!decoded.ok) {
      meetingStore.patch(meeting.id, { errors: { transcribe: decoded.message } })
      transition(meetingStore, meeting.id, 'transcribe', 'failed', { logger, runId })
      return { ...decoded, detail: { ...(decoded.detail ?? {}), meetingId: meeting.id } }
    }

    const { chunks } = splitPcm(decoded.pcm, { chunkSeconds: cloudConfig.chunkSeconds })
    logger.info('云端分片计划', { meetingId: meeting.id, chunks: chunks.length, chunkSeconds: cloudConfig.chunkSeconds }, runId)

    const parts = []
    let usage = null

    const outcome = await queue.run(async () => {
      for (const [index, chunk] of chunks.entries()) {
        const wav = pcmToWav(chunk.buffer, { sampleRate: cloudConfig.sampleRate })
        let recognized = null
        // 网络抖动/限流：每片最多重试一次（plan 风险节的缓解措施）
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          recognized = await recognizeWithHttp({
            config: cloudConfig,
            audio: wav,
            format: 'wav',
            terms: cloudConfig.terms,
            logger,
            runId,
            fetchImpl: cloudFetch,
            offsetSec: chunk.offsetSec,
          })
          if (recognized.ok) break
          const retriable = recognized.code === CODES.E_LLM
          logger.warn('云端识别重试', { meetingId: meeting.id, chunk: index + 1, of: chunks.length, attempt, code: recognized.code }, runId)
          if (!retriable || attempt === 2) break
        }
        if (!recognized?.ok) return recognized

        // 注意：片内时间戳保持相对（offsetSec=0），偏移统一由 mergeSegments 加一次，
        // 否则会像首次实现那样把片偏移叠两遍（47 分钟音频产出 91 分钟时间轴）。
        const aggregated = aggregateHttpPayload(recognized.payload)
        parts.push({ offsetSec: chunk.offsetSec, segments: aggregated.segments })
        usage = aggregated.usage ?? usage
        logger.info('云端分片完成', { meetingId: meeting.id, chunk: index + 1, of: chunks.length, segments: aggregated.segments.length }, runId)
      }
      return ok({})
    })

    if (!outcome?.ok) {
      meetingStore.patch(meeting.id, { errors: { transcribe: outcome?.message ?? '云端识别失败' } })
      transition(meetingStore, meeting.id, 'transcribe', 'failed', { logger, runId })
      logger.error('云端识别失败', { meetingId: meeting.id, code: outcome?.code, reason: String(outcome?.message ?? '').slice(0, 160) }, runId)
      return { ...outcome, detail: { ...(outcome?.detail ?? {}), meetingId: meeting.id } }
    }

    const segments = mergeSegments(parts)
    const durationSec = decoded.durationSec ?? Math.round((chunks.at(-1)?.offsetSec ?? 0) + (chunks.at(-1)?.durationSec ?? 0))
    const chars = segments.reduce((sum, segment) => sum + segment.text.length, 0)
    const stats = { segments: segments.length, durationSec: Math.round(durationSec * 100) / 100, chars }

    const target = meetingOutputTarget({ meeting, sessionId, workspaceDir })
    let mdPath
    if (target.legacy) {
      mdPath = transcriptPath(meeting.id)
      writeAtomic(mdPath, buildTranscriptMarkdown(meeting.id, segments))
    } else {
      writeProductFile({ target, meeting, segments, engine: 'cloud', model: cloudConfig.model, stats })
      mdPath = target.file
    }
    writeAtomic(join(transcriptsDir, `${meeting.id}.json`), `${JSON.stringify({
      meetingId: meeting.id,
      engine: 'cloud',
      model: cloudConfig.model,
      segments,
      stats,
      usage,
      elapsedSec: Math.round((Date.now() - started) / 1000),
    }, null, 2)}\n`)

    meetingStore.patch(meeting.id, { stats, engine: 'cloud' })
    transition(meetingStore, meeting.id, 'transcribe', 'done', { logger, runId })
    logger.info('转写结束', {
      meetingId: meeting.id,
      engine: 'cloud',
      segments: stats.segments,
      chars,
      chunks: chunks.length,
      elapsed: Math.round((Date.now() - started) / 1000),
    }, runId)

    return ok({
      meetingId: meeting.id,
      engine: 'cloud',
      segments: stats.segments,
      chars,
      durationSec: stats.durationSec,
      rtf: stats.durationSec > 0 ? Math.round(((Date.now() - started) / 1000 / stats.durationSec) * 1000) / 1000 : null,
      transcriptPath: mdPath,
      outputPath: target.legacy ? mdPath : target.relative,
      outputMode: target.mode,
      stats,
      notice,
    })
  }

  async function minutes({ meetingId, force = false, sessionId, workspaceDir } = {}) {
    const meeting = resolveMeeting(meetingId)
    if (!meeting) {
      return err(CODES.E_STATE, meetingId ? `会议不存在: ${meetingId}` : '还没有任何会议记录', { meetingId: meetingId ?? null })
    }
    if (meeting.status.transcribe !== 'done') {
      return err(CODES.E_STATE, '该会议尚未完成转写，请先转写', { meetingId: meeting.id, status: meeting.status.transcribe })
    }

    // 有会话工作区时，转写与纪要同在一个单文件里（R-02）；否则沿用旧的两份文件
    const target = meetingOutputTarget({ meeting, sessionId, workspaceDir })
    const mdPath = target.legacy ? transcriptPath(meeting.id) : target.file
    if (!existsSync(mdPath)) {
      return err(CODES.E_STATE, '转写文件不存在，请重新转写', { meetingId: meeting.id })
    }

    const notice = privacyNoticeShown ? null : PRIVACY_NOTICE
    if (notice) {
      privacyNoticeShown = true
      logger.info('隐私提示首次触发', { meetingId: meeting.id, noticeChars: PRIVACY_NOTICE.length }, meeting.id)
    }

    const outPath = target.legacy ? minutesPath(meeting.id) : target.file
    const existingMinutes = target.legacy
      ? (existsSync(outPath) ? readFileSync(outPath, 'utf8') : '')
      : (existsSync(target.file) ? extractMinutes(readFileSync(target.file, 'utf8')) : '')
    if (existingMinutes && !force) {
      return ok({ meetingId: meeting.id, minutesPath: outPath, markdown: existingMinutes, notice, cached: true })
    }

    const runId = `${meeting.id}-minutes`
    const started = Date.now()
    const rawTranscript = readFileSync(mdPath, 'utf8')
    const transcript = target.legacy ? rawTranscript : extractTranscript(rawTranscript)

    transition(meetingStore, meeting.id, 'minutes', 'running', { logger, runId })
    logger.info('纪要生成开始', {
      meetingId: meeting.id,
      provider: config.llmProvider ?? 'default',
      model: config.llmModel ?? 'default',
      inputChars: transcript.length,
    }, runId)

    const llmClient = createLlmClient({ llm, provider: config.llmProvider, model: config.llmModel })
    const result = await queue.run(() =>
      generateMinutes({ llmClient, meeting, transcript, stats: meeting.stats ?? undefined }),
    )

    if (!result.ok) {
      meetingStore.patch(meeting.id, { errors: { minutes: result.message } })
      transition(meetingStore, meeting.id, 'minutes', 'failed', { logger, runId })
      if (result.code === CODES.E_STATE) {
        logger.warn('纪要校验不通过', { meetingId: meeting.id, missing: (result.detail?.missing ?? []).join('、') }, runId)
      } else {
        logger.error('模型调用失败', { meetingId: meeting.id, code: result.code, reason: result.detail?.reason }, runId)
      }
      return err(result.code, result.message, { meetingId: meeting.id, ...result.detail })
    }

    if (target.legacy) {
      writeAtomic(outPath, result.markdown)
    } else {
      // 只替换文件里的「## 纪要」段，转写逐字保留
      writeAtomic(target.file, mergeMinutes(readFileSync(target.file, 'utf8'), result.markdown))
      logger.info('纪要合并', { meetingId: meeting.id, first: !existingMinutes, previousChars: existingMinutes.length }, runId)
    }
    transition(meetingStore, meeting.id, 'minutes', 'done', { logger, runId })
    logger.info('纪要生成结束', {
      meetingId: meeting.id,
      elapsed: Math.round((Date.now() - started) / 1000),
      outputChars: result.markdown.length,
      warnings: result.warnings.length,
    }, runId)

    return ok({
      meetingId: meeting.id,
      minutesPath: outPath,
      outputPath: target.legacy ? outPath : target.relative,
      outputMode: target.mode,
      markdown: result.markdown,
      warnings: result.warnings,
      notice,
    })
  }

  function list({ limit = 20 } = {}) {
    const size = Number(limit)
    if (!Number.isInteger(size) || size < 1 || size > 100) {
      return err(CODES.E_STATE, 'limit 必须是 1–100 的整数', { field: 'limit' })
    }

    const meetings = meetingStore.list().slice(0, size).map((meeting) => {
      const minutes = detectMinutes(meeting)
      // 状态自愈：文件里已有纪要但状态还是 pending（agent 直接写文件那种）→ 补成 done
      if (minutes.has && meeting.status?.minutes !== 'done') {
        try {
          meetingStore.patch(meeting.id, { status: { minutes: 'done' } })
          logger.info('纪要状态自愈', { meetingId: meeting.id }, meeting.id)
          return { ...meeting, hasMinutes: true, status: { ...meeting.status, minutes: 'done' } }
        } catch { /* 补失败不影响读取 */ }
      }
      return { ...meeting, hasMinutes: minutes.has }
    })

    return ok({ meetings })
  }

  function status({ meetingId } = {}) {
    if (!meetingId) return err(CODES.E_STATE, 'meetingId 必填', { field: 'meetingId' })
    const meeting = meetingStore.get(meetingId)
    if (!meeting) return err(CODES.E_STATE, `会议不存在: ${meetingId}`, { meetingId })
    return ok({ meetingId, status: meeting.status, errors: meeting.errors, stats: meeting.stats })
  }

  /**
   * 导入已有音频（R-04）：拷进 recordings/ 建一场会议，解码取时长，状态直接记 done。
   * 只接受存在的文件；重名自动加序号，不覆盖。
   */
  async function importAudio({ fromPath, label = '', transcribe: shouldTranscribe = false, sessionId, workspaceDir, maxBytes, engine } = {}) {
    if (typeof fromPath !== 'string' || fromPath.trim() === '') {
      return err(CODES.E_STATE, '缺少参数 path', { field: 'path' })
    }
    const source = resolve(fromPath)
    if (!existsSync(source)) {
      logger.warn('导入失败', { reason: 'path-missing', tail: source.slice(-40) })
      return err(CODES.E_AUDIO, missingPathHint(fromPath), { field: 'path' })
    }
    const stat = statSync(source)
    if (!stat.isFile()) return err(CODES.E_AUDIO, '路径不是文件', { field: 'path' })

    const size = checkSize(stat.size, maxBytes ? { maxBytes } : {})
    if (!size.ok) {
      logger.warn('导入超限', { bytes: size.bytes, limit: size.limit })
      return err(CODES.E_AUDIO, size.reason, { field: 'path', bytes: size.bytes, limit: size.limit })
    }

    const labelText = (typeof label === 'string' && label.trim() !== '') ? label.trim() : deriveLabel({ path: source, startedAt: now() })
    const created = meetingStore.create({ label: labelText, startedAt: now() })
    const meetingId = created.meeting.id
    const outPath = join(recordingsDir, `${meetingId}${pickExtension(source)}`)
    copyFileSync(source, outPath)
    logger.info('导入请求', { meetingId, bytes: stat.size, labelChars: labelText.length })

    transition(meetingStore, meetingId, 'record', 'running', { logger, runId: meetingId })
    const decoded = await decodeToPcm(outPath, { workDir: transcriptsDir, runner: python.runSidecar })
    const durationSec = decoded.ok ? (decoded.durationSec ?? 0) : 0
    if (!decoded.ok) logger.warn('导入音频解码失败，时长记为 0', { meetingId, reason: String(decoded.message).slice(0, 120) }, meetingId)

    meetingStore.patch(meetingId, {
      durationSec,
      audio: { path: outPath, sha256: null, sampleRate: decoded.ok ? decoded.sampleRate ?? 16000 : null, channels: 1 },
    })
    transition(meetingStore, meetingId, 'record', 'done', { logger, runId: meetingId })
    logger.info('导入音频', { meetingId, durationSec, bytes: stat.size }, meetingId)

    const result = { meetingId, label: labelText, durationSec, audioPath: outPath, transcribed: false }

    if (shouldTranscribe) {
      logger.info('自动转写分派', { meetingId, engine: config.engine ?? 'local' }, meetingId)
      const transcribed = await transcribe({ meetingId, sessionId, workspaceDir, engine })
      if (transcribed.ok) {
        Object.assign(result, {
          transcribed: true,
          segments: transcribed.segments,
          chars: transcribed.chars,
          outputPath: transcribed.outputPath ?? null,
          outputFile: transcribed.transcriptPath ?? null,
          outputMode: transcribed.outputMode ?? 'fallback',
        })
      } else {
        // 导入成功、转写失败：不掩盖导入结果，把原因带回去
        logger.warn('自动转写失败（音频已保存）', { meetingId, code: transcribed.code, reason: String(transcribed.message ?? '').slice(0, 120) }, meetingId)
        result.transcribeError = { code: transcribed.code, message: transcribed.message }
      }
    }

    return ok(result)
  }
  /** 改会议名（卡片上就地编辑）：空字符串表示清空，回退为按时间显示 */
  function renameMeeting({ meetingId, label = '' } = {}) {
    const meeting = resolveMeeting(meetingId)
    if (!meeting) {
      return err(CODES.E_STATE, meetingId ? `会议不存在: ${meetingId}` : '还没有任何会议记录', { meetingId: meetingId ?? null })
    }
    if (typeof label !== 'string') {
      return err(CODES.E_STATE, 'label 必须是字符串', { field: 'label' })
    }
    const trimmed = label.trim()
    if (trimmed.length > 60) {
      return err(CODES.E_STATE, 'label 不能超过 60 字', { field: 'label' })
    }

    const updated = meetingStore.patch(meeting.id, { label: trimmed })
    logger.info('会议改名', { meetingId: meeting.id, length: trimmed.length }, meeting.id)
    return ok({ meetingId: meeting.id, label: updated.label ?? '' })
  }
  /** 页面详情（R-03）：会议 + 转写正文 + 纪要正文，缺哪个就给 null */
  function detail({ meetingId, sessionId } = {}) {
    const meeting = resolveMeeting(meetingId)
    if (!meeting) {
      return err(CODES.E_STATE, meetingId ? `会议不存在: ${meetingId}` : '还没有任何会议记录', { meetingId: meetingId ?? null })
    }

    // 优先按记录里的产物位置读（设置页没有 sessionId 也能读到工作区产物）
    let target = null
    const recorded = meeting.product
    if (recorded?.path && existsSync(recorded.path)) {
      target = { mode: recorded.mode ?? 'workspace', file: recorded.path, relative: recorded.relative ?? null, workspaceRoot: recorded.workspaceRoot ?? null, legacy: false }
    } else {
      target = meetingOutputTarget({ meeting, sessionId })
    }

    let transcript = null
    let minutes = null
    if (!target.legacy && existsSync(target.file)) {
      const content = readFileSync(target.file, 'utf8')
      transcript = extractTranscript(content) || null
      minutes = extractMinutes(content) || null
    } else {
      const transcriptFile = transcriptPath(meeting.id)
      const minutesFile = minutesPath(meeting.id)
      transcript = existsSync(transcriptFile) ? readFileSync(transcriptFile, 'utf8') : null
      minutes = existsSync(minutesFile) ? readFileSync(minutesFile, 'utf8') : null
    }

    return ok({
      meeting,
      transcript,
      minutes,
      outputPath: target.legacy ? null : (target.relative ?? target.file),
      outputMode: target.mode,
      workspaceRoot: target.workspaceRoot ?? null,
      transcriptBytes: transcript ? Buffer.byteLength(transcript) : 0,
      minutesBytes: minutes ? Buffer.byteLength(minutes) : 0,
    })
  }

  /**
   * 决定这场会议的产物落点（R-01）：
   * - 能按 sessionId 解析到会话工作区 → 单文件写 <工作区>/meetings/<id>.md
   * - 否则回落旧行为（transcripts/<id>.md + minutes/<id>.md），保证工具调用与旧数据不变
   */
  function meetingOutputTarget({ meeting, sessionId, workspaceDir: explicitDir }) {
    let workspaceDir = typeof explicitDir === 'string' && explicitDir.trim() !== '' ? explicitDir.trim() : null
    if (!workspaceDir && typeof config.resolveWorkspaceDir === 'function') {
      try {
        workspaceDir = config.resolveWorkspaceDir(sessionId)
      } catch (error) {
        logger.warn('工作区解析异常', { meetingId: meeting.id, reason: String(error?.message ?? error).slice(0, 120) }, meeting.id)
      }
    }

    if (!workspaceDir) {
      logger.info('工作区解析', { meetingId: meeting.id, sessionId: sessionId ?? null, mode: 'fallback', dir: dataRoot }, meeting.id)
      return { mode: 'fallback', legacy: true }
    }

    const paths = resolveProductPaths({ dataRoot, workspaceDir, meetingId: meeting.id })
    logger.info('工作区解析', { meetingId: meeting.id, sessionId, mode: paths.mode, dir: paths.dir }, meeting.id)
    return paths
  }

  /** 写单文件（保留文件里已有的纪要段），返回落点 */
  function writeProductFile({ target, meeting, segments, engine, model, stats }) {
    mkdirSync(target.dir, { recursive: true })

    let content = renderProduct({
      meetingId: meeting.id,
      label: meeting.label,
      startedAt: meeting.startedAt,
      durationSec: stats?.durationSec ?? meeting.durationSec,
      engine,
      model,
      segments,
    })

    if (existsSync(target.file)) {
      const previous = extractMinutes(readFileSync(target.file, 'utf8'))
      if (previous) content = mergeMinutes(content, previous)
    }

    writeAtomic(target.file, content)
    // 记下产物位置：这样设置页（没有 sessionId）也能读到工作区里的产物
    meetingStore.patch(meeting.id, { product: { path: target.file, mode: target.mode, relative: target.relative, workspaceRoot: target.workspaceRoot ?? null } })
    logger.info('产物写入', { meetingId: meeting.id, mode: target.mode, bytes: Buffer.byteLength(content) }, meeting.id)
    return target
  }
  /**
   * 判断一场会议到底有没有纪要——以文件为准，不看状态位。
   *
   * 原因：新流程里纪要是会话 agent 直接写进产物文件的，插件不知道，
   * `status.minutes` 会一直是 pending。列表若按状态过滤就会显示 0（真实踩过）。
   */
  function detectMinutes(meeting) {
    const recorded = meeting?.product
    if (recorded?.path && existsSync(recorded.path)) {
      try {
        return { has: Boolean(extractMinutes(readFileSync(recorded.path, 'utf8'))), path: recorded.path }
      } catch { /* 读不了当没有 */ }
    }
    // 兼容：agent 可能把纪要直接写进旧的 transcripts/<id>.md（无工作区时的产物）
    const legacyTranscript = transcriptPath(meeting.id)
    if (existsSync(legacyTranscript)) {
      try {
        const text = readFileSync(legacyTranscript, 'utf8')
        if (extractMinutes(text)) return { has: true, path: legacyTranscript }
      } catch { /* 读不了当没有 */ }
    }

    const legacy = minutesPath(meeting.id)
    if (existsSync(legacy)) {
      try {
        return { has: readFileSync(legacy, 'utf8').trim() !== '', path: legacy }
      } catch { /* 同上 */ }
    }
    return { has: false, path: null }
  }
  /** 读配置（R-01/R-08）：只回掩码，附带每项的生效来源 */
  async function readConfig() {
    const { file, warning } = await readSettingsFile(dataRoot)
    const { settings, sources } = mergeSettings({ file, env: process.env })
    const masked = maskSettings(settings)

    return ok({
      config: masked,
      sources,
      warning,
      restartRequired: [],
      // 提示：这几项改了要重启才生效
      needsRestart: ['dataRoot'],
    })
  }

  /** 保存配置（R-01/R-02/R-08）：白名单 + 校验 + 稀疏落盘 */
  async function saveConfig({ patch } = {}) {
    if (!patch || typeof patch !== 'object') {
      return err(CODES.E_STATE, '缺少配置内容', { field: 'body' })
    }

    logger.info('配置保存请求', {
      fields: Object.keys(patch).join(','),
      keys: Object.keys(patch).map((key) => (key === 'cloud' ? `cloud(${Object.keys(patch.cloud ?? {}).join('/')})` : key)).join(','),
    })

    const result = await saveSettings({ root: dataRoot, patch, env: process.env })
    if (!result.ok) {
      const first = result.errors?.[0]
      logger.warn('配置校验失败', { field: first?.field ?? '$unknown', reason: String(first?.message ?? result.message).slice(0, 60) })
      return err(CODES.E_STATE, result.message ?? '配置不合法', { field: first?.field, errors: result.errors })
    }

    logger.info('配置保存', { saved: (result.saved ?? []).join(','), ignored: (result.ignored ?? []).join(',') })
    return ok({ saved: result.saved ?? [], ignored: result.ignored ?? [], restartRequired: result.restartRequired ?? [] })
  }
  /** 能力探测（R-04）：页面据此禁用按钮，避免点了才报错 */
  async function capabilities() {
    const source = config.cloudSource ?? await currentSource()
    const apiKeyConfigured = Boolean(source.get(CLOUD_ENV.apiKey))

    let localModels = []
    try {
      localModels = readdirSync(join(dataRoot, 'models'))
        .filter((name) => name.startsWith('faster-whisper-'))
        .map((name) => name.replace('faster-whisper-', ''))
    } catch { /* 目录不存在视为没下载 */ }

    const recordingAvailable = existsSync(join(REPO_ROOT, 'pylibs', 'sounddevice.py'))

    const streamResolved = resolveStreamConfig({
      source: config.cloudSource ?? source,
      logger,
      overrides: config.streamOverrides ?? {},
    })
    const streamConfig = streamResolved.ok ? streamResolved.config : null

    return ok({
      cloud: {
        configured: apiKeyConfigured,
        model: source.get(CLOUD_ENV.model) ?? CLOUD_DEFAULTS.model,
        host: safeHost(source.get(CLOUD_ENV.endpoint) ?? CLOUD_DEFAULTS.endpoint),
      },
      // 流式（R-09）：页面据此决定是否显示流式开关与「未配置」提示
      stream: {
        enabled: streamConfig?.enabled === true,
        available: streamConfig?.available === true,
        reason: streamConfig?.reason ?? (streamResolved.ok ? null : 'invalid_config'),
        model: streamConfig?.model ?? null,
        host: streamConfig ? safeHost(streamConfig.endpoint) : null,
        source: streamConfig?.sourceName ?? 'unknown',
      },
      local: {
        models: localModels,
        // 用生效配置里的档位，别用启动时的 env 值
        defaultModel: source.get('NOTE_TAKER_MODEL') ?? config.model,
      },
      // T-01 探针结果：workspace 服务是否可用、能否按会话解析目录
      workspace: {
        available: config.workspace?.available === true,
        workspaces: config.workspace?.workspaces ?? -1,
        resolver: typeof config.resolveWorkspaceDir === 'function',
      },
      recording: { available: recordingAvailable },
      // 引擎要用生效配置（页面保存的优先），不能用启动时的 env 值——
      // 否则界面显示「本地」而实际走云端，用户会被误导。
      engine: resolveDefaultEngine({ source }),
      engineSource: typeof source.sources?.engine === 'string' ? source.sources.engine : 'unknown',
    })
  }

  /** 流式字幕快照（R-02）：只读内存，无副作用，允许 500ms 轮询 */
  function live({ meetingId } = {}) {
    return ok({ data: liveRegistry.snapshotFor(meetingId ?? null) })
  }

  return {
    recordStart,
    recordStop,
    live,
    transcribe,
    minutes,
    list,
    status,
    detail,
    capabilities,
    importAudio,
    readConfig,
    saveConfig,
    renameMeeting,
    // 测试与调试用
    store: meetingStore,
    queue,
    liveRegistry,
    /** 等降级兜底的识别跑完（测试与调试用） */
    pendingFallbacks: () => Promise.all([...pendingFallbacks]),
  }
}
