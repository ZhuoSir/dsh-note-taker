/**
 * Python sidecar 的进程边界。
 *
 * 约定（plan 模块与数据流）：stdout 只有一行结果 JSON，stderr 是过程日志。
 * 本模块负责：UTF-8 环境、超时、退出码、错误信封归一化、把 sidecar 日志转到宿主日志。
 *
 * @module dsh-note-taker/py
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const PY_ROOT = join(ROOT, 'py')

function pythonBin() {
  return process.env.DSH_NOTE_TAKER_PYTHON || 'python'
}

function sidecarEnv() {
  return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
}

/** 起一个长期存活的 sidecar（录音用：需要 stdin 控制停止） */
export function spawnSidecar(script, args = []) {
  return spawn(pythonBin(), [join(PY_ROOT, script), ...args], {
    cwd: ROOT,
    env: sidecarEnv(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/** 解析 sidecar 的 stdout：取最后一行非空行当 JSON */
export function parseSidecarStdout(stdout) {
  const lines = String(stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const last = lines.at(-1)
  if (!last) return null
  try {
    return JSON.parse(last)
  } catch {
    return null
  }
}

/**
 * 跑一个一次性 sidecar。
 * @returns {Promise<{ ok:boolean, payload:object|null, exitCode:number|null, stderr:string }>}
 *   成功时 payload 是 sidecar 的 JSON；失败时 payload 尽量是 sidecar 自己吐的错误信封，
 *   拿不到就由调用方按 E_DEP 处理。
 */
export function runSidecar(script, args = [], { stdin, timeoutMs = 0, onStderr } = {}) {
  return new Promise((resolve) => {
    const child = spawnSidecar(script, args)
    let stdout = ''
    let stderr = ''
    let timer = null
    let timedOut = false

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      stderr += text
      onStderr?.(text)
    })

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, timeoutMs)
    }

    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      resolve({ ok: false, payload: { code: 'E_DEP', message: `无法启动 Python sidecar: ${error.message}` }, exitCode: null, stderr })
    })

    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      const payload = parseSidecarStdout(stdout)
      if (timedOut) {
        resolve({ ok: false, payload: { code: 'E_STATE', message: `sidecar ${script} 超时（${timeoutMs}ms）` }, exitCode: code, stderr })
        return
      }
      resolve({ ok: code === 0 && payload?.ok !== false, payload, exitCode: code, stderr })
    })

    if (stdin !== undefined) {
      child.stdin.write(stdin)
      child.stdin.end()
    }
  })
}
