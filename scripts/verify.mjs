#!/usr/bin/env node
/**
 * 会记（dsh-note-taker）仓库校验入口。
 *
 * 两段：结构清单（R-09）+ 单测（R-10）。
 * `--structure-only` 只跑第一段——任务 T-01 落骨架期用它；T-10 之后默认跑全量。
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const structureOnly = process.argv.includes('--structure-only')

/**
 * 必需文件清单。随任务推进增长：
 * T-06 加 py/record.py 与 py/_common.py，T-07 加 py/transcribe.py，T-10 收口单测。
 */
const REQUIRED = [
  'package.json',
  'cordis.patch.yml',
  'README.md',
  'lib/index.js',
  'lib/logger.js',
  'lib/errors.js',
  'scripts/verify.mjs',
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
  if (!existsSync(join(ROOT, 'tests'))) {
    console.error('单测: tests/ 尚未建立（T-04 起逐步补齐，T-10 收口）')
    return false
  }
  const result = spawnSync(process.execPath, ['--test', 'tests/'], { cwd: ROOT, stdio: 'inherit' })
  return result.status === 0
}

if (!checkStructure()) process.exit(1)
if (structureOnly) {
  console.log('（--structure-only：跳过单测）')
  process.exit(0)
}
process.exit(runTests() ? 0 : 1)
