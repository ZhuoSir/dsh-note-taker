/**
 * 设置区「会记」页：配置 + 历史纪要（R-01~R-04）。
 *
 * 纪律：
 * - 配置读写走 ./api.js，不直接 fetch
 * - 校验错误按字段就地显示，不用 alert 打断
 * - Key 只显示掩码；用户不改就原样回传掩码，后端会识别为「未修改」
 * - 这个页面**不发起转写/生成纪要**——按 R-09，那些动作在会话里做
 */

import { createElement, useCallback, useEffect, useMemo, useState } from 'react'

import { createApi } from './api.js'
import { errorText, formatDateTime, formatDuration, paginateTranscript, toListRows } from './logic.js'
import { theme } from './theme.js'

const MODELS = ['tiny', 'base', 'small', 'medium']

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px', width: '100%', maxWidth: 860, minWidth: 0, boxSizing: 'border-box', color: theme.text, fontFamily: theme.font },
  card: { border: `1px solid ${theme.border}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, background: theme.bg, color: theme.text },
  // minmax(0, 1fr) 是关键：默认 1fr 会被长内容（比如整串 Key）撑破，导致整页横向溢出
  row: { display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center', fontSize: 13, minWidth: 0 },
  label: { color: theme.textSecondary, fontSize: 12 },
  input: { padding: '6px 10px', borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  select: { padding: '6px 10px', borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, fontSize: 13, fontFamily: 'inherit' },
  hint: { fontSize: 11, color: theme.textMuted, gridColumn: '2 / 3', minWidth: 0, wordBreak: 'break-word', lineHeight: 1.5 },
  fieldError: { fontSize: 11, color: theme.danger, gridColumn: '2 / 3', minWidth: 0, wordBreak: 'break-word' },
  bar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  btn: { padding: '6px 14px', borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' },
  btnPrimary: { padding: '6px 14px', borderRadius: 8, border: `1px solid ${theme.accentBorder}`, background: theme.accentBg, color: theme.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' },
  muted: { fontSize: 12, color: theme.textMuted },
  error: { fontSize: 12, color: theme.danger },
  ok: { fontSize: 12, color: theme.success },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, color: theme.text },
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${theme.border}`, fontWeight: 600, color: theme.textSecondary, fontSize: 12 },
  td: { padding: '6px 8px', borderBottom: `1px solid ${theme.borderSoft}`, verticalAlign: 'top' },
  pre: { margin: 0, maxHeight: 360, overflow: 'auto', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: theme.mono, background: theme.bgHover, padding: 10, borderRadius: 8, color: theme.text },
  radio: { display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 16, fontSize: 13, cursor: 'pointer' },
  tabs: { display: 'flex', gap: 4, borderBottom: `1px solid ${theme.border}`, paddingBottom: 0 },
  tab: (active) => ({
    padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
    border: 'none', borderBottom: `2px solid ${active ? theme.accent : 'transparent'}`,
    background: 'transparent', color: active ? theme.text : theme.textSecondary,
    marginBottom: -1,
  }),
}

function Field({ label, hint, error, children }) {
  return createElement('div', { style: { display: 'contents' } },
    createElement('label', { style: styles.label }, label),
    children,
    error ? createElement('div', { style: styles.fieldError }, error) : null,
    hint && !error ? createElement('div', { style: styles.hint }, hint) : null,
  )
}

export function SettingsPage() {
  const api = useMemo(() => createApi({}), [])
  const [tab, setTab] = useState('config')
  const [form, setForm] = useState(null)
  const [sources, setSources] = useState({})
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [saving, setSaving] = useState(false)

  const [meetings, setMeetings] = useState([])
  const [openedId, setOpenedId] = useState(null)
  const [minutesText, setMinutesText] = useState(null)
  const [showAll, setShowAll] = useState(false)

  const loadConfig = useCallback(async () => {
    const result = await api.getConfig()
    if (result.ok === false) { setError(errorText(result.code, result.detail)); return }
    setForm(result.config)
    setSources(result.sources ?? {})
    setError(null)
  }, [api])

  const loadMinutes = useCallback(async () => {
    const result = await api.list({ limit: 50 })
    if (result.ok === false) { setError(errorText(result.code, result.detail)); return }
    setMeetings(result.meetings ?? [])
  }, [api])

  useEffect(() => { loadConfig(); loadMinutes() }, [loadConfig, loadMinutes])

  const update = useCallback((section, key, value) => {
    setForm((prev) => ({ ...prev, [section]: { ...(prev?.[section] ?? {}), [key]: value } }))
    setFieldErrors((prev) => {
      const next = { ...prev }
      delete next[`${section}.${key}`]
      return next
    })
  }, [])

  const save = useCallback(async () => {
    if (!form) return
    setSaving(true)
    setError(null)
    setNotice(null)
    setFieldErrors({})

    const patch = {
      asr: {
        engine: form.asr.engine,
        localModel: form.asr.localModel,
        chunkSeconds: Number(form.asr.chunkSeconds),
      },
      cloud: {
        // 掩码原样回传：后端识别为「未修改」，不会覆盖真 Key
        apiKey: form.cloud.apiKey || null,
        endpoint: form.cloud.endpoint,
        model: form.cloud.model,
      },
    }
    if (form.dataRoot) patch.dataRoot = form.dataRoot

    const result = await api.saveConfig(patch)
    setSaving(false)

    if (result.ok === false) {
      const map = {}
      for (const item of result.detail?.errors ?? []) map[item.field] = item.message
      if (result.detail?.field && !map[result.detail.field]) map[result.detail.field] = result.message
      setFieldErrors(map)
      setError(result.message ?? errorText(result.code, result.detail))
      return
    }

    setNotice(`已保存：${(result.saved ?? []).join('、') || '无变化'}${
      (result.ignored ?? []).length > 0 ? `（忽略：${result.ignored.join('、')}）` : ''
    }`)
    await loadConfig()

    // 保存后复验实际生效值（R-02 的「热生效」要求可观测）
    const health = await api.health()
    if (health.ok !== false) {
      setNotice((prev) => `${prev} ｜ 当前生效：云端${health.cloud?.configured ? '已配置' : '未配置'}／${health.cloud?.model ?? '—'}`)
    }
  }, [api, form, loadConfig])

  const openMinutes = useCallback(async (id) => {
    if (openedId === id) { setOpenedId(null); setMinutesText(null); return }
    const result = await api.detail({ id })
    if (result.ok === false) { setError(errorText(result.code, result.detail)); return }
    setOpenedId(id)
    setMinutesText(result.minutes ?? '')
    setShowAll(false)
  }, [api, openedId])

  const minutesRows = useMemo(
    () => toListRows(meetings, { limit: 50 }).filter((row) => row.minutes.status === 'done'),
    [meetings],
  )

  if (!form) {
    return createElement('div', { style: styles.wrap },
      createElement('div', { style: styles.muted }, error ?? '加载配置中…'))
  }

  return createElement('div', { style: styles.wrap },
    createElement('div', { style: styles.bar },
      createElement('strong', { style: { fontSize: 15 } }, '会记'),
      createElement('span', { style: styles.muted }, '配置与历史纪要；录音与生成纪要在会话输入框旁的「会记」里'),
    ),

    createElement('div', { style: styles.tabs, role: 'tablist' },
      createElement('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'config', style: styles.tab(tab === 'config'), onClick: () => setTab('config') }, '配置'),
      createElement('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'minutes', style: styles.tab(tab === 'minutes'), onClick: () => setTab('minutes') }, `历史纪要（${minutesRows.length}）`),
    ),

    error ? createElement('div', { style: styles.error }, error) : null,
    notice ? createElement('div', { style: styles.ok }, notice) : null,

    tab === 'config' ? createElement('div', { style: styles.card },
      createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, '语音识别'),
      createElement('div', { style: styles.row },
        createElement(Field, { label: '默认引擎' },
          createElement('div', null,
            ['local', 'cloud'].map((engine) => createElement('label', { key: engine, style: styles.radio },
              createElement('input', {
                type: 'radio', name: 'engine', value: engine,
                checked: form.asr.engine === engine,
                onChange: () => update('asr', 'engine', engine),
              }),
              engine === 'local' ? '本地（faster-whisper）' : '云端（阿里云百炼）',
            )),
          ),
        ),
        createElement(Field, { label: '本地模型档位', hint: '仅本地引擎使用；未下载的档位首次运行会下载' },
          createElement('select', {
            style: styles.select, value: form.asr.localModel,
            onChange: (event) => update('asr', 'localModel', event.target.value),
          }, MODELS.map((model) => createElement('option', { key: model, value: model }, model))),
        ),
        createElement(Field, { label: '分片秒数', hint: '长音频按此长度切片，云端建议 300', error: fieldErrors['asr.chunkSeconds'] },
          createElement('input', {
            type: 'number', min: 10, max: 3600, style: styles.input, value: form.asr.chunkSeconds,
            onChange: (event) => update('asr', 'chunkSeconds', event.target.value),
          }),
        ),
      ),

      createElement('div', { style: { fontSize: 13, fontWeight: 600, marginTop: 4 } }, '云端服务'),
      createElement('div', { style: styles.row },
        createElement(Field, {
          label: 'API Key',
          hint: form.cloud.apiKey ? `当前：${form.cloud.apiKey}（留空或保持掩码表示不修改）` : '取自环境变量 DASHSCOPE_API_KEY 或在此填写',
          error: fieldErrors['cloud.apiKey'],
        },
          createElement('input', {
            type: 'text', style: { ...styles.input, fontFamily: theme.mono }, value: form.cloud.apiKey ?? '',
            placeholder: 'sk-…', spellCheck: false, autoComplete: 'off',
            onChange: (event) => update('cloud', 'apiKey', event.target.value),
          }),
        ),
        createElement(Field, { label: '接口地址', hint: '换成业务空间专属域名时只改 host', error: fieldErrors['cloud.endpoint'] },
          createElement('input', {
            type: 'text', style: styles.input, value: form.cloud.endpoint ?? '',
            onChange: (event) => update('cloud', 'endpoint', event.target.value),
          }),
        ),
        createElement(Field, { label: '云端模型名', hint: '支持分人的是 qwen-audio-3.1-asr-flash', error: fieldErrors['cloud.model'] },
          createElement('input', {
            type: 'text', style: styles.input, value: form.cloud.model ?? '',
            onChange: (event) => update('cloud', 'model', event.target.value),
          }),
        ),
      ),

      createElement('div', { style: { fontSize: 13, fontWeight: 600, marginTop: 4 } }, '数据目录'),
      createElement('div', { style: styles.row },
        createElement(Field, {
          label: '目录',
          hint: '录音、转写、纪要都存这里；修改后需重启宿主生效',
          error: fieldErrors.dataRoot,
        },
          createElement('input', {
            type: 'text', style: styles.input, value: form.dataRoot ?? '',
            placeholder: '默认 ~/.dsh/note-taker',
            onChange: (event) => setForm((prev) => ({ ...prev, dataRoot: event.target.value })),
          }),
        ),
      ),

      createElement('div', { style: styles.bar },
        createElement('button', {
          type: 'button',
          style: saving ? { ...styles.btnPrimary, opacity: 0.6 } : styles.btnPrimary,
          disabled: saving,
          onClick: save,
        }, saving ? '保存中…' : '保存配置'),
        createElement('span', { style: styles.muted }, `生效来源：引擎 ${sources.engine ?? '—'}／Key ${sources.apiKey ?? '—'}`),
      ),
    ) : null,

    tab === 'minutes' ? createElement('div', { style: styles.card },
      createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, `历史纪要（${minutesRows.length}）`),
      minutesRows.length === 0
        ? createElement('div', { style: styles.muted }, '还没有纪要。录音并在会话里生成后，这里会出现。')
        : createElement('table', { style: styles.table },
            createElement('thead', null, createElement('tr', null,
              createElement('th', { style: styles.th }, '时间'),
              createElement('th', { style: styles.th }, '标签'),
              createElement('th', { style: styles.th }, '时长'),
              createElement('th', { style: styles.th }, '引擎'),
              createElement('th', { style: styles.th }, '段数'),
            )),
            createElement('tbody', null, minutesRows.map((row) => createElement('tr', {
              key: row.id,
              onClick: () => openMinutes(row.id),
              style: { cursor: 'pointer', background: row.id === openedId ? theme.accentBg : 'transparent' },
            },
              createElement('td', { style: styles.td }, row.startedText),
              createElement('td', { style: styles.td }, row.label),
              createElement('td', { style: styles.td }, row.durationText),
              createElement('td', { style: styles.td }, row.engineText),
              createElement('td', { style: styles.td }, row.segments ?? '—'),
            ))),
          ),
    ) : null,

    tab === 'minutes' && openedId ? createElement('div', { style: styles.card },
      createElement('div', { style: styles.bar },
        createElement('strong', null, '纪要正文'),
        createElement('button', { type: 'button', style: styles.btn, onClick: () => openMinutes(openedId) }, '收起'),
      ),
      minutesText
        ? createElement('div', null,
            createElement('pre', { style: styles.pre }, paginateTranscript(minutesText, { showAll }).lines.join('\n')),
            paginateTranscript(minutesText, { showAll }).truncated
              ? createElement('button', { type: 'button', style: styles.btn, onClick: () => setShowAll(true) },
                  `展开剩余 ${paginateTranscript(minutesText, { showAll }).remaining} 行`)
              : null,
          )
        : createElement('div', { style: styles.muted }, '这场会议还没有纪要文件'),
    ) : null,
  )
}

export default SettingsPage
