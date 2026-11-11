#!/usr/bin/env node
/**
 * 桌面版（Electron）安装器的 CLI 外壳。
 *
 * 用法：
 *   node scripts/desktop.mjs install    [--profile-dir <dir>] [--force]
 *   node scripts/desktop.mjs uninstall  [--profile-dir <dir>] [--force]
 *   node scripts/desktop.mjs verify     [--profile-dir <dir>] [--json]
 *
 * 退出码：0 成功 / 2 用法或前置不满足 / 3 安装或校验失败。
 * 逻辑都在 lib/desktop.js（可注入依赖、可单测），这里只做参数解析、真依赖装配与输出。
 */

import { execSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  EXIT,
  createLogger,
  detectHostVersion,
  installDesktop,
  resolveProfileDir,
  uninstallDesktop,
  verifyDesktop,
} from '../lib/desktop.js'

const REPO_DIR = resolvePath(dirname(dirname(fileURLToPath(import.meta.url))))

const USAGE = `用法:
  node scripts/desktop.mjs install    [--profile-dir <目录>] [--force] [--json]
  node scripts/desktop.mjs uninstall  [--profile-dir <目录>] [--force] [--json]
  node scripts/desktop.mjs verify     [--profile-dir <目录>] [--json]

说明:
  install     把会记装进桌面版 profile（幂等；装前备份，失败回滚）
  uninstall   摘掉会记的接线（不动录音与转写数据）
  verify      只读自检：装没装、链接对不对、跑的是哪份代码

环境变量 NOTE_TAKER_DESKTOP_PROFILE 可指定 profile 目录（默认 ~/.dsh/profiles/desktop）。`

function parseArgs(argv) {
  const args = { command: null, profileDir: null, force: false, json: false }
  const rest = [...argv]
  while (rest.length > 0) {
    const arg = rest.shift()
    if (arg === '--profile-dir') {
      args.profileDir = rest.shift() ?? null
      if (!args.profileDir) return { error: '--profile-dir 需要一个目录参数' }
    } else if (arg.startsWith('--profile-dir=')) {
      args.profileDir = arg.slice('--profile-dir='.length)
    } else if (arg === '--force') {
      args.force = true
    } else if (arg === '--json') {
      args.json = true
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (!args.command && !arg.startsWith('-')) {
      args.command = arg
    } else {
      return { error: `不认识的参数: ${arg}` }
    }
  }
  return args
}

/** 宿主版本：读 CLI 的 `dsh --version`；读不到返回 null（宁可不说也不瞎说） */
function readHostVersion() {
  try {
    // Windows 上 dsh 是 .cmd/.ps1 包装，必须走 shell 才能解析
    const output = execSync('dsh --version', {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: true,
    })
    const version = output.trim().split(/\r?\n/)[0]?.trim()
    return version || null
  } catch {
    return null
  }
}

function realRepoDir() {
  try {
    return realpathSync.native(REPO_DIR)
  } catch {
    return REPO_DIR
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.error) {
    console.error(`错误: ${args.error}\n\n${USAGE}`)
    return EXIT.usage
  }
  if (args.help || !args.command) {
    console.log(USAGE)
    return args.help ? EXIT.ok : EXIT.usage
  }
  if (!['install', 'uninstall', 'verify'].includes(args.command)) {
    console.error(`错误: 不认识的子命令 ${args.command}\n\n${USAGE}`)
    return EXIT.usage
  }

  const lines = []
  const logger = createLogger((line) => {
    lines.push(line)
    if (!args.json) console.log(line)
  })

  const options = {
    repoDir: REPO_DIR,
    profileDir: args.profileDir ? resolvePath(args.profileDir) : resolveProfileDir(),
    fsImpl: (await import('node:fs')).default ?? (await import('node:fs')),
    logger,
    force: args.force,
    hostVersion: readHostVersion(),
    env: process.env,
    dataRoot: process.env.NOTE_TAKER_DATA || join(homedir(), '.dsh', 'note-taker'),
  }

  const runner = args.command === 'install' ? installDesktop : args.command === 'uninstall' ? uninstallDesktop : verifyDesktop
  const result = await runner(options)

  if (args.json) {
    console.log(JSON.stringify({
      command: args.command,
      ok: result.ok,
      code: result.code,
      installed: result.installed ?? null,
      alreadyInstalled: result.alreadyInstalled ?? null,
      keySource: result.keySource ?? null,
      compat: result.compat ?? null,
      checks: result.checks ?? [],
      repoDir: options.repoDir,
      profileDir: options.profileDir,
      logs: lines,
    }, null, 2))
  }

  if (result?.ok) {
    logger.info(args.command === 'uninstall' ? '完成（数据目录已保留）' : '完成')
    if (args.command !== 'uninstall') logger.info('重启桌面版后生效', { 提示: '应用需重启才会激活插件' })
  }
  return result?.code ?? EXIT.failed
}

main().then((code) => {
  process.exitCode = code
}).catch((error) => {
  console.error(`未预期的错误: ${error?.message ?? error}`)
  process.exitCode = EXIT.failed
})