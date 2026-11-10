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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CODES, err, ok } from './errors.js'
import { createQueue, transition } from './jobs.js'
import { createLlmClient } from './llm.js'
import { createStore } from './meetings.js'
import { generateMinutes } from './minutes.js'
import { parseTranscript } from './parse.js'
import * as defaultPy from './py.js'
import { aggregateHttpPayload } from './asr/aggregate.js'
import { mergeSegments, splitPcm } from './asr/chunk.js'
import { createEnvSource, resolveCloudAsrConfig } from './asr/config.js'
import { recognizeWithHttp } from './asr/http.js'
import { decodeToPcm } from './asr/pcm.js'
import { pcmToWav } from './asr/wav.js'

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
  for (const segment of segments) lines.push(`[${fmtTimestamp(segment.start)}] ${segment.text}`)
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

export function createService({ config, logger, llm, python = defaultPy, store, now = nowIso, cloudFetch = globalThis.fetch }) {
  const dataRoot = config.root
  const recordingsDir = join(dataRoot, 'recordings')
  const transcriptsDir = join(dataRoot, 'transcripts')
  const minutesDir = join(dataRoot, 'minutes')
  for (const dir of [recordingsDir, transcriptsDir, minutesDir]) mkdirSync(dir, { recursive: true })

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

  function recordStart({ label = '' } = {}) {
    if (recording) {
      return err(CODES.E_STATE, `正在录音中（${recording.meetingId}），请先停止`, { meetingId: recording.meetingId })
    }
    if (typeof label !== 'string' || label.length > 60) {
      return err(CODES.E_STATE, 'label 必须是不超过 60 字的字符串', { field: 'label' })
    }

    const created = meetingStore.create({ label, startedAt: now() })
    const meetingId = created.meeting.id
    const outPath = recordPath(meetingId)

    // 状态先落到 running，收尾时才能 running → done/failed（单向状态机不允许 pending → done）
    transition(meetingStore, meetingId, 'record', 'running', { logger, runId: meetingId })

    const child = python.spawnSidecar('record.py', ['--out', outPath])
    const state = { meetingId, child, outPath, stdout: '', stderr: '', ready: false, closed: null }

    // 监听必须在 spawn 之后立刻挂好：子进程可能马上就有输出，等到 stop 再挂会丢
    state.closed = new Promise((resolve) => {
      child.on('close', (code) => resolve(code))
    })
    child.stdout.on('data', (chunk) => { state.stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8') })

    recording = state

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

    return readyPromise.then((opened) => {
      if (opened) {
        logger.info('录音开始', { meetingId, path: outPath, mode: 'mic' }, meetingId)
        return ok({ meetingId, startedAt: created.meeting.startedAt, status: { record: 'running' } })
      }

      recording = null
      const detail = { meetingId, stderr: state.stderr.trim().split('\n').slice(-5).join('\n') }
      logger.error('录音失败', { meetingId, code: 'E_DEVICE', reason: detail.stderr.slice(0, 200) }, meetingId)
      try {
        transition(meetingStore, meetingId, 'record', 'failed', { logger, runId: meetingId })
      } catch { /* 状态可能已是 failed */ }
      return err(CODES.E_DEVICE, '录音启动失败：设备打不开或被占用', detail)
    })
  }

  async function recordStop() {
    if (!recording) return err(CODES.E_STATE, '当前没有进行中的录音')

    const current = recording
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

    return ok({ meetingId: current.meetingId, durationSec: payload.durationSec, audioPath: updated.audio.path })
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

  async function transcribe({ meetingId, model, engine } = {}) {
    const meeting = resolveMeeting(meetingId)
    if (!meeting) {
      return err(CODES.E_STATE, meetingId ? `会议不存在: ${meetingId}` : '还没有任何会议记录', { meetingId: meetingId ?? null })
    }
    if (!meeting.audio?.path || !existsSync(meeting.audio.path)) {
      return err(CODES.E_STATE, '该会议没有可用录音，请先录音', { meetingId: meeting.id })
    }

    const chosenEngine = engine ?? config.engine ?? 'local'
    if (!ALLOWED_ENGINES.includes(chosenEngine)) {
      return err(CODES.E_STATE, `不支持的引擎: ${chosenEngine}`, { field: 'engine', supported: ALLOWED_ENGINES })
    }

    logger.info('引擎分派', { meetingId: meeting.id, engine: chosenEngine }, `${meeting.id}-asr`)
    return chosenEngine === 'cloud'
      ? transcribeCloud({ meeting })
      : transcribeLocal({ meeting, model })
  }

  async function transcribeLocal({ meeting, model } = {}) {
    const chosenModel = model ?? config.model
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

    const mdPath = result.payload.mdPath ?? transcriptPath(meeting.id)
    const md = readFileSync(mdPath, 'utf8')
    const { stats } = parseTranscript(md)

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
      stats,
    })
  }

  /**
   * 云端引擎（CR-01）：解码 → 分片 → 逐片 HTTP 识别 → 按偏移合并 → 落盘。
   * 失败只写 errors.transcribe，不覆盖既有产物（R-09）。
   */
  async function transcribeCloud({ meeting } = {}) {
    const runId = `${meeting.id}-cloud`
    const started = Date.now()

    const resolved = resolveCloudAsrConfig({
      source: config.cloudSource ?? createEnvSource(),
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

        const aggregated = aggregateHttpPayload(recognized.payload, { offsetSec: chunk.offsetSec })
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

    const mdPath = transcriptPath(meeting.id)
    const md = buildTranscriptMarkdown(meeting.id, segments)
    writeAtomic(mdPath, md)
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
      stats,
      notice,
    })
  }

  async function minutes({ meetingId, force = false } = {}) {
    const meeting = resolveMeeting(meetingId)
    if (!meeting) {
      return err(CODES.E_STATE, meetingId ? `会议不存在: ${meetingId}` : '还没有任何会议记录', { meetingId: meetingId ?? null })
    }
    if (meeting.status.transcribe !== 'done') {
      return err(CODES.E_STATE, '该会议尚未完成转写，请先转写', { meetingId: meeting.id, status: meeting.status.transcribe })
    }
    const mdPath = transcriptPath(meeting.id)
    if (!existsSync(mdPath)) {
      return err(CODES.E_STATE, '转写文件不存在，请重新转写', { meetingId: meeting.id })
    }

    const notice = privacyNoticeShown ? null : PRIVACY_NOTICE
    if (notice) {
      privacyNoticeShown = true
      logger.info('隐私提示首次触发', { meetingId: meeting.id, noticeChars: PRIVACY_NOTICE.length }, meeting.id)
    }

    const outPath = minutesPath(meeting.id)
    if (existsSync(outPath) && !force) {
      const existing = readFileSync(outPath, 'utf8')
      return ok({ meetingId: meeting.id, minutesPath: outPath, markdown: existing, notice, cached: true })
    }

    const runId = `${meeting.id}-minutes`
    const started = Date.now()
    const transcript = readFileSync(mdPath, 'utf8')

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

    writeAtomic(outPath, result.markdown)
    transition(meetingStore, meeting.id, 'minutes', 'done', { logger, runId })
    logger.info('纪要生成结束', {
      meetingId: meeting.id,
      elapsed: Math.round((Date.now() - started) / 1000),
      outputChars: result.markdown.length,
      warnings: result.warnings.length,
    }, runId)

    return ok({ meetingId: meeting.id, minutesPath: outPath, markdown: result.markdown, warnings: result.warnings, notice })
  }

  function list({ limit = 20 } = {}) {
    const size = Number(limit)
    if (!Number.isInteger(size) || size < 1 || size > 100) {
      return err(CODES.E_STATE, 'limit 必须是 1–100 的整数', { field: 'limit' })
    }
    return ok({ meetings: meetingStore.list().slice(0, size) })
  }

  function status({ meetingId } = {}) {
    if (!meetingId) return err(CODES.E_STATE, 'meetingId 必填', { field: 'meetingId' })
    const meeting = meetingStore.get(meetingId)
    if (!meeting) return err(CODES.E_STATE, `会议不存在: ${meetingId}`, { meetingId })
    return ok({ meetingId, status: meeting.status, errors: meeting.errors, stats: meeting.stats })
  }

  return {
    recordStart,
    recordStop,
    transcribe,
    minutes,
    list,
    status,
    // 测试与调试用
    store: meetingStore,
    queue,
  }
}
