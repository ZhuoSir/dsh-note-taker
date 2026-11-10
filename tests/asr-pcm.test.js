import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { frameBytesFor, framePcm, decodeToPcm } from '../lib/asr/pcm.js'

const dirs = []
after(() => {
  for (const dir of dirs) {
    try {
      import('node:fs').then(({ rmSync }) => rmSync(dir, { recursive: true, force: true }))
    } catch { /* 忽略清理失败 */ }
  }
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'note-taker-pcm-'))
  dirs.push(dir)
  return dir
}

/** 生成 48kHz 立体声 16bit WAV（1 秒 440Hz 正弦） */
function writeWav48kStereo(path, seconds = 1) {
  const sampleRate = 48000
  const channels = 2
  const frames = sampleRate * seconds
  const data = Buffer.alloc(frames * channels * 2)
  for (let i = 0; i < frames; i += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000)
    for (let c = 0; c < channels; c += 1) {
      data.writeInt16LE(value, (i * channels + c) * 2)
    }
  }

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)

  writeFileSync(path, Buffer.concat([header, data]))
  return path
}

test('帧长默认 3200 字节（16k 单声道 100ms）', () => {
  assert.equal(frameBytesFor(100, 16000), 3200)
  assert.equal(frameBytesFor(200, 16000), 6400)
})

test('整除时不留填充，末帧标记正确', () => {
  const { frames, lastFrameBytes, padded } = framePcm(Buffer.alloc(6400))
  assert.equal(frames.length, 2)
  assert.equal(lastFrameBytes, 3200)
  assert.equal(padded, false)
})

test('末帧不足时补零到整帧，并记录真实字节数', () => {
  const { frames, lastFrameBytes, padded } = framePcm(Buffer.alloc(7000))
  assert.equal(frames.length, 3)
  assert.equal(frames[2].length, 3200)
  assert.equal(lastFrameBytes, 600)
  assert.equal(padded, true)
})

test('空输入产出零帧', () => {
  const { frames, lastFrameBytes } = framePcm(Buffer.alloc(0))
  assert.equal(frames.length, 0)
  assert.equal(lastFrameBytes, 0)
})

test('非 Buffer 抛类型错误', () => {
  assert.throws(() => framePcm('not a buffer'), TypeError)
  assert.throws(() => framePcm(Buffer.alloc(10), { frameBytes: 0 }), TypeError)
})

test('解码 48kHz 立体声 → 16kHz 单声道，时长不丢', async () => {
  const dir = tempDir()
  const audio = writeWav48kStereo(join(dir, 'tone48k.wav'), 1)

  const result = await decodeToPcm(audio, { workDir: dir })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.bytes % 2, 0)
  assert.ok(Math.abs(result.durationSec - 1) < 0.1, `时长应约 1s，实际 ${result.durationSec}`)
  // 16k * 1s * 2 字节
  assert.ok(Math.abs(result.bytes - 32000) < 4000, `字节数应约 32000，实际 ${result.bytes}`)
})

test('音频不存在 → E_AUDIO', async () => {
  const result = await decodeToPcm(join(tempDir(), 'missing.wav'), { workDir: tempDir() })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_AUDIO')
})

test('损坏音频 → E_AUDIO（Python 侧返回错误信封）', async () => {
  const dir = tempDir()
  const broken = join(dir, 'broken.wav')
  writeFileSync(broken, Buffer.from('RIFF0000WAVEjunk'))

  const result = await decodeToPcm(broken, { workDir: dir })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_AUDIO')
})
