/**
 * 会记（dsh-note-taker）插件入口。
 *
 * 分层：宿主侧（本文件与 lib/）负责编排、工具注册与模型调用；重活在 py/ 的 Python sidecar。
 * 当前进度：T-01 落骨架与启动记录。工具注册在 T-09，日志与错误信封会在 T-02 抽到 lib/logger.js
 * 与 lib/errors.js（现在是最小内联实现，够 T-01 的日志断言用）。
 *
 * @module dsh-note-taker
 */

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-note-taker'
export const version = '0.1.0'
/** tools：注册对外工具；llm：用用户在 DSH 里已配置的模型生成纪要（见 plan 决策 2） */
export const inject = ['tools', 'llm']

const DATA_ENV = 'NOTE_TAKER_DATA'
const DEFAULT_ROOT = join('.dsh', 'note-taker')
const DEFAULT_MODEL = 'small'
const DEFAULT_THREADS = 6

/** T-09 起往里注册工具；启动日志要报工具数，所以先有容器 */
const tools = []

const LEVEL_TEXT = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' }

/**
 * 一行结构化日志：时间 级别 [runId] 模块 - 中文消息, k=v。
 * 不落转写正文与提示词（plan 日志点清单的敏感纪律）。
 */
function log(level, module, message, fields = {}, runId = '-') {
  const kv = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')
  const line = `${new Date().toISOString()} ${LEVEL_TEXT[level] ?? 'INFO '} [${runId}] ${module} - ${message}${kv ? ', ' + kv : ''}`
  process.stdout.write(line + '\n')
}

/**
 * 数据根与默认配置。
 * 数据根必须可覆盖：开发期会话对 ~/.dsh 只读（lessons L-06），所以 NOTE_TAKER_DATA 优先级最高。
 */
export function resolveConfig(env = process.env) {
  const override = env[DATA_ENV]
  return {
    root: override || join(homedir(), DEFAULT_ROOT),
    rootSource: override ? `env:${DATA_ENV}` : 'default:~/.dsh/note-taker',
    model: env.NOTE_TAKER_MODEL || DEFAULT_MODEL,
    threads: Number.parseInt(env.NOTE_TAKER_THREADS || String(DEFAULT_THREADS), 10),
  }
}

export function apply(ctx) {
  const config = resolveConfig()

  // 数据根自检：不可写要报出来，但绝不能抛出——抛异常会让整个 web 壳起不来（R-01 边界）
  try {
    mkdirSync(config.root, { recursive: true })
  } catch (error) {
    log('error', 'note-taker', '数据根不可写，本插件将不可用', {
      root: config.root,
      code: error.code,
      action: `设置环境变量 ${DATA_ENV} 指向可写目录`,
    })
    return { ok: false, config }
  }

  const firstRun = !existsSync(join(config.root, 'meetings.json'))

  log('info', 'note-taker', '插件启动', {
    name,
    version,
    tools: tools.length,
    root: config.root,
    rootSource: config.rootSource,
  })
  log('info', 'note-taker', '配置加载', {
    model: config.model,
    threads: config.threads,
    firstRun,
  })

  if (ctx?.tools) {
    for (const tool of tools) ctx.tools.register(tool)
  }

  return { ok: true, config }
}
