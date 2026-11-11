/**
 * 桌面版（Electron）安装/卸载/自检逻辑。
 *
 * 为什么需要它：`dsh plugin --profile desktop add …` 会被宿主拒绝
 * （`profile "desktop" is managed exclusively by the Electron application`），
 * 桌面版用户只能手改 profile 清单——不可重复、不可回滚。这里把那套动作脚本化。
 *
 * 设计约束（见 specs/20261111_desktop-adaptation/plan.md）：
 * - 只动 desktop profile 的三个东西：package.json 的依赖与 bundles 条目、node_modules 链接、
 *   交给 pnpm 自己写的 pnpm-lock.yaml（绝不手写 YAML）
 * - 所有外部副作用（fs / pnpm / 进程探测 / 时钟）都可注入，单测因此不 spawn、不碰真实 profile
 * - 任何一步失败都回滚到备份，不留「改了一半」的 profile
 *
 * @module dsh-note-taker/desktop
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PLUGIN_NAME = 'dsh-note-taker'
export const BACKUP_KEEP = 3
export const EXIT = { ok: 0, usage: 2, failed: 3 }

const MANAGED_FILES = ['package.json', 'pnpm-lock.yaml']

const noop = () => {}

/** 默认日志：CLI 里直接打行；测试注入收集器 */
function createLogger(sink) {
  const emit = (level) => (message, fields) => {
    const tail = fields && Object.keys(fields).length > 0
      ? ` ${Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(' ')}`
      : ''
    sink(`${level.toUpperCase()} ${message}${tail}`)
  }
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') }
}

export function resolveProfileDir({ env = process.env, home = homedir() } = {}) {
  const fromEnv = env.NOTE_TAKER_DESKTOP_PROFILE
  if (fromEnv && fromEnv.trim()) return resolvePath(fromEnv.trim())
  return join(home, '.dsh', 'profiles', 'desktop')
}

/** 链接依赖的写法：Windows 路径转正斜杠，避免反斜杠在 pnpm spec 里被当转义 */
export function linkSpecifier(repoDir) {
  return `link:${resolvePath(repoDir).replace(/\\/g, '/')}`
}

class DesktopError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function readJsonFile(fsImpl, file) {
  let text
  try {
    text = fsImpl.readFileSync(file, 'utf8')
  } catch (error) {
    throw new DesktopError('E_STATE', `读取失败: ${file}（${error.code ?? error.message}）`)
  }
  try {
    return { text, json: JSON.parse(text) }
  } catch (error) {
    throw new DesktopError('E_STATE', `${file} 解析失败：${error.message}`)
  }
}

function writeJsonFile(fsImpl, file, json) {
  fsImpl.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
}

/** 读 profile 清单并校验结构：JSON 坏或没有 dsh.profile 都直接拒绝，且不写任何文件 */
export function readProfile(fsImpl, profileDir) {
  const manifestPath = join(profileDir, 'package.json')
  if (!fsImpl.existsSync(manifestPath)) {
    throw new DesktopError('E_STATE', `桌面版 profile 不存在或没有 package.json：${profileDir}`)
  }
  const { json } = readJsonFile(fsImpl, manifestPath)
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new DesktopError('E_STATE', 'package.json 顶层必须是对象')
  }
  const profile = json.dsh?.profile
  if (!profile || typeof profile !== 'object') {
    throw new DesktopError('E_STATE', 'package.json 缺少 dsh.profile 段（不像 DSH profile）')
  }
  if (!Array.isArray(profile.bundles)) {
    throw new DesktopError('E_STATE', 'dsh.profile.bundles 必须是数组')
  }
  return { manifestPath, manifest: json }
}

function sameRealPath(fsImpl, left, right) {
  try {
    const a = fsImpl.realpathSync.native ? fsImpl.realpathSync.native(left) : fsImpl.realpathSync(left)
    const b = fsImpl.realpathSync.native ? fsImpl.realpathSync.native(right) : fsImpl.realpathSync(right)
    return a.toLowerCase() === b.toLowerCase()
  } catch {
    return false
  }
}

/** 链接现状：missing / ok（指向仓库）/ wrong（指向别处）/ real（同名真目录） */
export function linkState(fsImpl, profileDir, repoDir) {
  const linkPath = join(profileDir, 'node_modules', PLUGIN_NAME)
  let stat
  try {
    stat = fsImpl.lstatSync(linkPath)
  } catch {
    return { state: 'missing', linkPath }
  }
  if (!stat.isSymbolicLink()) return { state: 'real', linkPath }
  return { state: sameRealPath(fsImpl, linkPath, repoDir) ? 'ok' : 'wrong', linkPath }
}

function ensureDir(fsImpl, dir) {
  if (!fsImpl.existsSync(dir)) fsImpl.mkdirSync(dir, { recursive: true })
}

function linkPlugin(fsImpl, profileDir, repoDir) {
  const current = linkState(fsImpl, profileDir, repoDir)
  if (current.state === 'ok') return { changed: false, linkPath: current.linkPath }
  if (current.state === 'real') {
    throw new DesktopError('E_STATE', `node_modules/${PLUGIN_NAME} 是真实目录（不是链接），拒绝覆盖，请手工处理`)
  }
  ensureDir(fsImpl, join(profileDir, 'node_modules'))
  if (current.state === 'wrong') fsImpl.unlinkSync(current.linkPath)
  // Windows 用 junction：建 symlink 需要管理员或开发者模式，普通用户会卡住
  fsImpl.symlinkSync(repoDir, current.linkPath, process.platform === 'win32' ? 'junction' : 'dir')
  return { changed: true, linkPath: current.linkPath }
}

function removeLink(fsImpl, profileDir) {
  const linkPath = join(profileDir, 'node_modules', PLUGIN_NAME)
  let stat
  try {
    stat = fsImpl.lstatSync(linkPath)
  } catch {
    return false
  }
  if (!stat.isSymbolicLink()) {
    throw new DesktopError('E_STATE', `node_modules/${PLUGIN_NAME} 是真实目录，不删（怕误删源码），请手工处理`)
  }
  fsImpl.unlinkSync(linkPath)
  return true
}

/** 备份被改的文件，并只保留最近 BACKUP_KEEP 份同类备份 */
export function backupFiles(fsImpl, profileDir, { now = () => new Date() } = {}) {
  const stamp = now()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, '')
    .replace('T', '-')
  const created = []
  for (const name of MANAGED_FILES) {
    const file = join(profileDir, name)
    if (!fsImpl.existsSync(file)) continue
    const target = `${file}.bak-${stamp}`
    fsImpl.copyFileSync(file, target)
    created.push({ file, target })
  }
  for (const name of MANAGED_FILES) {
    const prefix = `${name}.bak-`
    const keep = fsImpl
      .readdirSync(profileDir)
      .filter((entry) => entry.startsWith(prefix))
      .sort()
    for (const stale of keep.slice(0, Math.max(0, keep.length - BACKUP_KEEP))) {
      fsImpl.unlinkSync(join(profileDir, stale))
    }
  }
  return { stamp, created }
}

function restoreBackups(fsImpl, created) {
  let restored = 0
  for (const item of [...created].reverse()) {
    try {
      fsImpl.copyFileSync(item.target, item.file)
      restored += 1
    } catch {
      // 回滚失败也要继续尝试其它文件，最后由调用方报错
    }
  }
  return restored
}

/**
 * 默认的 pnpm 调用：先试 PATH 里的 pnpm，再试同 profile 根下的 pnpm。
 * 只改 lockfile（--lockfile-only），不重排 node_modules——避免动到别的插件。
 */
export async function defaultRunPnpm({ profileDir, env = process.env } = {}) {
  const args = ['install', '--lockfile-only', '--ignore-scripts']
  const candidates = [{ cmd: 'pnpm', prefix: [] }]
  const bundledRoot = join(dirname(profileDir), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
  candidates.push({ cmd: process.execPath, prefix: [bundledRoot] })

  let last = { ok: false, code: null, stdout: '', stderr: 'pnpm 不可用' }
  for (const candidate of candidates) {
    const started = Date.now()
    const result = await new Promise((resolvePromise) => {
      let child
      try {
        child = spawn(candidate.cmd, [...candidate.prefix, ...args], {
          cwd: profileDir,
          env: { ...env, npm_config_yes: 'true' },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        resolvePromise({ ok: false, code: null, stdout: '', stderr: error.message, ms: 0 })
        return
      }
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => { stdout += String(chunk) })
      child.stderr.on('data', (chunk) => { stderr += String(chunk) })
      child.on('error', (error) => resolvePromise({ ok: false, code: null, stdout, stderr: error.message, ms: Date.now() - started }))
      child.on('close', (code) => resolvePromise({ ok: code === 0, code, stdout, stderr, ms: Date.now() - started }))
    })
    if (result.ok) return result
    last = result
    // 只有「找不到命令」才继续试下一个；跑起来但失败说明环境问题，立即报出
    if (result.code !== null) break
  }
  return last
}

/** 默认进程探测：Windows 上看有没有桌面版在跑（避免边跑边改 node_modules） */
export function defaultProcessProbe() {
  if (process.platform !== 'win32') return { running: false, matches: [] }
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn('tasklist', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/FO', 'CSV', '/NH'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      resolvePromise({ running: false, matches: [] })
      return
    }
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.on('error', () => resolvePromise({ running: false, matches: [] }))
    child.on('close', () => {
      const matches = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.toUpperCase().includes('DEEPSEEK HARNESS.EXE'))
      resolvePromise({ running: matches.length > 0, matches })
    })
  })
}

/** 云端 Key 的来源：page（设置页存的）/ env（环境变量）/ none。只报来源，绝不返回值 */
export function keySource({ fsImpl, env = process.env, dataRoot } = {}) {
  const root = dataRoot || env.NOTE_TAKER_DATA || join(homedir(), '.dsh', 'note-taker')
  try {
    const config = JSON.parse(fsImpl.readFileSync(join(root, 'config.json'), 'utf8'))
    if (typeof config?.cloud?.apiKey === 'string' && config.cloud.apiKey.trim()) return { source: 'page' }
  } catch {
    // 没有配置文件就是没配
  }
  if (env.DASHSCOPE_API_KEY && String(env.DASHSCOPE_API_KEY).trim()) return { source: 'env' }
  return { source: 'none' }
}

/** 宿主版本：只认能读到的（CLI `dsh --version`），读不到就不告警（宁可不说也不瞎说） */
export function detectHostVersion({ runVersion } = {}) {
  if (typeof runVersion === 'function') return runVersion()
  return null
}

export function describeCompat({ repoDir, fsImpl, hostVersion }) {
  let declared = []
  try {
    const pluginManifest = JSON.parse(fsImpl.readFileSync(join(repoDir, 'package.json'), 'utf8'))
    declared = Object.keys(pluginManifest?.dsh?.compatibility?.dshReleases ?? {})
  } catch {
    return { checked: false, declared, hostVersion, ok: true, reason: '读不到插件声明的兼容列表' }
  }
  if (!hostVersion) {
    return { checked: false, declared, hostVersion: null, ok: true, reason: '无法判定宿主版本，跳过兼容告警' }
  }
  const ok = declared.includes(hostVersion)
  return { checked: true, declared, hostVersion, ok, reason: ok ? null : `宿主版本 ${hostVersion} 不在已声明列表内` }
}

/** 五项自检（R-03）。每项都要能单独判定，任一不过就说明「装是装了，但可能激活不了」 */
export async function runChecks({ fsImpl, profileDir, repoDir, dataRoot, env, hostVersion, requireFrom = createRequire }) {
  const checks = []
  const manifestPath = join(profileDir, 'package.json')

  let manifest = null
  try {
    manifest = JSON.parse(fsImpl.readFileSync(manifestPath, 'utf8'))
  } catch {
    manifest = null
  }
  const profile = manifest?.dsh?.profile

  const spec = linkSpecifier(repoDir)
  checks.push({
    name: '依赖条目',
    ok: manifest?.dependencies?.[PLUGIN_NAME] === spec,
    detail: manifest?.dependencies?.[PLUGIN_NAME] ?? '缺失',
  })

  checks.push({
    name: 'bundles 条目',
    ok: Array.isArray(profile?.bundles) && profile.bundles.includes(PLUGIN_NAME),
    detail: Array.isArray(profile?.bundles) ? `共 ${profile.bundles.length} 项` : '无 bundles',
  })

  const link = linkState(fsImpl, profileDir, repoDir)
  checks.push({ name: 'node_modules 链接', ok: link.state === 'ok', detail: link.state })

  let lockText = ''
  try {
    lockText = fsImpl.readFileSync(join(profileDir, 'pnpm-lock.yaml'), 'utf8')
  } catch {
    lockText = ''
  }
  checks.push({
    name: 'lockfile 条目',
    ok: lockText.includes(`specifier: ${spec}`) || lockText.includes(`link:${resolvePath(repoDir).replace(/\\/g, '/')}`),
    detail: lockText ? '已读取' : '缺 lockfile',
  })

  let resolvable = false
  let exported = []
  try {
    const requireFromProfile = requireFrom(manifestPath)
    const entry = requireFromProfile.resolve(PLUGIN_NAME)
    const mod = await import(pathToFileURL(entry).href)
    exported = Object.keys(mod)
    resolvable = ['apply', 'inject', 'name'].every((key) => exported.includes(key))
  } catch (error) {
    resolvable = false
  }
  checks.push({
    name: '可解析出宿主导出',
    ok: resolvable,
    detail: resolvable ? exported.join(',') : '解析失败（插件可能未链接或宿主契约变了）',
  })

  const key = keySource({ fsImpl, env, dataRoot })
  const compat = describeCompat({ repoDir, fsImpl, hostVersion })

  return { checks, installed: checks.slice(0, 4).every((item) => item.ok), keySource: key.source, compat }
}

/**
 * 安装（R-01/R-02）。返回 { ok, code, alreadyInstalled, checks, ... }，不抛异常给 CLI 之外的调用方。
 */
export async function installDesktop({
  repoDir,
  profileDir,
  fsImpl,
  logger,
  runPnpm = defaultRunPnpm,
  processProbe = defaultProcessProbe,
  now = () => new Date(),
  force = false,
  env = process.env,
  dataRoot,
  hostVersion = null,
  requireFrom = createRequire,
} = {}) {
  const fsx = fsImpl
  const log = logger ?? createLogger((line) => console.log(line))
  const repo = resolvePath(repoDir)
  const profile = resolvePath(profileDir)
  const spec = linkSpecifier(repo)

  try {
    log.info('步骤=1/6 定位', { profileDir: profile, repoDir: repo })

    const probe = await processProbe()
    if (probe.running && !force) {
      log.error('检测到桌面版在运行，已中止（边跑边改 node_modules 有风险）', { 进程数: probe.matches.length })
      return { ok: false, code: EXIT.usage, reason: 'desktop_running' }
    }
    if (probe.running && force) log.warn('检测到桌面版在运行，按 --force 继续', { 进程数: probe.matches.length })

    log.info('步骤=2/6 读取并校验 profile 清单')
    const { manifestPath, manifest } = readProfile(fsx, profile)

    const alreadyInstalled =
      manifest.dependencies?.[PLUGIN_NAME] === spec &&
      manifest.dsh.profile.bundles.includes(PLUGIN_NAME) &&
      linkState(fsx, profile, repo).state === 'ok'

    if (alreadyInstalled) {
      log.info('已安装，跳过写入', { profileDir: profile })
      const result = await runChecks({ fsImpl: fsx, profileDir: profile, repoDir: repo, dataRoot, env, hostVersion, requireFrom })
      reportChecks(log, result)
      return { ok: result.checks.every((item) => item.ok), code: result.checks.every((item) => item.ok) ? EXIT.ok : EXIT.failed, alreadyInstalled: true, ...result }
    }

    log.info('步骤=4/6 备份将被修改的文件')
    const backup = backupFiles(fsx, profile, { now })
    log.info('备份完成', { 份数: backup.created.length, 时间戳: backup.stamp })

    try {
      log.info('步骤=5/6 写入依赖、bundles、链接与 lockfile')
      manifest.dependencies = { ...(manifest.dependencies ?? {}), [PLUGIN_NAME]: spec }
      if (!manifest.dsh.profile.bundles.includes(PLUGIN_NAME)) manifest.dsh.profile.bundles.push(PLUGIN_NAME)
      writeJsonFile(fsx, manifestPath, manifest)

      const linked = linkPlugin(fsx, profile, repo)
      log.info('链接就绪', { changed: linked.changed, path: linked.linkPath })

      const lockfileBefore = safeRead(fsx, join(profile, 'pnpm-lock.yaml'))
      const pnpm = await runPnpm({ profileDir: profile, env })
      log.debug('pnpm 调用完成', { 退出码: pnpm.code ?? 'spawn_failed', 耗时ms: pnpm.ms ?? 0 })
      if (!pnpm.ok) {
        throw new DesktopError('E_DEP', `pnpm install --lockfile-only 失败：${String(pnpm.stderr ?? '').slice(-500)}`)
      }
      const lockfileAfter = safeRead(fsx, join(profile, 'pnpm-lock.yaml'))
      log.info('lockfile 已更新', { 行数变化: countLines(lockfileAfter) - countLines(lockfileBefore) })

      log.info('步骤=6/6 自检')
      const result = await runChecks({ fsImpl: fsx, profileDir: profile, repoDir: repo, dataRoot, env, hostVersion, requireFrom })
      reportChecks(log, result)
      const allOk = result.checks.every((item) => item.ok)
      return { ok: allOk, code: allOk ? EXIT.ok : EXIT.failed, alreadyInstalled: false, ...result }
    } catch (error) {
      const restored = restoreBackups(fsx, backup.created)
      let linkRemoved = false
      try {
        linkRemoved = removeLink(fsx, profile)
      } catch {
        linkRemoved = false
      }
      log.error('安装失败，已回滚', { 错误: error.message, 恢复文件数: restored, 链接已清理: linkRemoved })
      return { ok: false, code: EXIT.failed, reason: error.code ?? 'E_STATE', message: error.message }
    }
  } catch (error) {
    log.error('安装中止', { 错误: error.message })
    return { ok: false, code: EXIT.usage, reason: error.code ?? 'E_STATE', message: error.message }
  }
}

/** 卸载（R-05）：摘接线 + 恢复 lockfile；数据目录一律不动 */
export async function uninstallDesktop({
  repoDir,
  profileDir,
  fsImpl,
  logger,
  runPnpm = defaultRunPnpm,
  processProbe = defaultProcessProbe,
  now = () => new Date(),
  force = false,
  env = process.env,
  dataRoot,
  hostVersion = null,
  requireFrom = createRequire,
} = {}) {
  const fsx = fsImpl
  const log = logger ?? createLogger((line) => console.log(line))
  const repo = resolvePath(repoDir)
  const profile = resolvePath(profileDir)

  try {
    log.info('步骤=1/4 定位', { profileDir: profile })

    const probe = await processProbe()
    if (probe.running && !force) {
      log.error('检测到桌面版在运行，已中止（请先退出应用）', { 进程数: probe.matches.length })
      return { ok: false, code: EXIT.usage, reason: 'desktop_running' }
    }

    log.info('步骤=2/4 读取并校验 profile 清单')
    const { manifestPath, manifest } = readProfile(fsx, profile)

    const deps = manifest?.dependencies ?? {}
    if (!(PLUGIN_NAME in deps) && !manifest.dsh.profile.bundles.includes(PLUGIN_NAME)) {
      log.info('未安装，无需卸载', { profileDir: profile })
      return { ok: true, code: EXIT.ok, alreadyAbsent: true }
    }

    // 记下其它插件的原样，卸载后逐字比对（共享面「没改坏」断言）
    const othersBefore = JSON.stringify(
      Object.fromEntries(Object.entries(deps).filter(([key]) => key !== PLUGIN_NAME)),
    )

    log.info('步骤=3/4 备份并摘除接线')
    const backup = backupFiles(fsx, profile, { now })
    log.info('备份完成', { 份数: backup.created.length, 时间戳: backup.stamp })

    try {
      const nextDeps = {}
      for (const [key, value] of Object.entries(deps)) {
        if (key !== PLUGIN_NAME) nextDeps[key] = value
      }
      manifest.dependencies = nextDeps
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((item) => item !== PLUGIN_NAME)
      writeJsonFile(fsx, manifestPath, manifest)

      const removedLink = removeLink(fsx, profile)
      log.info('链接已移除', { removed: removedLink })

      const pnpm = await runPnpm({ profileDir: profile, env })
      if (!pnpm.ok) throw new DesktopError('E_DEP', `pnpm install --lockfile-only 失败：${String(pnpm.stderr ?? '').slice(-500)}`)

      log.info('步骤=4/4 自检')
      const result = await runChecks({ fsImpl: fsx, profileDir: profile, repoDir: repo, dataRoot, env, hostVersion, requireFrom })
      const othersAfter = JSON.stringify(
        Object.fromEntries(Object.entries(JSON.parse(fsx.readFileSync(manifestPath, 'utf8')).dependencies ?? {}).filter(([key]) => key !== PLUGIN_NAME)),
      )
      const othersIntact = othersBefore === othersAfter
      log.info('其它插件断言', { 逐字未变: othersIntact })
      log.info('数据目录已保留', { 路径: dataRoot || join(homedir(), '.dsh', 'note-taker') })
      const gone = !result.checks[0].ok && !result.checks[1].ok
      return { ok: gone && othersIntact, code: gone && othersIntact ? EXIT.ok : EXIT.failed, othersIntact, ...result }
    } catch (error) {
      const restored = restoreBackups(fsx, backup.created)
      log.error('卸载失败，已回滚', { 错误: error.message, 恢复文件数: restored })
      return { ok: false, code: EXIT.failed, reason: error.code ?? 'E_STATE', message: error.message }
    }
  } catch (error) {
    log.error('卸载中止', { 错误: error.message })
    return { ok: false, code: EXIT.usage, reason: error.code ?? 'E_STATE', message: error.message }
  }
}

/** 只读自检（R-03/R-06/R-08/R-09）：不写任何文件 */
export async function verifyDesktop({
  repoDir,
  profileDir,
  fsImpl,
  logger,
  env = process.env,
  dataRoot,
  hostVersion = null,
  requireFrom = createRequire,
} = {}) {
  const log = logger ?? createLogger((line) => console.log(line))
  const repo = resolvePath(repoDir)
  const profile = resolvePath(profileDir)

  let result
  try {
    result = await runChecks({ fsImpl, profileDir: profile, repoDir: repo, dataRoot, env, hostVersion, requireFrom })
  } catch (error) {
    log.error('自检中止', { 错误: error.message })
    return { ok: false, code: EXIT.usage, message: error.message }
  }
  reportChecks(log, result)
  return { ok: result.checks.every((item) => item.ok), code: result.checks.every((item) => item.ok) ? EXIT.ok : EXIT.failed, ...result }
}

function safeRead(fsImpl, file) {
  try {
    return fsImpl.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function countLines(text) {
  return text ? text.split(/\r?\n/).length : 0
}

function reportChecks(log, result) {
  for (const check of result.checks) {
    const mark = check.ok ? '✓' : '✗'
    if (check.ok) log.info(`自检 ${mark} ${check.name}`, { 值: check.detail })
    else log.error(`自检 ${mark} ${check.name}`, { 值: check.detail })
  }
  log.info('配置来源', { Key来源: result.keySource })
  if (result.keySource === 'env') {
    log.warn('桌面版从图形界面启动，终端里的环境变量不会传进去，建议在设置页填写云端 Key')
  }
  if (result.compat?.checked && !result.compat.ok) {
    log.warn('兼容告警', {
      检测版本: result.compat.hostVersion,
      已声明: result.compat.declared.join('|') || '（空）',
      说明: '可在 package.json 的 dsh.compatibility.dshReleases 补声明（见 BL-07）',
    })
  } else if (result.compat?.checked) {
    log.info('兼容检查', { 宿主版本: result.compat.hostVersion, 说明: '已在声明列表内' })
  } else if (result.compat?.reason) {
    log.info('兼容检查', { 说明: result.compat.reason })
  }
}

export { DesktopError, createLogger, noop }