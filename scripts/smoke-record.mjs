#!/usr/bin/env node
/**
 * 录音冒烟：真的录一段时间，然后用 Python 的 wave 模块读回来核对参数。
 *
 * 用法：node scripts/smoke-record.mjs [秒数=5]
 * 退出码非零 = 验证不通过（T-06 的验证方式就是跑这个）。
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const seconds = Number(process.argv[2] ?? 5)
const dir = mkdtempSync(join(tmpdir(), 'note-taker-rec-'))
const outPath = join(dir, 'a.wav')

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function inspectWav(path) {
  const code = [
    'import json, sys, wave',
    'w = wave.open(sys.argv[1], "rb")',
    'frames = w.getnframes()',
    'rate = w.getframerate()',
    'print(json.dumps({"channels": w.getnchannels(), "sampleRate": rate, "frames": frames, "durationSec": round(frames / rate, 2)}))',
  ].join('\n')
  const result = spawnSync('python', ['-c', code, path], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } })
  if (result.status !== 0) fail(`读取 wav 失败：${(result.stderr || '').trim()}`)
  return JSON.parse(result.stdout)
}

const child = spawn('python', [join(ROOT, 'py', 'record.py'), '--out', outPath], {
  env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
})

let stdout = ''
let stderr = ''
let startedAt = null
child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
child.stderr.on('data', (chunk) => {
  const text = chunk.toString('utf8')
  stderr += text
  process.stderr.write(chunk)
  // 计时从「录音开始」那一刻算起：python 启动本身有几百毫秒，不能算进录音时长
  if (startedAt === null && text.includes('录音开始')) {
    startedAt = Date.now()
    setTimeout(() => {
      child.stdin.write('stop\n')
      child.stdin.end()
    }, seconds * 1000)
  }
})

// 兜底：设备打不开时别把脚本挂死
setTimeout(() => {
  if (startedAt === null && child.exitCode === null) {
    child.stdin.end()
    fail('等待「录音开始」超时，设备可能打不开')
  }
}, seconds * 1000 + 8000)

child.on('close', (code) => {
  if (code !== 0) fail(`record.py 退出码 ${code}；stderr 末尾:\n${stderr.trim().split('\n').slice(-5).join('\n')}`)

  let payload
  try {
    payload = JSON.parse(stdout.trim().split('\n').at(-1))
  } catch (error) {
    fail(`stdout 不是 JSON：${stdout.slice(0, 300)}`)
  }

  if (payload.ok !== true) fail(`结果不是成功信封：${JSON.stringify(payload)}`)
  if (payload.sampleRate !== 16000) fail(`采样率应为 16000，实际 ${payload.sampleRate}`)
  if (payload.channels !== 1) fail(`声道应为 1，实际 ${payload.channels}`)

  const wav = inspectWav(payload.path)
  if (wav.sampleRate !== 16000) fail(`wav 采样率应为 16000，实际 ${wav.sampleRate}`)
  if (wav.channels !== 1) fail(`wav 声道应为 1，实际 ${wav.channels}`)
  if (Math.abs(wav.durationSec - seconds) > 0.5) fail(`wav 时长应约 ${seconds}s，实际 ${wav.durationSec}s`)

  console.log(`✓ 录音冒烟通过：${payload.path}`)
  console.log(`  wav: ${wav.sampleRate}Hz / ${wav.channels}ch / ${wav.durationSec}s（${wav.frames} 帧）`)
  console.log(`  sidecar 自报: duration=${payload.durationSec}s bytes=${payload.bytes}`)
})
