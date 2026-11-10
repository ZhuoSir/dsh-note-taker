/**
 * 会记（dsh-note-taker）插件入口。
 *
 * 分层：宿主侧（本文件与 lib/）负责编排、工具注册与模型调用；重活在 py/ 的 Python sidecar。
 * 依赖服务：tools（注册工具）、llm（用用户在 DSH 里已配置的模型生成纪要）。
 *
 * @module dsh-note-taker
 */

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { createLogger } from './logger.js'
import { buildRoutes } from './routes.js'
import { createService } from './service.js'
import { buildTools } from './tools.js'

export const name = 'dsh-note-taker'
export const version = '0.1.0'
export const inject = ['tools', 'llm']

const DATA_ENV = 'NOTE_TAKER_DATA'
const DEFAULT_ROOT = join('.dsh', 'note-taker')
const DEFAULT_MODEL = 'small'
const DEFAULT_THREADS = 6

const logger = createLogger({ module: 'note-taker' })

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
    llmProvider: env.NOTE_TAKER_LLM_PROVIDER || null,
    llmModel: env.NOTE_TAKER_LLM_MODEL || null,
    engine: (env.NOTE_TAKER_ASR_ENGINE || 'local').toLowerCase() === 'cloud' ? 'cloud' : 'local',
  }
}

export function apply(ctx) {
  const config = resolveConfig()

  // 数据根自检：不可写要报出来，但绝不能抛出——抛异常会让整个 web 壳起不来（R-01 边界）
  try {
    mkdirSync(config.root, { recursive: true })
  } catch (error) {
    logger.error('数据根不可写，本插件将不可用', {
      root: config.root,
      code: error.code,
      action: `设置环境变量 ${DATA_ENV} 指向可写目录`,
    })
    return { ok: false, config }
  }

  const service = createService({ config, logger, llm: ctx?.llm })
  const tools = buildTools({ service })

  logger.info('插件启动', {
    name,
    version,
    tools: tools.length,
    root: config.root,
    rootSource: config.rootSource,
  })
  logger.info('配置加载', {
    model: config.model,
    threads: config.threads,
    llmProvider: config.llmProvider ?? 'default',
    llmModel: config.llmModel ?? 'default',
    firstRun: service.store.list().length === 0,
  })

  if (ctx?.tools?.register) {
    for (const tool of tools) ctx.tools.register(tool)
  }

  // 页面用的 HTTP 路由：不写进 inject（headless 等场景可能没有 webServer），拿不到就跳过
  let routeCount = 0
  try {
    const webServer = ctx?.webServer ?? ctx?.get?.('webServer')
    if (webServer?.register) {
      for (const route of buildRoutes({ service, logger })) {
        webServer.register(route)
        routeCount += 1
      }
      logger.info('路由注册完成', { routes: routeCount, basePath: '/note-taker' })
    } else {
      logger.warn('宿主未提供 webServer，页面接口不可用', {})
    }
  } catch (error) {
    logger.error('路由注册失败', { reason: String(error?.message ?? error).slice(0, 160) })
  }

  return { ok: true, config, service, routes: routeCount }
}
