/**
 * 会记页面用的宿主侧 HTTP 路由（R-02）。
 *
 * 纪律：
 * - 全部 kind:'exact'，参数走查询串或 JSON body（不依赖未验证的路由参数能力）
 * - 响应一律 JSON 信封，复用 lib/errors.js 的错误码（不新增码）
 * - 入参一律校验；`id` 只接受安全字符，杜绝路径穿越
 * - 长任务（转写/纪要）不阻塞请求：立即返回 accepted，状态由页面轮询
 *
 * @module dsh-note-taker/routes
 */

import { CODES, err, ok } from './errors.js'

export const BASE_PATH = '/note-taker'
const MAX_BODY_BYTES = 64 * 1024
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  if (typeof res.setHeader === 'function') res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(body)
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('请求体过大'), { code: 'E_STATE' })
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { code: 'E_STATE' })
  }
}

function parseQuery(req) {
  const raw = req.url ?? ''
  const index = raw.indexOf('?')
  if (index < 0) return {}
  const params = new URLSearchParams(raw.slice(index + 1))
  return Object.fromEntries(params.entries())
}

function validateId(id) {
  if (!id) return err(CODES.E_STATE, '缺少参数 id', { field: 'id' })
  if (!ID_PATTERN.test(id)) return err(CODES.E_STATE, 'id 含非法字符', { field: 'id' })
  return null
}

/**
 * @param {object} options
 * @param {object} options.service createService() 的返回值
 * @param {object} options.logger
 * @returns {Array<{kind:string, path:string, handler:Function}>}
 */
export function buildRoutes({ service, logger }) {
  let counter = 0

  /** 统一包装：日志 + 异常兜底 */
  function wrap(name, handler) {
    return async (req, res) => {
      const requestId = `r${++counter}`
      const started = Date.now()
      const query = parseQuery(req)
      logger?.info('路由请求', { method: req.method ?? 'GET', path: `${BASE_PATH}/${name}`, query: summarize(query) }, requestId)

      try {
        const result = await handler({ req, query, requestId })
        const status = result?.ok === false ? 400 : 200
        logger?.info('路由响应', { path: name, status, ok: result?.ok !== false, elapsedMs: Date.now() - started }, requestId)
        sendJson(res, status, result)
      } catch (error) {
        logger?.error('路由错误', { path: name, code: error?.code ?? 'E_LLM', message: String(error?.message ?? error).slice(0, 200) }, requestId)
        sendJson(res, 500, err(CODES.E_LLM, `接口内部错误：${error?.message ?? error}`, {}))
      }
    }
  }

  return [
    {
      kind: 'exact',
      path: `${BASE_PATH}/list`,
      handler: wrap('list', async ({ query }) => service.list({ limit: query.limit ?? 20 })),
    },
    {
      kind: 'exact',
      path: `${BASE_PATH}/detail`,
      handler: wrap('detail', async ({ query }) => {
        const invalid = validateId(query.id)
        if (invalid) return invalid
        return service.detail({ meetingId: query.id })
      }),
    },
    {
      kind: 'exact',
      path: `${BASE_PATH}/health`,
      handler: wrap('health', async () => service.capabilities()),
    },
    {
      kind: 'exact',
      path: `${BASE_PATH}/transcribe`,
      handler: wrap('transcribe', async ({ req, requestId }) => {
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          logger?.warn('非法入参', { field: 'body', reason: String(error.message).slice(0, 50) }, requestId)
          return err(CODES.E_STATE, error.message, { field: 'body' })
        }
        const invalid = body.id ? validateId(body.id) : null
        if (invalid) return invalid

        logger?.info('动作转发', { action: 'transcribe', meetingId: body.id ?? null, engine: body.engine ?? 'local' }, requestId)
        // 长任务：不阻塞请求，后台跑，状态由页面轮询
        const promise = service.transcribe({ meetingId: body.id, engine: body.engine })
        promise?.then?.((result) => {
          if (result?.ok === false) logger?.warn('动作失败', { action: 'transcribe', code: result.code }, requestId)
        })?.catch?.(() => {})

        return ok({ accepted: true, meetingId: body.id ?? null, engine: body.engine ?? 'local' })
      }),
    },
    {
      kind: 'exact',
      path: `${BASE_PATH}/minutes`,
      handler: wrap('minutes', async ({ req, requestId }) => {
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          logger?.warn('非法入参', { field: 'body', reason: String(error.message).slice(0, 50) }, requestId)
          return err(CODES.E_STATE, error.message, { field: 'body' })
        }
        const invalid = body.id ? validateId(body.id) : null
        if (invalid) return invalid

        logger?.info('动作转发', { action: 'minutes', meetingId: body.id ?? null }, requestId)
        return service.minutes({ meetingId: body.id, force: body.force === true })
      }),
    },
    {
      kind: 'exact',
      path: `${BASE_PATH}/import`,
      handler: wrap('import', async ({ req, requestId }) => {
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          logger?.warn('非法入参', { field: 'body', reason: String(error.message).slice(0, 50) }, requestId)
          return err(CODES.E_STATE, error.message, { field: 'body' })
        }
        if (typeof body.path !== 'string' || body.path.trim() === '') {
          logger?.warn('非法入参', { field: 'path', value: String(body.path ?? '').slice(0, 40) }, requestId)
          return err(CODES.E_STATE, '缺少参数 path', { field: 'path' })
        }

        // 导入按设计接受任意本地路径（用户主动选文件），但只做「读进来存到数据目录」，
        // 不提供把任意文件内容回吐给调用方的能力（与 R-07 的路径边界不冲突）。
        logger?.info('动作转发', { action: 'import', pathLength: body.path.length }, requestId)
        return service.importAudio({ fromPath: body.path, label: body.label ?? '' })
      }),
    },
    {
      kind: 'exact',
      path: `${BASE_PATH}/record`,
      handler: wrap('record', async ({ req, requestId }) => {
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          logger?.warn('非法入参', { field: 'body', reason: String(error.message).slice(0, 50) }, requestId)
          return err(CODES.E_STATE, error.message, { field: 'body' })
        }
        if (!['start', 'stop'].includes(body.action)) {
          logger?.warn('非法入参', { field: 'action', value: String(body.action ?? '').slice(0, 20) }, requestId)
          return err(CODES.E_STATE, 'action 只能是 start 或 stop', { field: 'action' })
        }

        logger?.info('动作转发', { action: `record:${body.action}` }, requestId)
        return body.action === 'start'
          ? service.recordStart({ label: body.label ?? '' })
          : service.recordStop()
      }),
    },
  ]
}

function summarize(query) {
  const out = {}
  for (const [key, value] of Object.entries(query ?? {})) {
    out[key] = String(value).slice(0, 40)
  }
  return JSON.stringify(out)
}
