/**
 * 音频 → 16kHz 单声道 PCM 分帧。
 *
 * 解码交给 Python（PyAV 已在用，见 lib/py.js）；本模块只做两件事：
 * - 调 py/decode_pcm.py 把任意音频转成 s16le 裸流
 * - 把裸流切成固定长度帧（默认 100ms = 3200 字节），末帧补零并记录真实长度
 *
 * @module dsh-note-taker/asr/pcm
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CODES, err, ok } from '../errors.js'
import { runSidecar } from '../py.js'

export const FRAME_MS = 100
export const SAMPLE_RATE = 16_000
export const BYTES_PER_SAMPLE = 2

export function frameBytesFor(frameMs = FRAME_MS, sampleRate = SAMPLE_RATE) {
  return Math.round((sampleRate * frameMs) / 1000) * BYTES_PER_SAMPLE
}

/**
 * 纯函数：把 PCM 裸流切成帧。
 * @returns {{frames:Buffer[], frameBytes:number, lastFrameBytes:number, padded:boolean, totalBytes:number}}
 */
export function framePcm(buffer, { frameBytes = frameBytesFor() } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('framePcm 需要 Buffer')
  if (!Number.isInteger(frameBytes) || frameBytes <= 0) throw new TypeError('frameBytes 必须是正整数')

  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const chunk = buffer.subarray(offset, offset + frameBytes)
    if (chunk.length === frameBytes) {
      frames.push(Buffer.from(chunk))
    } else {
      const padded = Buffer.alloc(frameBytes)
      chunk.copy(padded)
      frames.push(padded)
    }
    offset += frameBytes
  }

  const lastFrameBytes = buffer.length === 0 ? 0 : buffer.length - frameBytes * (frames.length - 1)
  return { frames, frameBytes, lastFrameBytes, padded: lastFrameBytes !== frameBytes, totalBytes: buffer.length }
}

/**
 * 解码音频文件为 16k 单声道 s16le。
 * @returns {Promise<{ok:true, pcm:Buffer, durationSec:number, bytes:number} | {ok:false, code:string, message:string, detail:object}>}
 */
export async function decodeToPcm(audioPath, { workDir, runner = runSidecar } = {}) {
  if (!audioPath || !existsSync(audioPath)) {
    return err(CODES.E_AUDIO, '找不到音频文件', { audio: audioPath ?? null })
  }
  const dir = workDir ?? dirname(audioPath)
  mkdirSync(dir, { recursive: true })
  const outPath = join(dir, `${Date.now()}-${Math.random().toString(16).slice(2, 8)}.pcm`)

  const result = await runner('decode_pcm.py', ['--audio', audioPath, '--out', outPath, '--sample-rate', String(SAMPLE_RATE)])

  if (!result.ok || result.payload?.ok !== true) {
    rmSync(outPath, { force: true })
    const code = result.payload?.code && CODES[result.payload.code] ? result.payload.code : CODES.E_AUDIO
    return err(code, result.payload?.message ?? '音频解码失败', { audio: audioPath })
  }

  const pcm = readFileSync(outPath)
  const bytes = statSync(outPath).size
  return ok({ pcm, bytes, durationSec: result.payload.durationSec ?? bytes / (SAMPLE_RATE * BYTES_PER_SAMPLE) })
}
