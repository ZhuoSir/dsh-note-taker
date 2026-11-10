/**
 * 宿主 llm 服务的薄封装。
 *
 * chunk 契约来自已装插件 `dsh-vision-router` 的兼容层（`lib/vision-chunk-assembler.js`），
 * 也就是 DSH 公共 StreamChunk：
 *   { type:'block-start', index, blockType }
 *   { type:'text-delta',  index, text }
 *   { type:'block-end',   index, block:{ text } }
 *   { type:'finish',      reason:{ kind:'stop'|'error'|'aborted', failure? } }
 *   { type:'error'|'aborted', failure }
 *
 * 组装器对旧形态（OpenAI 风格 `choices[0].delta.content`）保留一条兼容分支，
 * 但正式路径只认上面的契约——不要把兼容分支当主线用。
 *
 * @module dsh-note-taker/llm
 */

export class LlmError extends Error {
  constructor(message, { cause } = {}) {
    super(message)
    this.name = 'LlmError'
    if (cause) this.cause = cause
  }
}

/** 把流式 chunk 收敛成完整文本；出错抛 LlmError */
export async function collectStream(stream) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
    throw new LlmError('llm.stream 没有返回可迭代的流')
  }

  const parts = new Map()
  const order = []
  let failure = null
  let finishKind = 'stop'

  for await (const chunk of stream) {
    if (!chunk || typeof chunk !== 'object') continue

    switch (chunk.type) {
      case 'block-start':
        if (!parts.has(chunk.index)) {
          parts.set(chunk.index, '')
          order.push(chunk.index)
        }
        break
      case 'text-delta':
        if (parts.has(chunk.index)) parts.set(chunk.index, parts.get(chunk.index) + (chunk.text ?? ''))
        break
      case 'block-end':
        if (parts.has(chunk.index) && typeof chunk.block?.text === 'string') {
          parts.set(chunk.index, chunk.block.text)
        }
        break
      case 'finish': {
        const reason = chunk.reason ?? {}
        finishKind = reason.kind ? String(reason.kind) : 'stop'
        if (reason.kind === 'error' || reason.kind === 'aborted') {
          failure = reason.failure ?? new LlmError(`模型流结束原因为 ${reason.kind}`)
        }
        break
      }
      case 'error':
      case 'aborted':
        failure = chunk.failure ?? new LlmError(`模型流中断：${chunk.type}`)
        break
      default: {
        // 兼容旧形态；新代码不应依赖这条分支
        const delta = chunk.choices?.[0]?.delta?.content
        if (typeof delta === 'string') {
          if (!parts.has(0)) {
            parts.set(0, '')
            order.push(0)
          }
          parts.set(0, parts.get(0) + delta)
        }
      }
    }
  }

  if (failure) {
    if (failure instanceof Error) throw new LlmError(failure.message, { cause: failure })
    throw new LlmError(String(failure.message ?? failure))
  }

  return { text: order.map((index) => parts.get(index)).join(''), finishKind }
}

/**
 * @param {object} options
 * @param {object} options.llm 宿主 ctx.llm
 * @param {string} [options.provider] 缺省交给宿主用当前配置
 * @param {string} [options.model]
 */
export function createLlmClient({ llm, provider, model } = {}) {
  if (!llm || typeof llm.stream !== 'function') {
    throw new LlmError('宿主没有提供可用的 llm 服务（ctx.llm.stream 不存在）')
  }

  return {
    provider: provider ?? null,
    model: model ?? null,
    async complete(prompt, { system } = {}) {
      const messages = []
      if (system) messages.push({ role: 'system', content: system })
      messages.push({ role: 'user', content: prompt })

      const options = { messages }
      if (provider) options.provider = provider
      if (model) options.model = model

      const { text } = await collectStream(llm.stream(options))
      if (text.trim() === '') throw new LlmError('模型返回了空内容')
      return text
    },
  }
}
