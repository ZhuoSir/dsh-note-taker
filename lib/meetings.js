/**
 * 会议索引：meetings.json 的读写。
 *
 * 设计取舍见 plan 决策 3：单 JSON 索引 + 每会议独立文件，零依赖、可人读、可手工修。
 * - 原子写：先写 `<文件>.tmp` 再 rename，避免读到的半个文件
 * - 索引损坏：报错并保留原文件，**绝不静默重置**（那等于把用户的会议记录删了）
 * - 去重：同一音频 sha256 命中既有条目即返回既有 id
 *
 * 状态机与串行队列在 jobs.js（T-09），本模块只负责存取与字段校验。
 *
 * @module dsh-note-taker/meetings
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const INDEX_FILE = 'meetings.json'
export const SCHEMA_VERSION = 1

/** 会议状态取值（plan 数据模型） */
export const STATUS_VALUES = Object.freeze(['pending', 'running', 'done', 'failed'])

/** 可被 patch 的字段白名单 */
const PATCHABLE = new Set(['label', 'endedAt', 'durationSec', 'audio', 'status', 'stats', 'errors', 'engine'])

export class MeetingStoreError extends Error {
  constructor(message, { cause } = {}) {
    super(message)
    this.name = 'MeetingStoreError'
    if (cause) this.cause = cause
  }
}

function pad(value, width) {
  return String(value).padStart(width, '0')
}

/** 会议 id：yyyyMMdd-HHmm-xxxx，含时间前缀便于人读与排序 */
export function makeMeetingId(date = new Date(), random = Math.random) {
  const suffix = Math.floor(random() * 0x10000).toString(16).padStart(4, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}` +
    `-${pad(date.getHours(), 2)}${pad(date.getMinutes(), 2)}-${suffix}`
  )
}

function emptyStatus() {
  return { record: 'pending', transcribe: 'pending', minutes: 'pending' }
}

export function createStore({ root, now = () => new Date(), idFactory = makeMeetingId }) {
  if (!root) throw new MeetingStoreError('createStore 需要 root')
  const indexPath = join(root, INDEX_FILE)

  function readIndex() {
    if (!existsSync(indexPath)) return { version: SCHEMA_VERSION, meetings: [] }
    const raw = readFileSync(indexPath, 'utf8')
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new MeetingStoreError(
        `会议索引损坏，未做任何写入：${indexPath}（${error.message}）；请手工修复或移走该文件后重试`,
        { cause: error },
      )
    }
    if (!parsed || !Array.isArray(parsed.meetings)) {
      throw new MeetingStoreError(`会议索引结构不合法（缺 meetings 数组）：${indexPath}`)
    }
    return parsed
  }

  function writeIndex(index) {
    mkdirSync(root, { recursive: true })
    const tmpPath = `${indexPath}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
    try {
      renameSync(tmpPath, indexPath)
    } finally {
      if (existsSync(tmpPath)) rmSync(tmpPath, { force: true })
    }
  }

  function validateStatus(status) {
    for (const [field, value] of Object.entries(status ?? {})) {
      if (!(field in emptyStatus())) throw new MeetingStoreError(`未知状态字段: ${field}`)
      if (!STATUS_VALUES.includes(value)) throw new MeetingStoreError(`非法状态值 ${field}=${value}`)
    }
  }

  return {
    root,
    indexPath,

    /** 全部会议，按开始时间倒序（新的在前） */
    list() {
      return [...readIndex().meetings].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    },

    get(id) {
      return readIndex().meetings.find((meeting) => meeting.id === id) ?? null
    },

    /**
     * 新建会议。
     * @returns {{ meeting: object, existing: boolean, matchedId?: string }}
     */
    create({ label = '', startedAt, audio } = {}) {
      if (typeof label !== 'string' || label.length > 60) {
        throw new MeetingStoreError('label 必须是不超过 60 字的字符串')
      }
      const index = readIndex()

      const sha = audio?.sha256
      if (sha) {
        const hit = index.meetings.find((meeting) => meeting.audio?.sha256 === sha)
        if (hit) return { meeting: hit, existing: true, matchedId: hit.id }
      }

      const when = startedAt ? new Date(startedAt) : now()
      const meeting = {
        id: idFactory(when),
        label,
        startedAt: when.toISOString(),
        endedAt: null,
        durationSec: null,
        audio: audio ?? null,
        status: emptyStatus(),
        stats: null,
        errors: { transcribe: null, minutes: null },
      }

      index.meetings.push(meeting)
      writeIndex(index)
      return { meeting, existing: false }
    },

    /** 局部更新；字段白名单 + 状态值校验，其余一律拒绝 */
    patch(id, changes = {}) {
      const index = readIndex()
      const meeting = index.meetings.find((item) => item.id === id)
      if (!meeting) throw new MeetingStoreError(`会议不存在: ${id}`)

      for (const [field, value] of Object.entries(changes)) {
        if (!PATCHABLE.has(field)) throw new MeetingStoreError(`字段不可修改: ${field}`)
        if (field === 'status') validateStatus(value)
        if (field === 'errors') {
          for (const key of Object.keys(value ?? {})) {
            if (!(key in meeting.errors)) throw new MeetingStoreError(`未知错误字段: ${key}`)
          }
        }
        meeting[field] = field === 'status' ? { ...meeting.status, ...value } : value
      }

      writeIndex(index)
      return meeting
    },
  }
}
