#!/usr/bin/env node
/**
 * 端到端演练：录音（真实设备）→ 转写（真实 faster-whisper）→ 纪要（模型适配器）。
 *
 * 说明：这个脚本里 llm 用**桩**（stubLLM），只验证「编排 + 真实 sidecar + 校验 + 落盘」这条链；
 * 真模型调用需要插件装进 DSH profile 后由宿主提供 ctx.llm，脚本内无法伪造宿主。
 * 因此脚本会在结论里明确标出哪一段是桩，避免把桩当实测（诚实性）。
 *
 * 用法：node scripts/e2e.mjs [录音秒数=5] [模型=tiny]
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLogger } from '../lib/logger.js'
import { transition } from '../lib/jobs.js'
import { createService } from '../lib/service.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const argv = process.argv.slice(2)
const audioIndex = argv.indexOf('--audio')
const audioPath = audioIndex >= 0 ? argv[audioIndex + 1] : null
const positional = audioIndex >= 0 ? argv.filter((_, index) => index !== audioIndex && index !== audioIndex + 1) : argv
const seconds = Number(positional[0] ?? 5)
const model = positional[1] ?? 'tiny'

const STUB_MINUTES = `# 端到端演练纪要

> 日期: 2026-11-10 | 时长: 1 分钟

## 一句话摘要
这是演练用的桩输出，不代表真实会议内容。

## 议题
- 链路连通性

## 决议
- 录音与转写由真实 sidecar 完成

## 行动项
| 负责人 | 事项 | 截止时间 |
|---|---|---|
| 陈卓 | 把插件装进 profile 后补一次真模型验证 | 待补 |
`

const stubLLM = {
  stream: () => {
    const chunks = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: STUB_MINUTES },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    return (async function* gen() {
      for (const chunk of chunks) yield chunk
    })()
  },
}

const dataRoot = mkdtempSync(join(tmpdir(), 'note-taker-e2e-'))
const config = {
  root: dataRoot,
  model,
  threads: 4,
  llmProvider: null,
  llmModel: null,
}
const logger = createLogger({ module: 'e2e' })
const service = createService({ config, logger, llm: stubLLM })

console.log(`数据目录: ${dataRoot}`)

let meetingId
if (audioPath) {
  // 用已有语音文件登记一场会议：跳过麦克风（本机扬声器放不出声、也无 loopback 设备），
  // 但转录与纪要走的是同一条真实链路。
  const sha256 = createHash('sha256').update(readFileSync(audioPath)).digest('hex')
  const created = service.store.create({
    label: 'E2E（真实语音）',
    startedAt: new Date().toISOString(),
    audio: { path: audioPath, sha256, sampleRate: 0, channels: 0 },
  })
  meetingId = created.meeting.id
  transition(service.store, meetingId, 'record', 'running', { logger })
  transition(service.store, meetingId, 'record', 'done', { logger })
  console.log(`① 登记真实语音：${audioPath}（跳过麦克风采集）`)
} else {
  const started = await service.recordStart({ label: 'E2E 演练' })
  if (!started.ok) {
    console.error(`✗ 录音启动失败：${started.code} ${started.message}`)
    process.exit(1)
  }
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
  const stopped = await service.recordStop()
  if (!stopped.ok) {
    console.error(`✗ 录音收尾失败：${stopped.code} ${stopped.message}`)
    process.exit(1)
  }
  meetingId = stopped.meetingId
  console.log(`① 录音完成：${stopped.durationSec}s → ${stopped.audioPath}`)
}

const transcribed = await service.transcribe({ meetingId, model })
if (!transcribed.ok) {
  console.error(`✗ 转写失败：${transcribed.code} ${transcribed.message}`)
  process.exit(1)
}
console.log(`② 转写完成：${transcribed.segments} 段 / ${transcribed.chars} 字 / rtf=${transcribed.rtf} → ${transcribed.transcriptPath}`)

const minutes = await service.minutes({ meetingId })
if (!minutes.ok) {
  console.error(`✗ 纪要失败：${minutes.code} ${minutes.message}`)
  process.exit(1)
}
console.log(`③ 纪要完成：[桩模型] → ${minutes.minutesPath}`)

const status = service.status({ meetingId })
console.log(`④ 最终状态：${JSON.stringify(status.status)}`)
console.log('\n产物：')
for (const [name, path] of Object.entries({
  transcript: transcribed.transcriptPath,
  minutes: minutes.minutesPath,
})) {
  console.log(`  ${name}: ${path}（${readFileSync(path, 'utf8').length} 字符）`)
}
console.log('\n转写内容（前 6 行）：')
for (const line of readFileSync(transcribed.transcriptPath, 'utf8').trim().split('\n').slice(0, 6)) {
  console.log(`  ${line}`)
}
console.log('\n⚠ 第 ③ 步用的是桩模型；真实模型调用需插件装进可用 profile 后补验。')
console.log(`   数据目录保留在 ${dataRoot} 供人工核对（脚本不自动清理）。`)
