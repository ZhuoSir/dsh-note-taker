import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createLlmClient, collectStream } from '../lib/llm.js'
import { buildMinutesPrompt, generateMinutes, stripFence } from '../lib/minutes.js'

const GOOD_MINUTES = `# 周会纪要

> 日期: 2026-11-10 | 时长: 40 分钟

## 一句话摘要
本周敲定 5% 灰度并指定负责人。

## 议题
- 灰度范围

## 决议
- 下周一开始 5% 灰度

## 行动项
| 负责人 | 事项 | 截止时间 |
|---|---|---|
| 张三 | 出灰度方案 | 2026-11-15 |
`

const BAD_MINUTES = `# 周会纪要

> 日期: 2026-11-10 | 时长: 40 分钟

## 一句话摘要
缺少决议章节的版本。

## 议题
- 灰度范围

## 行动项
本次无行动项
`

/** 按 DSH StreamChunk 契约造一个假流 */
function chunkStream(text, { finishKind = 'stop' } = {}) {
  const chunks = [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...text.match(/[\s\S]{1,20}/g).map((piece) => ({ type: 'text-delta', index: 0, text: piece })),
    { type: 'finish', reason: { kind: finishKind } },
  ]
  return (async function* gen() {
    for (const chunk of chunks) yield chunk
  })()
}

function fakeLlm(text, options) {
  return { stream: () => chunkStream(text, options) }
}

const MEETING = { id: 'm-1', label: '周会', durationSec: 2400 }
const STATS = { segments: 42, durationSec: 2400, chars: 5000 }
const TRANSCRIPT = '[00:00:10] 张三：灰度先做 5%。\n[00:00:20] 李四：我出方案，15 号前。'

test('collectStream 按 block 顺序拼接文本', async () => {
  const { text, finishKind } = await collectStream(chunkStream('你好，会记'))
  assert.equal(text, '你好，会记')
  assert.equal(finishKind, 'stop')
})

test('collectStream 对 error 结束原因抛错', async () => {
  const stream = (async function* gen() {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: '半截' }
    yield { type: 'finish', reason: { kind: 'error', failure: { message: '额度不足' } } }
  })()
  await assert.rejects(() => collectStream(stream), /额度不足/)
})

test('createLlmClient 缺 llm 服务时抛错', () => {
  assert.throws(() => createLlmClient({}), /llm/)
})

test('createLlmClient 把 system + user 一起送进 messages', async () => {
  let seen
  const llm = {
    stream: (options) => {
      seen = options
      return chunkStream(GOOD_MINUTES)
    },
  }
  const client = createLlmClient({ llm, provider: 'deepseek', model: 'deepseek-chat' })
  const text = await client.complete('正文', { system: '系统' })

  assert.equal(text, GOOD_MINUTES)
  assert.deepEqual(seen.messages.map((item) => item.role), ['system', 'user'])
  assert.equal(seen.provider, 'deepseek')
  assert.equal(seen.model, 'deepseek-chat')
})

test('buildMinutesPrompt 里的结构说明与校验器一致（六个部分都提到）', () => {
  const prompt = buildMinutesPrompt({ meeting: MEETING, transcript: TRANSCRIPT, stats: STATS, today: '2026-11-10' })
  for (const heading of ['# <会议标题>', '## 一句话摘要', '## 议题', '## 决议', '## 行动项', '日期: ', '时长: ']) {
    assert.ok(prompt.user.includes(heading), `提示词缺少结构片段：${heading}`)
  }
  assert.ok(prompt.user.includes('本次无行动项'))
  assert.ok(prompt.user.includes(TRANSCRIPT))
})

test('stripFence 剥掉 markdown 代码围栏', () => {
  assert.equal(stripFence('```markdown\n# 标题\n```'), '# 标题')
  assert.equal(stripFence('# 标题'), '# 标题')
})

test('generateMinutes 成功路径：结构合格则返回 markdown 与行动项', async () => {
  const llmClient = createLlmClient({ llm: fakeLlm(`\`\`\`markdown\n${GOOD_MINUTES}\n\`\`\``) })
  const result = await generateMinutes({ llmClient, meeting: MEETING, transcript: TRANSCRIPT, stats: STATS })

  assert.equal(result.ok, true)
  assert.ok(result.markdown.startsWith('# 周会纪要'))
  assert.deepEqual(result.actionItems, [{ owner: '张三', item: '出灰度方案', deadline: '2026-11-15' }])
})

test('generateMinutes 缺章节：拒绝出稿并点名缺失项', async () => {
  const llmClient = createLlmClient({ llm: fakeLlm(BAD_MINUTES) })
  const result = await generateMinutes({ llmClient, meeting: MEETING, transcript: TRANSCRIPT, stats: STATS })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_STATE')
  assert.deepEqual(result.detail.missing, ['决议'])
  assert.equal(result.markdown, undefined, '不合格时绝不能带 markdown 出去')
})

test('generateMinutes 模型报错 → E_LLM', async () => {
  const llmClient = createLlmClient({ llm: fakeLlm('半截', { finishKind: 'error' }) })
  const result = await generateMinutes({ llmClient, meeting: MEETING, transcript: TRANSCRIPT, stats: STATS })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_LLM')
})

test('generateMinutes 空转写 → E_STATE', async () => {
  const llmClient = createLlmClient({ llm: fakeLlm(GOOD_MINUTES) })
  const result = await generateMinutes({ llmClient, meeting: MEETING, transcript: '  ', stats: STATS })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_STATE')
})
