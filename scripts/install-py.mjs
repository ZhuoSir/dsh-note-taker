#!/usr/bin/env node
/**
 * Python 依赖的离线安装（不走 pip）。
 *
 * 为什么不用 pip：本机工作区带 ACL 限制，pip 的原子替换会失败（lessons L-02）。
 * 做法：从 PyPI 下 wheel → 用 python 的 zipfile 解到 pylibs/ → 靠 PYTHONPATH 注入。
 * 幂等：版本未变则跳过；换版本会覆盖同名文件。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LIBS = join(ROOT, 'pylibs')
const CACHE = join(LIBS, '.wheels')
const MARKER = join(LIBS, '.installed.json')

/** sounddevice：wheel 自带 PortAudio 二进制，Windows 走 WASAPI，无需编译 */
const TARGETS = [{ name: 'sounddevice', prefer: /-py3-none-win_amd64\.whl$/ }]

async function pickWheel(name, prefer) {
  const response = await fetch(`https://pypi.org/pypi/${name}/json`, { headers: { 'user-agent': 'dsh-note-taker' } })
  if (!response.ok) throw new Error(`PyPI 查询失败: ${name} HTTP ${response.status}`)
  const meta = await response.json()
  const wheel = (meta.urls ?? []).find((item) => prefer.test(item.filename))
  if (!wheel) {
    throw new Error(`${name} 没有匹配的 wheel；可选: ${(meta.urls ?? []).map((item) => item.filename).join(', ')}`)
  }
  return { version: meta.info.version, filename: wheel.filename, url: wheel.url }
}

function extract(wheelPath, dest) {
  const script = 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])'
  const result = spawnSync('python', ['-c', script, wheelPath, dest], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`解包失败: ${wheelPath}`)
}

function preview(result, target) {
  const code = [
    'import sys, json',
    `sys.path.insert(0, ${JSON.stringify(LIBS)})`,
    `import ${target.name} as mod`,
    'print(json.dumps({"module": mod.__name__, "version": getattr(mod, "__version__", "?"), "file": mod.__file__}, ensure_ascii=False))',
  ].join('; ')
  const run = spawnSync('python', ['-c', code], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } })
  if (run.status !== 0) return `导入失败: ${(run.stderr || '').trim().split('\n').at(-1)}`
  return (run.stdout || '').trim()
}

async function main() {
  mkdirSync(CACHE, { recursive: true })
  const installed = existsSync(MARKER) ? JSON.parse(readFileSync(MARKER, 'utf8')) : {}

  for (const target of TARGETS) {
    const wheel = await pickWheel(target.name, target.prefer)
    if (installed[target.name]?.version === wheel.version) {
      console.log(`${target.name} ${wheel.version} 已安装，跳过`)
      continue
    }

    const wheelPath = join(CACHE, wheel.filename)
    if (!existsSync(wheelPath)) {
      console.log(`下载 ${wheel.filename}`)
      const response = await fetch(wheel.url, { headers: { 'user-agent': 'dsh-note-taker' } })
      if (!response.ok) throw new Error(`下载失败: ${wheel.url} HTTP ${response.status}`)
      writeFileSync(wheelPath, Buffer.from(await response.arrayBuffer()))
    }

    console.log(`解包 ${wheel.filename} → pylibs/`)
    extract(wheelPath, LIBS)
    installed[target.name] = { version: wheel.version, filename: wheel.filename, installedAt: new Date().toISOString() }
    writeFileSync(MARKER, `${JSON.stringify(installed, null, 2)}\n`, 'utf8')
  }

  for (const target of TARGETS) {
    console.log(`${target.name}: ${preview(installed, target)}`)
  }
  console.log(`\n完成。Python 侧用 PYTHONPATH=${LIBS} 引用（sidecar 已自动加）。`)
}

main().catch((error) => {
  console.error(`离线安装失败: ${error.message}`)
  process.exit(1)
})
