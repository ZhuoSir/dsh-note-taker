/**
 * 桌面版安装器：安装/幂等/回滚/卸载/运行检测。
 *
 * 全部在临时目录里造假 profile，pnpm 用假 runner（不 spawn、不联网），
 * 这样单测不依赖真实 ~/.dsh 与真实 pnpm（L-17）。
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, lstatSync, readdirSync, rmSync, symlinkSync, realpathSync, copyFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { EXIT, installDesktop, linkSpecifier, uninstallDesktop, readProfile, keySource, verifyDesktop } from '../lib/desktop.js'

const REPO = process.cwd()

const FAKE_OTHERS = {
  deps: {
    dsbot: '^0.2.2',
    'dsh-context': '0.77.0',
    'dsh-free-search': '0.9.19',
    'dsh-image-generation': '0.1.3',
    'dsh-obsidian': '0.2.6',
    'dsh-sessions-manager': '3.7.10',
    'dsh-vision-router': '3.0.5',
    dshmarket: '1.66.17',
  },
  bundles: [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    'dshmarket',
    'dsh-vision-router',
    'dsh-context',
    'dsh-image-generation',
    'dsh-obsidian',
    'dsh-sessions-manager',
    'dsh-free-search',
  ],
}

function makeProfile() {
  const root = mkdtempSync(join(tmpdir(), 'note-taker-desktop-'))
  const profileDir = join(root, 'profiles', 'desktop')
  mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
  const manifest = {
    name: 'dsh-profile-desktop',
    private: true,
    dsh: { profile: { bundles: [...FAKE_OTHERS.bundles], patchReload: 'live' } },
    dependencies: { ...FAKE_OTHERS.deps },
  }
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(profileDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n")
  return { root, profileDir }
}

function loggerSpy() {
  const lines = []
  const push = (level) => (message, fields) => {
    const tail = fields && Object.keys(fields).length > 0
      ? ` ${Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(' ')}`
      : ''
    lines.push(`${level} ${message}${tail}`)
  }
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') }
}

/** 假 pnpm：只往 lockfile 里写那条 link 依赖（真 pnpm 也是只改 lockfile） */
function fakePnpm(profileDir) {
  const calls = []
  const run = async ({ profileDir: dir }) => {
    calls.push(dir)
    const lockPath = join(dir, 'pnpm-lock.yaml')
    const text = readFileSync(lockPath, 'utf8')
    if (!text.includes('dsh-note-taker:')) {
      writeFileSync(lockPath, `${text}\n      dsh-note-taker:\n        specifier: ${linkSpecifier(REPO)}\n        version: ${linkSpecifier(REPO)}\n`)
    }
    return { ok: true, code: 0, stdout: '', stderr: '', ms: 1 }
  }
  return { run, calls }
}

const notRunning = async () => ({ running: false, matches: [] })
const running = async () => ({ running: true, matches: ['DeepSeek Harness.exe'] })

function hash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function baseOptions(profileDir, extra = {}) {
  return {
    repoDir: REPO,
    profileDir,
    fsImpl: fsShim(),
    logger: loggerSpy(),
    processProbe: notRunning,
    now: () => new Date('2026-11-11T02:00:00Z'),
    env: {},
    ...extra,
  }
}

test('安装：写入依赖与 bundles、建链接、lockfile 有 specifier，自检五项全绿', async () => {
  const { profileDir } = makeProfile()
  const pnpm = fakePnpm(profileDir)
  const log = loggerSpy()
  const result = await installDesktop(baseOptions(profileDir, { logger: log, runPnpm: pnpm.run }))

  assert.equal(result.ok, true, JSON.stringify(result.checks))
  assert.equal(result.code, EXIT.ok)

  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies['dsh-note-taker'], linkSpecifier(REPO))
  assert.equal(manifest.dsh.profile.bundles.at(-1), 'dsh-note-taker')
  assert.equal(lstatSync(join(profileDir, 'node_modules', 'dsh-note-taker')).isSymbolicLink(), true)
  assert.ok(readFileSync(join(profileDir, 'pnpm-lock.yaml'), 'utf8').includes(linkSpecifier(REPO)))

  const text = log.lines.join('\n')
  for (const expected of ['步骤=1/6', '步骤=2/6', '备份', '步骤=5/6', '链接就绪', 'lockfile 已更新', '步骤=6/6']) {
    assert.ok(text.includes(expected), `日志缺少「${expected}」：\n${text}`)
  }
})

test('幂等：第二次安装不写文件，两份清单哈希不变', async () => {
  const { profileDir } = makeProfile()
  const pnpm = fakePnpm(profileDir)
  await installDesktop(baseOptions(profileDir, { runPnpm: pnpm.run }))

  const manifestPath = join(profileDir, 'package.json')
  const lockPath = join(profileDir, 'pnpm-lock.yaml')
  const before = [hash(manifestPath), hash(lockPath)]

  const again = await installDesktop(baseOptions(profileDir, { runPnpm: pnpm.run }))
  assert.equal(again.ok, true)
  assert.equal(again.alreadyInstalled, true)
  assert.deepEqual([hash(manifestPath), hash(lockPath)], before, '第二次安装不应改动任何文件')
})

test('非法 JSON：报错退出且文件内容未变（不留改一半）', async () => {
  const { profileDir } = makeProfile()
  const manifestPath = join(profileDir, 'package.json')
  writeFileSync(manifestPath, '{ 这不是 JSON')
  const before = hash(manifestPath)
  const log = loggerSpy()

  const result = await installDesktop(baseOptions(profileDir, { logger: log, runPnpm: fakePnpm(profileDir).run }))
  assert.equal(result.ok, false)
  assert.equal(result.code, EXIT.usage)
  assert.ok(result.message.includes('解析失败'), result.message)
  assert.equal(hash(manifestPath), before)
  assert.equal(existsSync(join(profileDir, 'node_modules', 'dsh-note-taker')), false)
})

test('pnpm 失败：回滚清单并清掉链接', async () => {
  const { profileDir } = makeProfile()
  const manifestPath = join(profileDir, 'package.json')
  const lockPath = join(profileDir, 'pnpm-lock.yaml')
  const before = [hash(manifestPath), hash(lockPath)]
  const failing = async () => ({ ok: false, code: 1, stdout: '', stderr: 'boom', ms: 5 })

  const result = await installDesktop(baseOptions(profileDir, { runPnpm: failing }))
  assert.equal(result.ok, false)
  assert.equal(result.code, EXIT.failed)
  assert.deepEqual([hash(manifestPath), hash(lockPath)], before, '失败后必须回到安装前')
  assert.equal(existsSync(join(profileDir, 'node_modules', 'dsh-note-taker')), false, '失败后链接要清掉')
})

test('卸载：其它 8 个插件逐字未变、lockfile 摘掉依赖、数据目录不动', async () => {
  const { profileDir } = makeProfile()
  const pnpm = fakePnpm(profileDir)
  await installDesktop(baseOptions(profileDir, { runPnpm: pnpm.run }))

  const manifestPath = join(profileDir, 'package.json')
  const installed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const othersBefore = Object.fromEntries(
    Object.entries(installed.dependencies).filter(([key]) => key !== 'dsh-note-taker'),
  )
  const bundlesBefore = installed.dsh.profile.bundles.filter((entry) => entry !== 'dsh-note-taker')

  // 卸载时 pnpm 会把 link 行去掉：假 runner 模拟这一步
  const unlinking = async ({ profileDir: dir }) => {
    const lockPath = join(dir, 'pnpm-lock.yaml')
    const text = readFileSync(lockPath, 'utf8')
    writeFileSync(lockPath, text.split(/\r?\n/).filter((line) => !line.includes('dsh-note-taker')).join('\n'))
    return { ok: true, code: 0, stdout: '', stderr: '', ms: 1 }
  }

  const dataRoot = join(tmpdir(), 'note-taker-data-should-stay-gone')
  const log = loggerSpy()
  const result = await uninstallDesktop(baseOptions(profileDir, { runPnpm: unlinking, logger: log, dataRoot }))

  assert.equal(result.ok, true, JSON.stringify(result.checks))
  const after = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.deepEqual(after.dependencies, othersBefore, '其它依赖必须逐字不变')
  assert.deepEqual(after.dsh.profile.bundles, bundlesBefore, '其它 bundles 必须逐字不变')
  assert.equal('dsh-note-taker' in after.dependencies, false)
  assert.equal(existsSync(join(profileDir, 'node_modules', 'dsh-note-taker')), false)
  assert.ok(!readFileSync(join(profileDir, 'pnpm-lock.yaml'), 'utf8').includes('dsh-note-taker'))
  assert.equal(existsSync(dataRoot), false, '卸载不得创建/删除数据目录')

  const text = log.lines.join('\n')
  assert.ok(text.includes('其它插件断言'), text)
  assert.ok(text.includes('逐字未变=true'), text)
  assert.ok(text.includes('数据目录已保留'), text)
})

test('桌面版在运行：默认拒绝（退出码 2），--force 才继续', async () => {
  const { profileDir } = makeProfile()
  const pnpm = fakePnpm(profileDir)
  const blocked = await installDesktop(baseOptions(profileDir, { processProbe: running, runPnpm: pnpm.run }))
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, EXIT.usage)
  assert.equal(blocked.reason, 'desktop_running')
  assert.equal('dsh-note-taker' in JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dependencies, false)

  const forced = await installDesktop(baseOptions(profileDir, { processProbe: running, force: true, runPnpm: pnpm.run }))
  assert.equal(forced.ok, true)
})

test('readProfile：缺 dsh.profile 直接拒绝', () => {
  const { profileDir } = makeProfile()
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'x' }))
  assert.throws(() => readProfile({ ...fsShim() }, profileDir), /缺少 dsh.profile/)
})

test('keySource：设置页 > 环境变量 > 都没有', () => {
  const fsImpl = fsShim()
  const dataRoot = mkdtempSync(join(tmpdir(), 'note-taker-key-'))

  assert.equal(keySource({ fsImpl, env: {}, dataRoot }).source, 'none')
  assert.equal(keySource({ fsImpl, env: { DASHSCOPE_API_KEY: 'sk-x' }, dataRoot }).source, 'env')

  mkdirSync(dataRoot, { recursive: true })
  writeFileSync(join(dataRoot, 'config.json'), JSON.stringify({ cloud: { apiKey: 'sk-page' } }))
  assert.equal(keySource({ fsImpl, env: { DASHSCOPE_API_KEY: 'sk-x' }, dataRoot }).source, 'page')
  rmSync(dataRoot, { recursive: true, force: true })
})

test('自检：链接被改名后该项 ✗，退出码 3', async () => {
  const { profileDir } = makeProfile()
  await installDesktop(baseOptions(profileDir, { runPnpm: fakePnpm(profileDir).run }))

  const linkPath = join(profileDir, 'node_modules', 'dsh-note-taker')
  rmSync(linkPath, { force: true })

  const log = loggerSpy()
  const result = await verifyDesktop({ ...baseOptions(profileDir, { logger: log }), fsImpl: fsShim() })
  assert.equal(result.ok, false)
  assert.equal(result.code, EXIT.failed)
  const broken = result.checks.find((item) => item.name === 'node_modules 链接')
  assert.equal(broken.ok, false)
  assert.ok(log.lines.some((line) => line.startsWith('error 自检 ✗ node_modules 链接')), log.lines.join('\n'))
})

test('自检：Key 只在环境变量里 → 提示去设置页填，且输出不含 Key 值', async () => {
  const { profileDir } = makeProfile()
  await installDesktop(baseOptions(profileDir, { runPnpm: fakePnpm(profileDir).run }))

  const secret = 'sk-should-never-be-printed-123456'
  const log = loggerSpy()
  const result = await verifyDesktop({
    ...baseOptions(profileDir, { logger: log }),
    fsImpl: fsShim(),
    env: { DASHSCOPE_API_KEY: secret },
    dataRoot: join(tmpdir(), 'note-taker-no-such-data-root'),
  })
  assert.equal(result.keySource, 'env')
  const text = log.lines.join('\n')
  assert.ok(text.includes('Key来源=env'), text)
  assert.ok(text.includes('建议在设置页填写'), text)
  assert.equal(text.includes(secret), false, '日志里绝不能出现 Key 值')
})

test('自检：宿主版本不在声明列表 → WARN 但不阻断', async () => {
  const { profileDir } = makeProfile()
  await installDesktop(baseOptions(profileDir, { runPnpm: fakePnpm(profileDir).run }))

  const log = loggerSpy()
  const result = await verifyDesktop({
    ...baseOptions(profileDir, { logger: log }),
    fsImpl: fsShim(),
    hostVersion: '9.9.9-not-declared',
  })
  assert.equal(result.compat.checked, true)
  assert.equal(result.compat.ok, false)
  assert.equal(result.ok, true, '兼容告警不能阻断（R-09）')
  assert.equal(result.code, EXIT.ok)
  const text = log.lines.join('\n')
  assert.ok(text.includes('warn 兼容告警'), text)
  assert.ok(text.includes('检测版本=9.9.9-not-declared'), text)
})

test('CLI：无参退出 2；未装时 verify 退出 3；装好后 verify 退出 0（--json 可机读）', async () => {
  const cli = join(REPO, 'scripts', 'desktop.mjs')

  assert.throws(
    () => execFileSync(process.execPath, [cli], { encoding: 'utf8', stdio: 'pipe' }),
    (error) => error.status === EXIT.usage && /用法:/.test(error.stdout ?? ''),
  )

  const { profileDir } = makeProfile()
  const notInstalled = runCli(cli, ['verify', '--profile-dir', profileDir, '--json'])
  assert.equal(notInstalled.status, EXIT.failed, '未安装时自检必须非 0')
  assert.equal(notInstalled.json.installed, false)
  assert.equal(notInstalled.json.checks.length, 5)

  await installDesktop(baseOptions(profileDir, { runPnpm: fakePnpm(profileDir).run }))
  const installed = runCli(cli, ['verify', '--profile-dir', profileDir, '--json'])
  assert.equal(installed.status, EXIT.ok, JSON.stringify(installed.json.checks))
  assert.equal(installed.json.installed, true)
})

/** 跑 CLI 并允许非 0 退出码（execFileSync 会在非 0 时抛错） */
function runCli(cli, args) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: 'pipe' })
    return { status: 0, json: JSON.parse(stdout) }
  } catch (error) {
    return { status: error.status, json: JSON.parse(String(error.stdout ?? '{}')) }
  }
}

/** readProfile 需要的是 fs 接口；直接复用 node:fs 即可（这里显式形参避免依赖全局） */
function fsShim() {
  return {
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync,
    lstatSync,
    realpathSync,
    symlinkSync,
    copyFileSync,
    readdirSync,
    unlinkSync,
  }
}