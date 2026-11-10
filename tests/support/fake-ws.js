/**
 * 假 WebSocket：按脚本扮演百炼服务端，供单测使用（不碰真实网络）。
 *
 * 用法：构造时通过 `script` 决定收到什么就回什么。
 */

import { EventEmitter } from 'node:events'

export class FakeWebSocket extends EventEmitter {
  static instances = []

  constructor(url, options = {}) {
    super()
    this.url = url
    this.options = options
    this.sent = []
    this.closed = false
    this.textSent = []
    this.binarySent = []
    FakeWebSocket.instances.push(this)

    setImmediate(() => {
      if (this.closed) return
      if (FakeWebSocket.failHandshake) {
        const error = new Error('Unexpected server response: 401')
        error.statusCode = 401
        this.emit('error', error)
        return
      }
      this.emit('open')
    })
  }

  send(data) {
    this.sent.push(data)
    if (Buffer.isBuffer(data)) {
      this.binarySent.push(data)
    } else {
      this.textSent.push(data)
    }
    FakeWebSocket.onSend?.(this, data)
  }

  close() {
    if (this.closed) return
    this.closed = true
    setImmediate(() => this.emit('close'))
  }

  /** 向客户端推一条服务端事件 */
  push(event) {
    this.emit('message', Buffer.from(JSON.stringify(event)), false)
  }

  /** 推一条原始文本（用于畸形 JSON 场景） */
  pushRaw(text) {
    this.emit('message', Buffer.from(text), false)
  }

  static reset() {
    FakeWebSocket.instances = []
    FakeWebSocket.onSend = null
    FakeWebSocket.failHandshake = false
  }
}

export function startedEvent(taskId) {
  return { header: { task_id: taskId, event: 'task-started', attributes: {} }, payload: {} }
}

export function sentenceEvent({ text, begin, end, id = 1, sentenceEnd = true, heartbeat = false }) {
  return {
    header: { task_id: 't', event: 'result-generated', attributes: {} },
    payload: {
      output: {
        sentence: {
          sentence_id: id,
          begin_time: begin,
          end_time: end,
          text,
          heartbeat,
          sentence_begin: false,
          sentence_end: sentenceEnd,
        },
      },
    },
  }
}

export function finishedEvent(usage = { duration: 2, total_tokens: 89 }) {
  return { header: { task_id: 't', event: 'task-finished', attributes: {} }, payload: { usage } }
}

export function failedEvent(message = '模型不可用', code = 'InvalidParameter') {
  return { header: { task_id: 't', event: 'task-failed', attributes: {} }, payload: { error_code: code, message } }
}
