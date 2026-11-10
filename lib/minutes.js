/**
 * 纪要：结构校验（T-05）与生成（T-08）。
 *
 * 结构契约（requirements R-06）固定七项，缺任何一项都不许落盘：
 *   # 标题
 *   > 日期: YYYY-MM-DD | 时长: N 分钟
 *   ## 一句话摘要
 *   ## 议题
 *   ## 决议
 *   ## 行动项     ← 表格：负责人 | 事项 | 截止时间；无行动项时明写「本次无行动项」
 *
 * 设计取舍（plan 决策 2）：校验器不判断内容好不好，只判断结构全不全、行动项缺不缺字段。
 * 语义质量由模型负责，结构完整性由这里兜住——这是「不合格不落盘」的唯一闸口。
 *
 * @module dsh-note-taker/minutes
 */

export const REQUIRED_SECTIONS = Object.freeze([
  { key: 'title', label: '标题' },
  { key: 'meta', label: '日期与时长' },
  { key: 'summary', label: '一句话摘要', heading: '一句话摘要' },
  { key: 'topics', label: '议题', heading: '议题' },
  { key: 'decisions', label: '决议', heading: '决议' },
  { key: 'actions', label: '行动项', heading: '行动项' },
])

export const NO_ACTION_TEXT = '本次无行动项'

/** 把 markdown 切成 { 标题: 内容 } 的二级章节表 */
function splitSections(markdown) {
  const sections = new Map()
  let current = null
  for (const rawLine of markdown.split(/\r?\n/)) {
    const heading = rawLine.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      current = heading[1]
      sections.set(current, [])
      continue
    }
    if (current) sections.get(current).push(rawLine)
  }
  for (const [key, lines] of sections) sections.set(key, lines.join('\n').trim())
  return sections
}

/** 行动项表格 → 行数组（跳过表头与分隔行） */
function parseActionRows(sectionText) {
  const rows = []
  for (const line of sectionText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    const cells = trimmed.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue // |---|---|
    if (cells[0] === '负责人') continue // 表头
    rows.push(cells)
  }
  return rows
}

/**
 * @param {string} markdown
 * @returns {{ ok:boolean, missing:string[], warnings:string[], actionItems:Array<{owner:string,item:string,deadline:string}> }}
 */
export function validateMinutes(markdown) {
  const missing = []
  const warnings = []
  const actionItems = []

  if (typeof markdown !== 'string' || markdown.trim() === '') {
    return {
      ok: false,
      missing: REQUIRED_SECTIONS.map((section) => section.label),
      warnings,
      actionItems,
    }
  }

  const title = markdown.match(/^#\s+(.+?)\s*$/m)
  if (!title || title[1].trim() === '') missing.push('标题')

  const metaLine = markdown.split(/\r?\n/).find((line) => line.trim().startsWith('>'))
  if (!metaLine || !metaLine.includes('日期') || !metaLine.includes('时长')) missing.push('日期与时长')

  const sections = splitSections(markdown)
  for (const section of REQUIRED_SECTIONS) {
    if (!section.heading) continue
    const content = sections.get(section.heading)
    if (content === undefined || content === '') {
      missing.push(section.label)
      continue
    }
    if (section.key !== 'actions') continue

    // 行动项章节的合格条件：有表格行，或明写「本次无行动项」
    const rows = parseActionRows(content)
    if (rows.length === 0) {
      if (!content.includes(NO_ACTION_TEXT)) missing.push(`${section.label}（既无表格也未写「${NO_ACTION_TEXT}」）`)
      continue
    }
    rows.forEach((cells, index) => {
      const [owner = '', item = '', deadline = ''] = cells
      const pending = []
      if (!owner || owner === '—' || owner === '-') pending.push('负责人')
      if (!deadline || deadline === '—' || deadline === '-' || deadline.includes('待补')) pending.push('截止时间')
      actionItems.push({ owner, item, deadline })
      if (pending.length > 0) {
        warnings.push(`行动项第 ${index + 1} 条（${item || '未填事项'}）缺${pending.join('与')}，已标待补`)
      }
    })
  }

  return { ok: missing.length === 0, missing, warnings, actionItems }
}

const SYSTEM_PROMPT =
  '你是会议纪要整理助手。只输出 markdown 正文，不要解释过程，不要用代码块围栏包住整篇内容。'

/**
 * 组装纪要提示。structure 与 validateMinutes 校验的结构严格一一对应，
 * 任何一侧改了结构，另一侧必须同步改（tests/minutes-generate.test.js 卡这条）。
 */
export function buildMinutesPrompt({ meeting, transcript, stats, today = new Date().toISOString().slice(0, 10) }) {
  const minutes = meeting?.durationSec ? Math.round(meeting.durationSec / 60) : 0
  const lines = [
    '请把下面这段会议转写整理成会议纪要。转写里 [HH:MM:SS] 是时间，其他都是发言内容。',
    '',
    '必须严格包含以下六个部分，一个都不能少，标题层级照抄：',
    '',
    '# <会议标题>',
    '> 日期: <YYYY-MM-DD> | 时长: <N> 分钟',
    '',
    '## 一句话摘要',
    '<不超过 60 字>',
    '',
    '## 议题',
    '- <逐条列出讨论的议题>',
    '',
    '## 决议',
    '- <逐条列出已达成的结论；确实没有就写「本次无决议」>',
    '',
    '## 行动项',
    '| 负责人 | 事项 | 截止时间 |',
    '|---|---|---|',
    '| <姓名> | <要做的事> | <YYYY-MM-DD 或 待补> |',
    '',
    '规则：',
    '1. 只依据转写内容，不臆造人名、数字与结论。',
    '2. 行动项完全为零时，把表格整体替换为一行：本次无行动项',
    '3. 某条行动项缺负责人或截止时间，就写「待补」，不要省略这一行。',
    `4. 会议日期取今天（${today}），时长按 ${minutes} 分钟写；转写里若有更准确的时间以转写为准。`,
    '',
    '会议元信息：',
    `- 标签: ${meeting?.label || '未命名'}`,
    `- 转写段数: ${stats?.segments ?? 0}`,
    '',
    '转写全文：',
    transcript,
  ]
  return { system: SYSTEM_PROMPT, user: lines.join('\n') }
}

/** 模型有时会用 ```markdown 包住整篇，剥掉围栏再校验 */
export function stripFence(text) {
  const trimmed = String(text ?? '').trim()
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/)
  return fenced ? fenced[1].trim() : trimmed
}

/**
 * 生成纪要：调模型 → 剥围栏 → 结构校验。
 * 校验不通过**不返回 markdown**，调用方据此不落盘（R-06 边界）。
 *
 * @returns {Promise<{ok:true, markdown:string, warnings:string[], actionItems:object[]} | {ok:false, code:'E_LLM'|'E_STATE', message:string, detail:object}>}
 */
export async function generateMinutes({ llmClient, meeting, transcript, stats, today }) {
  if (!llmClient) return { ok: false, code: 'E_LLM', message: '没有可用的模型客户端', detail: {} }
  if (typeof transcript !== 'string' || transcript.trim() === '') {
    return { ok: false, code: 'E_STATE', message: '转写内容为空，无法生成纪要', detail: {} }
  }

  const prompt = buildMinutesPrompt({ meeting, transcript, stats, today })

  let raw
  try {
    raw = await llmClient.complete(prompt.user, { system: prompt.system })
  } catch (error) {
    return { ok: false, code: 'E_LLM', message: '模型调用失败', detail: { reason: String(error?.message ?? error) } }
  }

  const markdown = stripFence(raw)
  const validation = validateMinutes(markdown)
  if (!validation.ok) {
    return {
      ok: false,
      code: 'E_STATE',
      message: `纪要结构不完整，未落盘：缺 ${validation.missing.join('、')}`,
      detail: { missing: validation.missing, warnings: validation.warnings },
    }
  }

  return { ok: true, markdown, warnings: validation.warnings, actionItems: validation.actionItems }
}
