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
