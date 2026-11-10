#!/usr/bin/env node
/**
 * 转写冒烟：先录一小段（或复用已有 wav），再跑 py/transcribe.py，核对产物。
 *
 * 用法：node scripts/smoke-transcribe.mjs [秒数=6] [模型=tiny]
 * 退出码非零 = 验证不通过（T-07 的验证方式就是跑这个）。
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const argv = process.argv.slice(2)
const audioArgIndex = argv.indexOf('--audio')
const audioPath = audioArgIndex >= 0 ? argv[audioArgIndex + 1] : null
const positional = audioArgIndex >= 0 ? argv.filter((_, index) => index !== audioArgIndex && index !== audioArgIndex + 1) : argv
const seconds = Number(positional[0] ?? 6)
const model = positional[1] ?? 'tiny'
const dir = mkdtempSync(join(tmpdir(), 'note-taker-asr-'))
const wavPath = join(dir, 'take.wav')

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function record() {
  return new Promise((resolve, reject) => {
    const child = spawn('python', [join(ROOT, 'py', 'record.py'), '--out', wavPath], {
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    })
    let out = ''
    let started = false
    child.stdout.on('data', (chunk) => { out += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      if (!started && chunk.toString('utf8').includes('录音开始')) {
        started = true
        setTimeout(() => { child.stdin.write('stop\n'); child.stdin.end() }, seconds * 1000)
      }
    })
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`录音退出码 ${code}`))
      resolve(JSON.parse(out.trim().split('\n').at(-1)))
    })
  })
}

function transcribe(audioPath) {
  const modelDir = process.env.NOTE_TAKER_MODEL_DIR ?? join(process.env.LOCALAPPDATA ?? tmpdir(), 'note-taker-models')
  const args = [
    join(ROOT, 'py', 'transcribe.py'),
    '--audio', audioPath,
    '--out-dir', dir,
    '--stem', 'take',
    '--model', model,
    '--model-dir', modelDir,
  ]
  const result = spawnSync('python', args, {
    encoding: 'utf8',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  })
  process.stderr.write(result.stderr ?? '')
  if (result.status !== 0) {
    fail(`transcribe.py 退出码 ${result.status}：${(result.stdout || '').trim().slice(-400)}`)
  }
  return JSON.parse((result.stdout || '').trim().split('\n').at(-1))
}

let audioForTranscribe = wavPath
if (audioPath) {
  // 指定已有音频：跳过录音，直接转写（用于拿真实语音样本验证识别质量）
  console.log(`使用已有音频：${audioPath}`)
  audioForTranscribe = audioPath
} else {
  const recorded = await record()
  console.log(`录音完成：${recorded.durationSec}s → ${recorded.path}`)
}

const result = transcribe(audioForTranscribe)
if (result.ok !== true) fail(`转写返回失败信封：${JSON.stringify(result)}`)

const mdPath = join(dir, 'take.md')
const jsonPath = join(dir, 'take.json')
if (!existsSync(mdPath) || !existsSync(jsonPath)) fail('缺少 md 或 json 产物')

const detail = JSON.parse(readFileSync(jsonPath, 'utf8'))
if (!Array.isArray(detail.detail)) fail('json 里缺 detail 段数组')
for (let i = 1; i < detail.detail.length; i += 1) {
  if (detail.detail[i].start < detail.detail[i - 1].start) fail('时间戳不是单调递增')
}
const md = readFileSync(mdPath, 'utf8')
if (!md.startsWith('# 转写：take')) fail('md 缺少标题行')
if (result.segments > 0 && !/^\[\d{2}:\d{2}:\d{2}\]/m.test(md)) fail('md 不符合 [HH:MM:SS] 正文 格式')
if (audioPath && result.segments === 0) fail('给了真实语音样本却解析出 0 段，说明识别链路有问题')

// 损坏音频路径：必须返回 E_AUDIO 且不覆盖既有产物
const brokenPath = join(dir, 'broken.wav')
spawnSync('python', ['-c', `open(r"${brokenPath}","wb").write(b"RIFF0000WAVEbroken")`])
const broken = spawnSync('python', [join(ROOT, 'py', 'transcribe.py'), '--audio', brokenPath, '--out-dir', dir, '--stem', 'take', '--model', model], {
  encoding: 'utf8',
  env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
})
const brokenPayload = JSON.parse((broken.stdout || '{}').trim().split('\n').at(-1) || '{}')
if (brokenPayload.ok !== false || !['E_AUDIO', 'E_MODEL'].includes(brokenPayload.code)) {
  fail(`损坏音频应返回 E_AUDIO（或模型不可用的 E_MODEL），实际：${JSON.stringify(brokenPayload)}`)
}
if (readFileSync(mdPath, 'utf8') !== md) fail('失败路径覆盖了既有 md 产物')

console.log(`✓ 转写冒烟通过：${result.segments} 段 / ${result.chars} 字 / ${result.durationSec}s / rtf=${result.rtf}`)
console.log(`  坏音频路径：${brokenPayload.code}（既有产物未被覆盖）`)
