#!/usr/bin/env node
/**
 * 会记（dsh-note-taker）仓库校验入口。
 *
 * 三段可组合：
 *   默认            结构清单（R-09）+ 全部单测（R-10）
 *   --structure-only 只做结构检查
 *   --tests-only     只跑单测
 *
 * 单测文件显式枚举后传给 `node --test`：直接把目录交给 node 会被当成测试文件路径。
 */

import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const args = new Set(process.argv.slice(2))
const structureOnly = args.has('--structure-only')
const testsOnly = args.has('--tests-only')

/**
 * 必需文件清单。随任务推进增长：
 * T-03 加 lib/meetings.js，T-04 加 lib/parse.js，T-05 加 lib/minutes.js，
 * T-06/T-07 加 py/ 下的 sidecar。
 */
const REQUIRED = [
  'package.json',
  'cordis.patch.yml',
  'README.md',
  'lib/index.js',
  'lib/logger.js',
  'lib/errors.js',
  'lib/meetings.js',
  'lib/parse.js',
  'lib/minutes.js',
  'lib/llm.js',
  'lib/py.js',
  'lib/jobs.js',
  'lib/service.js',
  'lib/tools.js',
  'lib/routes.js',
  'lib/client.js',
  'src/client/index.jsx',
  'src/client/logic.js',
  'src/client/api.js',
  'src/client/MeetingPage.jsx',
  'src/client/QuickPanel.jsx',
  'src/client/theme.js',
  'scripts/build-client.mjs',
  'lib/asr/config.js',
  'lib/asr/aggregate.js',
  'lib/asr/pcm.js',
  'lib/asr/http.js',
  'lib/asr/chunk.js',
  'lib/asr/wav.js',
  'py/decode_pcm.py',
  'py/_common.py',
  'py/record.py',
  'py/transcribe.py',
  'py/fetch_model.py',
  'scripts/verify.mjs',
  'scripts/install-py.mjs',
]

function checkStructure() {
  const missing = REQUIRED.filter((rel) => !existsSync(join(ROOT, rel)))
  if (missing.length > 0) {
    console.error(`结构检查: 缺 ${missing.length} 项`)
    for (const rel of missing) console.error(`  ✗ ${rel}`)
    return false
  }
  console.log(`结构检查: ${REQUIRED.length} 项全部存在`)
  return true
}

function runTests() {
  const testsDir = join(ROOT, 'tests')
  if (!existsSync(testsDir)) {
    console.error('单测: tests/ 目录不存在')
    return false
  }
  const files = readdirSync(testsDir)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => join('tests', name))
  if (files.length === 0) {
    console.error('单测: tests/ 下没有 *.test.js')
    return false
  }
  const result = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit' })
  return result.status === 0
}

if (!testsOnly && !checkStructure()) process.exit(1)
if (structureOnly) {
  console.log('（--structure-only：跳过单测）')
  process.exit(0)
}
process.exit(runTests() ? 0 : 1)
