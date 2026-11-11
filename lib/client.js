window.__ModuleLoader__.load({
	id: "dsh-note-taker",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  MeetingPanel: () => MeetingPanel,
  QuickPanel: () => QuickPanel,
  RecordIcon: () => RecordIcon,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/SettingsPage.jsx
var import_react = require("react");

// src/client/logic.js
var STATUS_TONE = Object.freeze({
  pending: "muted",
  running: "active",
  done: "ok",
  failed: "error"
});
var STATUS_TEXT = Object.freeze({
  pending: "\u5F85\u5904\u7406",
  running: "\u8FDB\u884C\u4E2D",
  done: "\u5B8C\u6210",
  failed: "\u5931\u8D25"
});
var ENGINE_TEXT = Object.freeze({
  local: "\u672C\u5730",
  cloud: "\u4E91\u7AEF"
});
function statusMeta(meeting, field) {
  const status = meeting?.status?.[field] ?? "pending";
  const tone = STATUS_TONE[status] ?? "muted";
  const text = STATUS_TEXT[status] ?? status;
  const reason = status === "failed" ? meeting?.errors?.[field] ?? "\u672A\u77E5\u539F\u56E0" : null;
  return { status, text, tone, reason };
}
function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const pad = (value) => String(value).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const secs = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}
function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "\u2014";
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function toListRows(meetings, { limit = 20 } = {}) {
  const rows = [...meetings ?? []].sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? ""))).slice(0, limit).map((meeting) => ({
    id: meeting.id,
    // 未命名不再显示占位符，直接显示开始时间，方便认领
    label: typeof meeting.label === "string" && meeting.label.trim() !== "" ? meeting.label.trim() : formatDateTime(meeting.startedAt),
    rawLabel: typeof meeting.label === "string" ? meeting.label : "",
    startedAt: meeting.startedAt,
    startedText: formatDateTime(meeting.startedAt),
    durationText: formatDuration(meeting.durationSec),
    engineText: ENGINE_TEXT[meeting.engine ?? "local"] ?? meeting.engine ?? "\u672C\u5730",
    record: statusMeta(meeting, "record"),
    transcribe: statusMeta(meeting, "transcribe"),
    // hasMinutes 来自服务端按文件判断（agent 直接写文件时状态位可能是旧的）
    minutes: meeting?.hasMinutes === true && meeting?.status?.minutes !== "done" ? { ...statusMeta(meeting, "minutes"), status: "done", text: "\u5B8C\u6210", tone: "ok", reason: null } : statusMeta(meeting, "minutes"),
    hasMinutes: meeting?.hasMinutes === true,
    segments: meeting?.stats?.segments ?? null,
    chars: meeting?.stats?.chars ?? null
  }));
  return rows;
}
function errorText(code, detail = {}) {
  const serverMessage = typeof detail?.message === "string" && detail.message.trim() !== "" ? detail.message.trim() : null;
  const where = typeof detail?.endpoint === "string" ? `\uFF08${detail.endpoint}\uFF09` : "";
  switch (code) {
    case "E_DEP":
      return detail?.env ? `\u7F3A\u5C11\u914D\u7F6E\uFF1A${detail.env}\uFF0C\u8BBE\u7F6E\u540E\u91CD\u8BD5` : serverMessage ?? "\u7F3A\u5C11\u5FC5\u8981\u7684\u4F9D\u8D56\u6216\u914D\u7F6E\uFF0C\u8BF7\u68C0\u67E5\u63D2\u4EF6\u8BBE\u7F6E";
    case "E_LLM":
      return serverMessage ? `${serverMessage}${where}` : `\u6A21\u578B\u6216\u7F51\u7EDC\u8C03\u7528\u5931\u8D25${where}\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5`;
    case "E_MODEL":
      return "\u672C\u5730\u6A21\u578B\u4E0D\u53EF\u7528\uFF0C\u8BF7\u5148\u4E0B\u8F7D\u6A21\u578B\u6216\u6539\u7528\u4E91\u7AEF\u5F15\u64CE";
    case "E_AUDIO":
      return "\u97F3\u9891\u4E0D\u53EF\u8BFB\u6216\u5DF2\u635F\u574F";
    case "E_DEVICE":
      return "\u5F55\u97F3\u8BBE\u5907\u4E0D\u53EF\u7528\uFF08\u88AB\u5360\u7528\u6216\u672A\u63D2\u5165\uFF09";
    case "E_STATE":
      return detail?.message ?? "\u5F53\u524D\u72B6\u6001\u4E0B\u4E0D\u5141\u8BB8\u8FD9\u4E2A\u64CD\u4F5C";
    default:
      return code ? `\u64CD\u4F5C\u5931\u8D25\uFF08${code}\uFF09` : "\u64CD\u4F5C\u5931\u8D25";
  }
}
function needsCloudConsent(engine, acknowledged = false) {
  return engine === "cloud" && acknowledged !== true;
}
var CLOUD_CONSENT_TEXT = "\u4E91\u7AEF\u8F6C\u5199\u4F1A\u628A\u97F3\u9891\u4E0A\u4F20\u81F3\u963F\u91CC\u4E91\u767E\u70BC\uFF08DashScope\uFF09\u8FDB\u884C\u8BC6\u522B\uFF0C\u662F\u5426\u7EE7\u7EED\uFF1F";
var STREAM_CONSENT_TEXT = "\u6D41\u5F0F\u8BC6\u522B\u4F1A\u5728\u5F55\u97F3\u671F\u95F4\u6301\u7EED\u4E0A\u4F20\u97F3\u9891\u5230\u963F\u91CC\u4E91\u767E\u70BC\uFF08DashScope\uFF09\u5B9E\u65F6\u8BC6\u522B\uFF0C\u662F\u5426\u7EE7\u7EED\uFF1F";
function needsStreamConsent({ streamEnabled, acknowledged } = {}) {
  return streamEnabled === true && acknowledged !== true;
}
function triggerView({ recording = false, seconds = 0, open = false } = {}) {
  const timing = recording ? formatDuration(seconds) : "";
  return {
    tone: recording ? "success" : "muted",
    label: "\u4F1A\u8BB0",
    timing,
    expanded: open === true,
    title: recording ? `\u4F1A\u8BB0 \xB7 \u5F55\u5236\u4E2D ${timing}` : "\u4F1A\u8BB0",
    ariaLabel: recording ? `\u4F1A\u8BB0\uFF0C\u5F55\u5236\u4E2D ${timing}\uFF0C\u6253\u5F00\u9762\u677F` : "\u4F1A\u8BB0\uFF0C\u6253\u5F00\u9762\u677F"
  };
}
var LIVE_STATE_TEXT = Object.freeze({
  connecting: "\u8FDE\u63A5\u4E2D\u2026",
  streaming: "\u5B9E\u65F6\u8BC6\u522B\u4E2D",
  finalizing: "\u6536\u5C3E\u4E2D\u2026",
  done: "\u8BC6\u522B\u5B8C\u6210",
  degraded: "\u5DF2\u964D\u7EA7"
});
var LIVE_WAIT_SECONDS = 5;
var LIVE_POLL_MS = 500;
function shouldPollLive({ phase, streaming, hidden } = {}) {
  return phase === "recording" && streaming === true && hidden !== true;
}
function liveView(snapshot2, { silenceSec = 0 } = {}) {
  const state2 = snapshot2?.state;
  if (!state2 || state2 === "idle") return null;
  const finals = (snapshot2.finals ?? []).map((item, index) => ({
    key: `${index}-${item.startSec ?? 0}`,
    timeText: formatDuration(item.startSec ?? 0),
    text: String(item.text ?? "")
  }));
  const partial = String(snapshot2.partial ?? "");
  const degraded = state2 === "degraded";
  return {
    state: state2,
    // 色调只表达「正常/异常/完成」，具体颜色由组件从 theme 令牌取
    tone: degraded ? "error" : state2 === "done" ? "ok" : "active",
    statusText: LIVE_STATE_TEXT[state2] ?? state2,
    finals,
    partial,
    chars: Number(snapshot2.chars ?? 0),
    elapsedText: formatDuration(snapshot2.elapsedSec ?? 0),
    // 降级后不再更新字幕；只在「还在连/在识别」且长时间没字时才提示等待
    waiting: !degraded && state2 !== "done" && partial === "" && Number(silenceSec) >= LIVE_WAIT_SECONDS,
    frozen: degraded || state2 === "done",
    degradedReason: snapshot2.degradedReason ?? null,
    blank: finals.length === 0 && partial === ""
  };
}
function paginateTranscript(text, { chunk = 100, showAll = false } = {}) {
  const lines = String(text ?? "").split("\n");
  if (showAll || lines.length <= chunk) return { lines, truncated: false, remaining: 0 };
  return { lines: lines.slice(0, chunk), truncated: true, remaining: lines.length - chunk };
}
function capabilitiesFrom(health) {
  return {
    cloudReady: health?.cloud?.configured === true,
    cloudHost: health?.cloud?.host ?? null,
    cloudModel: health?.cloud?.model ?? null,
    recordingReady: health?.recording?.available === true,
    localModels: health?.local?.models ?? [],
    // 流式：配置开启 + 密钥就绪才算可用（R-09），否则卡片不弹确认也不发流式请求
    streamEnabled: health?.stream?.enabled === true,
    streamAvailable: health?.stream?.available === true,
    streamModel: health?.stream?.model ?? null,
    streamReady: health?.stream?.enabled === true && health?.stream?.available === true
  };
}

// src/client/api.js
var DEFAULT_TIMEOUT_MS = 15e3;
var BASE = "/note-taker";
function buildUrl(path, query) {
  const pairs = [];
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === void 0 || value === null || value === "") continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return pairs.length > 0 ? `${path}?${pairs.join("&")}` : path;
}
function toErrorEnvelope(code, message, detail = {}) {
  return { ok: false, code, message, detail };
}
function createApi({ baseUrl = "", fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, confirmCloud } = {}) {
  const inflight2 = /* @__PURE__ */ new Set();
  async function request(path, { method = "GET", query, body } = {}) {
    if (typeof fetchImpl !== "function") return toErrorEnvelope("E_DEP", "\u5F53\u524D\u73AF\u5883\u6CA1\u6709 fetch");
    const controller = new AbortController();
    inflight2.add(controller);
    const timer2 = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${buildUrl(`${BASE}${path}`, query)}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : void 0,
        body: body ? JSON.stringify(body) : void 0,
        signal: controller.signal
      });
      const text = await response.text().catch(() => "");
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      if (!response.ok) {
        const code = parsed?.code ?? (response.status === 401 || response.status === 403 ? "E_DEP" : "E_LLM");
        return toErrorEnvelope(
          code,
          parsed?.message ?? `\u63A5\u53E3\u8FD4\u56DE HTTP ${response.status}`,
          { ...parsed?.detail ?? {}, httpStatus: response.status, endpoint: path }
        );
      }
      if (parsed === null) return toErrorEnvelope("E_LLM", "\u63A5\u53E3\u8FD4\u56DE\u7684\u4E0D\u662F JSON", { endpoint: path });
      return parsed;
    } catch (error) {
      const aborted = error?.name === "AbortError";
      return toErrorEnvelope("E_LLM", aborted ? `\u8BF7\u6C42\u8D85\u65F6\uFF08${timeoutMs}ms\uFF09` : `\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25\uFF1A${error?.message ?? error}`);
    } finally {
      clearTimeout(timer2);
      inflight2.delete(controller);
    }
  }
  async function longAction(path, body, { engine } = {}) {
    if (engine && needsCloudConsent(engine)) {
      let granted = false;
      try {
        granted = confirmCloud ? await confirmCloud(CLOUD_CONSENT_TEXT) === true : false;
      } catch {
        granted = false;
      }
      if (!granted) return { ok: false, code: "E_STATE", message: "\u5DF2\u53D6\u6D88\uFF08\u672A\u786E\u8BA4\u4E91\u7AEF\u4E0A\u4F20\uFF09", detail: { cancelled: true } };
    }
    return request(path, { method: "POST", body });
  }
  return {
    list: ({ limit, sessionId } = {}) => request("/list", { query: { limit, sessionId } }),
    detail: ({ id, sessionId } = {}) => request("/detail", { query: { id, sessionId } }),
    health: () => request("/health"),
    getConfig: () => request("/config"),
    saveConfig: (patch) => request("/config", { method: "POST", body: patch }),
    transcribe: ({ id, engine, sessionId } = {}) => longAction("/transcribe", { id, engine, sessionId }, { engine }),
    minutes: ({ id, force, sessionId } = {}) => request("/minutes", { method: "POST", body: { id, force, sessionId } }),
    record: ({ action, label, stream, sessionId } = {}) => request("/record", { method: "POST", body: { action, label, stream, sessionId } }),
    // 全局录音状态：不带 sessionId —— 录音属于宿主，不属于某个会话（CR-02 / R-11）
    recordState: () => request("/record"),
    live: ({ id } = {}) => request("/live", { query: { id } }),
    rename: ({ id, label } = {}) => request("/label", { method: "POST", body: { id, label } }),
    importAudio: ({ path, label } = {}) => request("/import", { method: "POST", body: { path, label } }),
    cancelAll() {
      for (const controller of inflight2) controller.abort();
      inflight2.clear();
    }
  };
}

// src/client/theme.js
var theme = {
  text: "var(--dsw-alias-label-primary, #1f2023)",
  textSecondary: "var(--dsw-alias-label-secondary, #55575c)",
  textMuted: "var(--dsw-alias-label-tertiary, #8a8d93)",
  bg: "var(--dsw-alias-bg-base, #ffffff)",
  bgHover: "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))",
  border: "var(--dsw-alias-border-default, rgba(127,127,127,0.32))",
  borderSoft: "var(--dsw-alias-border-l3, rgba(127,127,127,0.18))",
  accent: "var(--dsw-alias-state-business-primary, #3b82f6)",
  accentBg: "var(--dsw-alias-state-info-bg, rgba(59,130,246,0.12))",
  accentBorder: "var(--dsw-alias-state-info-border, rgba(59,130,246,0.45))",
  danger: "#e5484d",
  dangerBg: "rgba(229,72,77,0.12)",
  dangerBorder: "var(--dsw-alias-state-danger-border, rgba(229,72,77,0.45))",
  success: "#2f9e63",
  successBg: "rgba(47,158,99,0.12)",
  successBorder: "rgba(47,158,99,0.45)",
  font: "var(--dsw-font-family, inherit)",
  mono: "ui-monospace, SFMono-Regular, Consolas, monospace"
};

// src/client/SettingsPage.jsx
var MODELS = ["tiny", "base", "small", "medium"];
var styles = {
  wrap: { display: "flex", flexDirection: "column", gap: 14, padding: "4px 2px", width: "100%", maxWidth: 860, minWidth: 0, boxSizing: "border-box", color: theme.text, fontFamily: theme.font },
  card: { border: `1px solid ${theme.border}`, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 12, background: theme.bg, color: theme.text },
  // minmax(0, 1fr) 是关键：默认 1fr 会被长内容（比如整串 Key）撑破，导致整页横向溢出
  row: { display: "grid", gridTemplateColumns: "130px minmax(0, 1fr)", gap: "8px 12px", alignItems: "center", fontSize: 13, minWidth: 0 },
  label: { color: theme.textSecondary, fontSize: 12 },
  input: { padding: "6px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, background: "transparent", color: theme.text, fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box" },
  select: { padding: "6px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, background: "transparent", color: theme.text, fontSize: 13, fontFamily: "inherit" },
  hint: { fontSize: 11, color: theme.textMuted, gridColumn: "2 / 3", minWidth: 0, wordBreak: "break-word", lineHeight: 1.5 },
  fieldError: { fontSize: 11, color: theme.danger, gridColumn: "2 / 3", minWidth: 0, wordBreak: "break-word" },
  bar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  btn: { padding: "6px 14px", borderRadius: 8, border: `1px solid ${theme.border}`, background: "transparent", color: theme.text, cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
  btnPrimary: { padding: "6px 14px", borderRadius: 8, border: `1px solid ${theme.accentBorder}`, background: theme.accentBg, color: theme.text, cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
  muted: { fontSize: 12, color: theme.textMuted },
  error: { fontSize: 12, color: theme.danger },
  ok: { fontSize: 12, color: theme.success },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, color: theme.text },
  th: { textAlign: "left", padding: "6px 8px", borderBottom: `1px solid ${theme.border}`, fontWeight: 600, color: theme.textSecondary, fontSize: 12 },
  td: { padding: "6px 8px", borderBottom: `1px solid ${theme.borderSoft}`, verticalAlign: "top" },
  pre: { margin: 0, maxHeight: 360, overflow: "auto", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: theme.mono, background: theme.bgHover, padding: 10, borderRadius: 8, color: theme.text },
  radio: { display: "inline-flex", alignItems: "center", gap: 6, marginRight: 16, fontSize: 13, cursor: "pointer" },
  tabs: { display: "flex", gap: 4, borderBottom: `1px solid ${theme.border}`, paddingBottom: 0 },
  tab: (active) => ({
    padding: "7px 14px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    border: "none",
    borderBottom: `2px solid ${active ? theme.accent : "transparent"}`,
    background: "transparent",
    color: active ? theme.text : theme.textSecondary,
    marginBottom: -1
  })
};
function Field({ label, hint, error, children }) {
  return (0, import_react.createElement)(
    "div",
    { style: { display: "contents" } },
    (0, import_react.createElement)("label", { style: styles.label }, label),
    children,
    error ? (0, import_react.createElement)("div", { style: styles.fieldError }, error) : null,
    hint && !error ? (0, import_react.createElement)("div", { style: styles.hint }, hint) : null
  );
}
function SettingsPage() {
  const api2 = (0, import_react.useMemo)(() => createApi({}), []);
  const [tab, setTab] = (0, import_react.useState)("config");
  const [form, setForm] = (0, import_react.useState)(null);
  const [sources, setSources] = (0, import_react.useState)({});
  const [fieldErrors, setFieldErrors] = (0, import_react.useState)({});
  const [error, setError] = (0, import_react.useState)(null);
  const [notice, setNotice] = (0, import_react.useState)(null);
  const [saving, setSaving] = (0, import_react.useState)(false);
  const [meetings, setMeetings] = (0, import_react.useState)([]);
  const [openedId, setOpenedId] = (0, import_react.useState)(null);
  const [minutesText, setMinutesText] = (0, import_react.useState)(null);
  const [showAll, setShowAll] = (0, import_react.useState)(false);
  const loadConfig = (0, import_react.useCallback)(async () => {
    const result = await api2.getConfig();
    if (result.ok === false) {
      setError(errorText(result.code, result.detail));
      return;
    }
    setForm(result.config);
    setSources(result.sources ?? {});
    setError(null);
  }, [api2]);
  const loadMinutes = (0, import_react.useCallback)(async () => {
    const result = await api2.list({ limit: 50 });
    if (result.ok === false) {
      setError(errorText(result.code, result.detail));
      return;
    }
    setMeetings(result.meetings ?? []);
  }, [api2]);
  (0, import_react.useEffect)(() => {
    loadConfig();
    loadMinutes();
  }, [loadConfig, loadMinutes]);
  const update = (0, import_react.useCallback)((section, key, value) => {
    setForm((prev) => ({ ...prev, [section]: { ...prev?.[section] ?? {}, [key]: value } }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[`${section}.${key}`];
      return next;
    });
  }, []);
  const save = (0, import_react.useCallback)(async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});
    const patch = {
      asr: {
        engine: form.asr.engine,
        localModel: form.asr.localModel,
        chunkSeconds: Number(form.asr.chunkSeconds)
      },
      cloud: {
        // 掩码原样回传：后端识别为「未修改」，不会覆盖真 Key
        apiKey: form.cloud.apiKey || null,
        endpoint: form.cloud.endpoint,
        model: form.cloud.model
      }
    };
    if (form.asr?.stream) {
      patch.asr.stream = { enabled: form.asr.stream.enabled === true, model: String(form.asr.stream.model ?? "") };
    }
    if (form.dataRoot) patch.dataRoot = form.dataRoot;
    const result = await api2.saveConfig(patch);
    setSaving(false);
    if (result.ok === false) {
      const map = {};
      for (const item of result.detail?.errors ?? []) map[item.field] = item.message;
      if (result.detail?.field && !map[result.detail.field]) map[result.detail.field] = result.message;
      setFieldErrors(map);
      setError(result.message ?? errorText(result.code, result.detail));
      return;
    }
    setNotice(`\u5DF2\u4FDD\u5B58\uFF1A${(result.saved ?? []).join("\u3001") || "\u65E0\u53D8\u5316"}${(result.ignored ?? []).length > 0 ? `\uFF08\u5FFD\u7565\uFF1A${result.ignored.join("\u3001")}\uFF09` : ""}`);
    await loadConfig();
    const health = await api2.health();
    if (health.ok !== false) {
      setNotice((prev) => `${prev} \uFF5C \u5F53\u524D\u751F\u6548\uFF1A\u4E91\u7AEF${health.cloud?.configured ? "\u5DF2\u914D\u7F6E" : "\u672A\u914D\u7F6E"}\uFF0F${health.cloud?.model ?? "\u2014"}`);
    }
  }, [api2, form, loadConfig]);
  const openMinutes = (0, import_react.useCallback)(async (id) => {
    if (openedId === id) {
      setOpenedId(null);
      setMinutesText(null);
      return;
    }
    const result = await api2.detail({ id });
    if (result.ok === false) {
      setError(errorText(result.code, result.detail));
      return;
    }
    setOpenedId(id);
    setMinutesText(result.minutes ?? "");
    setShowAll(false);
  }, [api2, openedId]);
  const minutesRows = (0, import_react.useMemo)(
    () => toListRows(meetings, { limit: 50 }).filter((row) => row.hasMinutes || row.minutes.status === "done"),
    [meetings]
  );
  if (!form) {
    return (0, import_react.createElement)(
      "div",
      { style: styles.wrap },
      (0, import_react.createElement)("div", { style: styles.muted }, error ?? "\u52A0\u8F7D\u914D\u7F6E\u4E2D\u2026")
    );
  }
  return (0, import_react.createElement)(
    "div",
    { style: styles.wrap },
    (0, import_react.createElement)(
      "div",
      { style: styles.bar },
      (0, import_react.createElement)("strong", { style: { fontSize: 15 } }, "\u4F1A\u8BB0"),
      (0, import_react.createElement)("span", { style: styles.muted }, "\u914D\u7F6E\u4E0E\u5386\u53F2\u7EAA\u8981\uFF1B\u5F55\u97F3\u4E0E\u751F\u6210\u7EAA\u8981\u5728\u4F1A\u8BDD\u8F93\u5165\u6846\u65C1\u7684\u300C\u4F1A\u8BB0\u300D\u91CC")
    ),
    (0, import_react.createElement)(
      "div",
      { style: styles.tabs, role: "tablist" },
      (0, import_react.createElement)("button", { type: "button", role: "tab", "aria-selected": tab === "config", style: styles.tab(tab === "config"), onClick: () => setTab("config") }, "\u914D\u7F6E"),
      (0, import_react.createElement)("button", { type: "button", role: "tab", "aria-selected": tab === "minutes", style: styles.tab(tab === "minutes"), onClick: () => setTab("minutes") }, `\u5386\u53F2\u7EAA\u8981\uFF08${minutesRows.length}\uFF09`)
    ),
    error ? (0, import_react.createElement)("div", { style: styles.error }, error) : null,
    notice ? (0, import_react.createElement)("div", { style: styles.ok }, notice) : null,
    tab === "config" ? (0, import_react.createElement)(
      "div",
      { style: styles.card },
      (0, import_react.createElement)("div", { style: { fontSize: 13, fontWeight: 600 } }, "\u8BED\u97F3\u8BC6\u522B"),
      (0, import_react.createElement)(
        "div",
        { style: styles.row },
        (0, import_react.createElement)(
          Field,
          { label: "\u9ED8\u8BA4\u5F15\u64CE" },
          (0, import_react.createElement)(
            "div",
            null,
            ["local", "cloud"].map((engine) => (0, import_react.createElement)(
              "label",
              { key: engine, style: styles.radio },
              (0, import_react.createElement)("input", {
                type: "radio",
                name: "engine",
                value: engine,
                checked: form.asr.engine === engine,
                onChange: () => update("asr", "engine", engine)
              }),
              engine === "local" ? "\u672C\u5730\uFF08faster-whisper\uFF09" : "\u4E91\u7AEF\uFF08\u963F\u91CC\u4E91\u767E\u70BC\uFF09"
            ))
          )
        ),
        (0, import_react.createElement)(
          Field,
          { label: "\u672C\u5730\u6A21\u578B\u6863\u4F4D", hint: "\u4EC5\u672C\u5730\u5F15\u64CE\u4F7F\u7528\uFF1B\u672A\u4E0B\u8F7D\u7684\u6863\u4F4D\u9996\u6B21\u8FD0\u884C\u4F1A\u4E0B\u8F7D" },
          (0, import_react.createElement)("select", {
            style: styles.select,
            value: form.asr.localModel,
            onChange: (event) => update("asr", "localModel", event.target.value)
          }, MODELS.map((model) => (0, import_react.createElement)("option", { key: model, value: model }, model)))
        ),
        (0, import_react.createElement)(
          Field,
          { label: "\u5206\u7247\u79D2\u6570", hint: "\u957F\u97F3\u9891\u6309\u6B64\u957F\u5EA6\u5207\u7247\uFF0C\u4E91\u7AEF\u5EFA\u8BAE 300", error: fieldErrors["asr.chunkSeconds"] },
          (0, import_react.createElement)("input", {
            type: "number",
            min: 10,
            max: 3600,
            style: styles.input,
            value: form.asr.chunkSeconds,
            onChange: (event) => update("asr", "chunkSeconds", event.target.value)
          })
        )
      ),
      (0, import_react.createElement)("div", { style: { fontSize: 13, fontWeight: 600, marginTop: 4 } }, "\u6D41\u5F0F\u8BC6\u522B"),
      (0, import_react.createElement)(
        "div",
        { style: styles.row },
        (0, import_react.createElement)(
          Field,
          { label: "\u5F55\u97F3\u671F\u95F4\u5B9E\u65F6\u51FA\u5B57", hint: "\u5F00\u542F\u540E\u5F55\u97F3\u65F6\u6301\u7EED\u4E0A\u4F20\u97F3\u9891\uFF0C\u505C\u5F55\u5373\u51FA\u5B57\uFF1B\u9700\u4E91\u7AEF Key" },
          (0, import_react.createElement)(
            "label",
            { style: styles.radio },
            (0, import_react.createElement)("input", {
              type: "checkbox",
              checked: form.asr?.stream?.enabled === true,
              onChange: (event) => update("asr", "stream", { ...form.asr?.stream ?? {}, enabled: event.target.checked })
            }),
            form.asr?.stream?.enabled === true ? "\u5DF2\u5F00\u542F\uFF08\u5F55\u97F3\u671F\u95F4\u6301\u7EED\u4E0A\u4F20\uFF09" : "\u672A\u5F00\u542F\uFF08\u505C\u5F55\u540E\u518D\u8BC6\u522B\uFF09"
          )
        ),
        (0, import_react.createElement)(
          Field,
          { label: "\u6D41\u5F0F\u6A21\u578B", hint: "\u7F3A\u7701 qwen3-asr-flash-realtime\uFF1B\u6362\u6A21\u578B\u8981\u81EA\u5DF1\u4E5F\u652F\u6301\u6D41\u5F0F", error: fieldErrors["asr.stream.model"] },
          (0, import_react.createElement)("input", {
            type: "text",
            style: styles.input,
            value: form.asr?.stream?.model ?? "",
            spellCheck: false,
            onChange: (event) => update("asr", "stream", { ...form.asr?.stream ?? {}, model: event.target.value })
          })
        )
      ),
      (0, import_react.createElement)("div", { style: { fontSize: 13, fontWeight: 600, marginTop: 4 } }, "\u4E91\u7AEF\u670D\u52A1"),
      (0, import_react.createElement)(
        "div",
        { style: styles.row },
        (0, import_react.createElement)(
          Field,
          {
            label: "API Key",
            hint: form.cloud.apiKey ? `\u5F53\u524D\uFF1A${form.cloud.apiKey}\uFF08\u7559\u7A7A\u6216\u4FDD\u6301\u63A9\u7801\u8868\u793A\u4E0D\u4FEE\u6539\uFF09` : "\u53D6\u81EA\u73AF\u5883\u53D8\u91CF DASHSCOPE_API_KEY \u6216\u5728\u6B64\u586B\u5199",
            error: fieldErrors["cloud.apiKey"]
          },
          (0, import_react.createElement)("input", {
            type: "text",
            style: { ...styles.input, fontFamily: theme.mono },
            value: form.cloud.apiKey ?? "",
            placeholder: "sk-\u2026",
            spellCheck: false,
            autoComplete: "off",
            onChange: (event) => update("cloud", "apiKey", event.target.value)
          })
        ),
        (0, import_react.createElement)(
          Field,
          { label: "\u63A5\u53E3\u5730\u5740", hint: "\u6362\u6210\u4E1A\u52A1\u7A7A\u95F4\u4E13\u5C5E\u57DF\u540D\u65F6\u53EA\u6539 host", error: fieldErrors["cloud.endpoint"] },
          (0, import_react.createElement)("input", {
            type: "text",
            style: styles.input,
            value: form.cloud.endpoint ?? "",
            onChange: (event) => update("cloud", "endpoint", event.target.value)
          })
        ),
        (0, import_react.createElement)(
          Field,
          { label: "\u4E91\u7AEF\u6A21\u578B\u540D", hint: "\u652F\u6301\u5206\u4EBA\u7684\u662F qwen-audio-3.1-asr-flash", error: fieldErrors["cloud.model"] },
          (0, import_react.createElement)("input", {
            type: "text",
            style: styles.input,
            value: form.cloud.model ?? "",
            onChange: (event) => update("cloud", "model", event.target.value)
          })
        )
      ),
      (0, import_react.createElement)("div", { style: { fontSize: 13, fontWeight: 600, marginTop: 4 } }, "\u6570\u636E\u76EE\u5F55"),
      (0, import_react.createElement)(
        "div",
        { style: styles.row },
        (0, import_react.createElement)(
          Field,
          {
            label: "\u76EE\u5F55",
            hint: "\u5F55\u97F3\u3001\u8F6C\u5199\u3001\u7EAA\u8981\u90FD\u5B58\u8FD9\u91CC\uFF1B\u4FEE\u6539\u540E\u9700\u91CD\u542F\u5BBF\u4E3B\u751F\u6548",
            error: fieldErrors.dataRoot
          },
          (0, import_react.createElement)("input", {
            type: "text",
            style: styles.input,
            value: form.dataRoot ?? "",
            placeholder: "\u9ED8\u8BA4 ~/.dsh/note-taker",
            onChange: (event) => setForm((prev) => ({ ...prev, dataRoot: event.target.value }))
          })
        )
      ),
      (0, import_react.createElement)(
        "div",
        { style: styles.bar },
        (0, import_react.createElement)("button", {
          type: "button",
          style: saving ? { ...styles.btnPrimary, opacity: 0.6 } : styles.btnPrimary,
          disabled: saving,
          onClick: save
        }, saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u914D\u7F6E"),
        (0, import_react.createElement)("span", { style: styles.muted }, `\u751F\u6548\u6765\u6E90\uFF1A\u5F15\u64CE ${sources.engine ?? "\u2014"}\uFF0FKey ${sources.apiKey ?? "\u2014"}`)
      )
    ) : null,
    tab === "minutes" ? (0, import_react.createElement)(
      "div",
      { style: styles.card },
      (0, import_react.createElement)("div", { style: { fontSize: 13, fontWeight: 600 } }, `\u5386\u53F2\u7EAA\u8981\uFF08${minutesRows.length}\uFF09`),
      minutesRows.length === 0 ? (0, import_react.createElement)("div", { style: styles.muted }, "\u8FD8\u6CA1\u6709\u7EAA\u8981\u3002\u5F55\u97F3\u5E76\u5728\u4F1A\u8BDD\u91CC\u751F\u6210\u540E\uFF0C\u8FD9\u91CC\u4F1A\u51FA\u73B0\u3002") : (0, import_react.createElement)(
        "table",
        { style: styles.table },
        (0, import_react.createElement)("thead", null, (0, import_react.createElement)(
          "tr",
          null,
          (0, import_react.createElement)("th", { style: styles.th }, "\u65F6\u95F4"),
          (0, import_react.createElement)("th", { style: styles.th }, "\u6807\u7B7E"),
          (0, import_react.createElement)("th", { style: styles.th }, "\u65F6\u957F"),
          (0, import_react.createElement)("th", { style: styles.th }, "\u5F15\u64CE"),
          (0, import_react.createElement)("th", { style: styles.th }, "\u6BB5\u6570")
        )),
        (0, import_react.createElement)("tbody", null, minutesRows.map((row) => (0, import_react.createElement)(
          "tr",
          {
            key: row.id,
            onClick: () => openMinutes(row.id),
            style: { cursor: "pointer", background: row.id === openedId ? theme.accentBg : "transparent" }
          },
          (0, import_react.createElement)("td", { style: styles.td }, row.startedText),
          (0, import_react.createElement)("td", { style: styles.td }, row.label),
          (0, import_react.createElement)("td", { style: styles.td }, row.durationText),
          (0, import_react.createElement)("td", { style: styles.td }, row.engineText),
          (0, import_react.createElement)("td", { style: styles.td }, row.segments ?? "\u2014")
        )))
      )
    ) : null,
    tab === "minutes" && openedId ? (0, import_react.createElement)(
      "div",
      { style: styles.card },
      (0, import_react.createElement)(
        "div",
        { style: styles.bar },
        (0, import_react.createElement)("strong", null, "\u7EAA\u8981\u6B63\u6587"),
        (0, import_react.createElement)("button", { type: "button", style: styles.btn, onClick: () => openMinutes(openedId) }, "\u6536\u8D77")
      ),
      minutesText ? (0, import_react.createElement)(
        "div",
        null,
        (0, import_react.createElement)("pre", { style: styles.pre }, paginateTranscript(minutesText, { showAll }).lines.join("\n")),
        paginateTranscript(minutesText, { showAll }).truncated ? (0, import_react.createElement)(
          "button",
          { type: "button", style: styles.btn, onClick: () => setShowAll(true) },
          `\u5C55\u5F00\u5269\u4F59 ${paginateTranscript(minutesText, { showAll }).remaining} \u884C`
        ) : null
      ) : (0, import_react.createElement)("div", { style: styles.muted }, "\u8FD9\u573A\u4F1A\u8BAE\u8FD8\u6CA1\u6709\u7EAA\u8981\u6587\u4EF6")
    ) : null
  );
}

// src/client/MeetingPanel.jsx
var import_react4 = require("react");

// src/client/QuickPanel.jsx
var import_react3 = require("react");

// src/client/handoff.js
var MAX_INLINE_CHARS = 8e3;
var INSTRUCTION_FILE = (path) => [
  `\u4EA7\u7269\u6587\u4EF6\uFF1A\`${path}\``,
  "\u8BE5\u6587\u4EF6\u5305\u542B\u5143\u4FE1\u606F\u3001`## \u8F6C\u5199` \u4E0E `## \u7EAA\u8981` \u4E24\u8282\u3002",
  "\u8BF7\u8BFB\u53D6\u5B83\uFF0C\u751F\u6210\u4F1A\u8BAE\u7EAA\u8981\u5E76\u5199\u5165\u540C\u4E00\u6587\u4EF6\u7684 `## \u7EAA\u8981` \u4E00\u8282\uFF1B\u7ED3\u6784\u8981\u6C42\uFF1A",
  "\u6807\u9898 / \u300C> \u65E5\u671F: YYYY-MM-DD | \u65F6\u957F: N \u5206\u949F\u300D/ \u4E00\u53E5\u8BDD\u6458\u8981 / \u8BAE\u9898 / \u51B3\u8BAE / \u884C\u52A8\u9879\uFF08\u8D1F\u8D23\u4EBA + \u4E8B\u9879 + \u622A\u6B62\u65F6\u95F4\uFF09\u3002",
  "\u4FE1\u606F\u4E0D\u8DB3\u5904\u6807\u6CE8\u300C\u5F85\u786E\u8BA4\u300D\uFF0C\u4E0D\u8981\u7F16\u9020\u3002"
].join("\n");
var INSTRUCTION_INLINE = "\u8BF7\u636E\u6B64\u751F\u6210\u4F1A\u8BAE\u7EAA\u8981\uFF1A\u6309\u300C\u80CC\u666F / \u8BA8\u8BBA\u8981\u70B9 / \u51B3\u8BAE / \u884C\u52A8\u9879\uFF08\u8D1F\u8D23\u4EBA + \u622A\u6B62\u65F6\u95F4\uFF09\u300D\u7EC4\u7EC7\uFF0C\u7ED3\u8BBA\u8981\u5177\u4F53\uFF0C\u884C\u52A8\u9879\u5FC5\u987B\u80FD\u843D\u5230\u4EBA\u548C\u65E5\u671F\uFF1B\u4FE1\u606F\u4E0D\u8DB3\u7684\u5730\u65B9\u6807\u6CE8\u300C\u5F85\u786E\u8BA4\u300D\uFF0C\u4E0D\u8981\u7F16\u9020\u3002";
function fmtDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const pad = (value) => String(value).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const secs = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}
function buildHandoffMessage({
  meetingId,
  label,
  durationSec,
  outputPath,
  outputMode = "workspace",
  workspaceRoot,
  transcript,
  maxChars = MAX_INLINE_CHARS
} = {}) {
  if (typeof meetingId !== "string" || meetingId.trim() === "") {
    return { ok: false, reason: "\u7F3A\u5C11\u4F1A\u8BAE id\uFF0C\u65E0\u6CD5\u8BA9\u4F1A\u8BDD\u5B9A\u4F4D\u8FD9\u573A\u4F1A\u8BAE" };
  }
  const name2 = typeof label === "string" && label.trim() !== "" ? label.trim() : "(\u672A\u547D\u540D)";
  const header = `\u3010\u4F1A\u8BB0\u3011\u4F1A\u8BAE ${meetingId}\uFF08${name2}\uFF0C${fmtDuration(durationSec)}\uFF09`;
  const hasPath = typeof outputPath === "string" && outputPath.trim() !== "";
  if (hasPath) {
    const root = outputMode === "workspace" && typeof workspaceRoot === "string" && workspaceRoot.trim() !== "" ? `\u5DE5\u4F5C\u533A\u6839\uFF1A\`${workspaceRoot.trim()}\`
` : "";
    const text = `${header}
${root}${INSTRUCTION_FILE(outputPath.trim())}
`;
    return { ok: true, mode: "file", text, chars: text.length };
  }
  const body = typeof transcript === "string" ? transcript.trim() : "";
  if (body === "") return { ok: false, reason: "\u65E2\u6CA1\u6709\u4EA7\u7269\u8DEF\u5F84\uFF0C\u4E5F\u6CA1\u6709\u8F6C\u5199\u5185\u5BB9" };
  if (body.length <= maxChars) {
    return { ok: true, mode: "inline", chars: body.length, text: `${header}
${INSTRUCTION_INLINE}

${body}
` };
  }
  const head = body.slice(0, 800).replace(/\s+$/, "");
  const lines = body.split("\n").length;
  return {
    ok: true,
    mode: "summary",
    chars: body.length,
    text: `${header}
${INSTRUCTION_INLINE}

\u8F6C\u5199\u5171 ${body.length} \u5B57 / ${lines} \u884C\uFF0C\u8D85\u8FC7\u5355\u6B21\u6D88\u606F\u4E0A\u9650\uFF08${maxChars} \u5B57\uFF09\uFF0C\u8FD9\u91CC\u53EA\u653E\u5F00\u5934\u6458\u8981\u3002

${head}\u2026
`
  };
}

// src/client/host.js
var state = {
  /** 'unknown' | 'available' | 'unavailable' */
  conversation: "unknown",
  sessions: null,
  via: "none",
  reason: "\u5C1A\u672A\u63A2\u6D4B",
  probedAt: null
};
function getHostStatus() {
  return { conversation: state.conversation, via: state.via, reason: state.reason, probedAt: state.probedAt };
}
function getSessions() {
  return state.sessions;
}
function markAvailable(sessions, via) {
  state.conversation = "available";
  state.sessions = sessions;
  state.via = via;
  state.reason = "";
  state.probedAt = (/* @__PURE__ */ new Date()).toISOString();
}
function markUnavailable(reason, via = "none") {
  state.conversation = "unavailable";
  state.sessions = null;
  state.via = via;
  state.reason = reason;
  state.probedAt = (/* @__PURE__ */ new Date()).toISOString();
}
function usable(candidate) {
  return Boolean(candidate && typeof candidate.scope === "function");
}
function probeHost(ctx, { log } = {}) {
  const say = log ?? (() => {
  });
  try {
    const direct = (typeof ctx?.get === "function" ? ctx.get("sessions") : void 0) ?? ctx?.sessions;
    if (usable(direct)) {
      markAvailable(direct, "direct");
      say("[note-taker] \u4EA4\u63A5\u80FD\u529B\uFF1A\u53EF\u7528\uFF08sessions.scope\uFF0Cdirect\uFF09");
      return getHostStatus();
    }
    markUnavailable("sessions \u670D\u52A1\u4E0D\u5B58\u5728\u6216\u6CA1\u6709 scope \u65B9\u6CD5", "direct");
  } catch (error) {
    markUnavailable(`\u76F4\u63A5\u53D6\u5931\u8D25\uFF1A${String(error?.message ?? error).slice(0, 80)}`, "direct");
  }
  try {
    if (typeof ctx?.inject === "function") {
      ctx.inject(["sessions"], (inner) => {
        const sessions = inner?.sessions ?? (typeof inner?.get === "function" ? inner.get("sessions") : void 0);
        if (usable(sessions)) {
          markAvailable(sessions, "inject");
          say("[note-taker] \u4EA4\u63A5\u80FD\u529B\uFF1A\u53EF\u7528\uFF08sessions.scope\uFF0Cinject\uFF09");
        } else {
          markUnavailable("\u6CE8\u5165\u540E\u4ECD\u65E0 sessions.scope", "inject");
          say("[note-taker] \u4EA4\u63A5\u80FD\u529B\uFF1A\u6CE8\u5165\u540E\u4ECD\u65E0 sessions\uFF0C\u8D70\u515C\u5E95");
        }
      });
    } else {
      markUnavailable("\u5BBF\u4E3B\u4E0A\u4E0B\u6587\u6CA1\u6709 inject\uFF0C\u65E0\u6CD5\u53D6\u5F97 sessions", "none");
    }
  } catch (error) {
    markUnavailable(`\u6CE8\u5165\u5931\u8D25\uFF1A${String(error?.message ?? error).slice(0, 80)}`, "inject");
    say(`[note-taker] \u4EA4\u63A5\u80FD\u529B\u63A2\u6D4B\u5931\u8D25\uFF1A${String(error?.message ?? error).slice(0, 80)}`);
  }
  return getHostStatus();
}
function hostStatusText(status = getHostStatus()) {
  if (status.conversation === "available") return `\u4F1A\u8BDD\u53D1\u9001\uFF1A\u53EF\u7528\uFF08sessions.scope \xB7 ${status.via}\uFF09`;
  if (status.conversation === "unavailable") return `\u4F1A\u8BDD\u53D1\u9001\uFF1A\u4E0D\u53EF\u7528\uFF08${status.reason}\uFF09`;
  return "\u4F1A\u8BDD\u53D1\u9001\uFF1A\u5C1A\u672A\u63A2\u6D4B";
}
async function sendToSession({ sessionId, text } = {}) {
  const sessions = getSessions();
  if (!sessions) return { ok: false, reason: "\u5BBF\u4E3B\u672A\u63D0\u4F9B sessions \u670D\u52A1\uFF08\u63A2\u9488\u672A\u901A\u8FC7\uFF09" };
  if (typeof sessionId !== "string" || sessionId === "") return { ok: false, reason: "\u62FF\u4E0D\u5230\u5F53\u524D\u4F1A\u8BDD id" };
  if (typeof text !== "string" || text.trim() === "") return { ok: false, reason: "\u6D88\u606F\u5185\u5BB9\u4E3A\u7A7A" };
  let scoped;
  try {
    scoped = sessions.scope(sessionId);
  } catch (error) {
    return { ok: false, reason: `\u53D6\u4F1A\u8BDD\u4F5C\u7528\u57DF\u5931\u8D25\uFF1A${String(error?.message ?? error).slice(0, 80)}` };
  }
  if (!scoped) return { ok: false, reason: `\u4F1A\u8BDD "${sessionId}" \u6CA1\u6709\u5BF9\u5E94\u4F5C\u7528\u57DF` };
  const conversation = typeof scoped.get === "function" ? scoped.get("conversation") : scoped.conversation;
  if (!conversation || typeof conversation.send !== "function") {
    return { ok: false, reason: "\u4F1A\u8BDD\u4F5C\u7528\u57DF\u91CC\u6CA1\u6709 conversation.send" };
  }
  try {
    await conversation.send(text);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `\u53D1\u9001\u5931\u8D25\uFF1A${String(error?.message ?? error).slice(0, 120)}` };
  }
}
async function copyText(text) {
  try {
    if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true, via: "clipboard" };
    }
    return { ok: false, reason: "\u5F53\u524D\u73AF\u5883\u6CA1\u6709 clipboard API" };
  } catch (error) {
    return { ok: false, reason: `\u590D\u5236\u5931\u8D25\uFF1A${String(error?.message ?? error).slice(0, 60)}` };
  }
}

// src/client/recordState.js
var import_react2 = require("react");
var POLL_MS = 3e3;
var api = createApi({});
var listeners = /* @__PURE__ */ new Set();
var snapshot = { running: false, seconds: 0, meetingId: null, label: "", startedAt: null, streaming: false, interrupted: null };
var timer = null;
var inflight = false;
var base = { seconds: 0, at: 0 };
function emit(next) {
  snapshot = { ...snapshot, ...next };
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {
    }
  }
}
function localSeconds() {
  const drift = base.at ? Math.floor((Date.now() - base.at) / 1e3) : 0;
  return Math.max(0, (base.seconds || 0) + drift);
}
async function tick() {
  if (inflight) return;
  inflight = true;
  try {
    const result = await api.recordState();
    if (result?.ok === false) {
      emit({ running: false, seconds: 0, reason: result.code ?? "E_STATE" });
      return;
    }
    const running = result?.running === true;
    const seconds = Number.isFinite(result?.seconds) ? result.seconds : 0;
    base = { seconds, at: Date.now() };
    emit({
      running,
      seconds,
      meetingId: result?.meetingId ?? null,
      label: result?.label ?? "",
      startedAt: result?.startedAt ?? null,
      streaming: result?.streaming === true,
      interrupted: result?.interrupted ?? null
    });
  } catch {
  } finally {
    inflight = false;
  }
}
function startPolling() {
  if (timer) return;
  tick();
  timer = setInterval(tick, POLL_MS);
}
function stopPolling() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
function subscribeRecordState(fn) {
  listeners.add(fn);
  startPolling();
  fn(snapshot);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) stopPolling();
  };
}
function getRecordSnapshot() {
  return snapshot;
}
function useRecordState() {
  const [state2, setState] = (0, import_react2.useState)(getRecordSnapshot());
  const [, setTick] = (0, import_react2.useState)(0);
  (0, import_react2.useEffect)(() => subscribeRecordState(setState), []);
  (0, import_react2.useEffect)(() => {
    if (!state2.running) return void 0;
    const id = setInterval(() => setTick((n) => n + 1), 1e3);
    return () => clearInterval(id);
  }, [state2.running]);
  return {
    ...state2,
    seconds: state2.running ? localSeconds() : 0
  };
}

// src/client/QuickPanel.jsx
var POLL_MS2 = 2e3;
var TRANSCRIBE_TIMEOUT_MS = 15 * 60 * 1e3;
var styles2 = {
  // CR-01：root 撑满输入行高，使卡片的 bottom:100% 落在「输入行上沿」而不是「入口上沿」，
  // 避免卡片压进输入行、吃掉点输入框的点击（实测缺陷：光标进不去，缩放窗口才恢复）
  root: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "stretch"
  },
  // 入口：图标 + 文字，无按钮外观（R-01）；开合状态由 aria-expanded 表达，不靠边框
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: 0,
    border: "none",
    background: "transparent",
    color: theme.textSecondary,
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "inherit",
    lineHeight: "16px"
  },
  dot: (tone) => ({
    width: 8,
    height: 8,
    borderRadius: 999,
    display: "inline-block",
    flex: "0 0 auto",
    background: tone === "success" ? theme.success : theme.textMuted
  }),
  timing: { color: theme.textSecondary, fontVariantNumeric: "tabular-nums" },
  // 卡片内确认条（替代 window.confirm）
  consent: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 8,
    borderRadius: 8,
    border: `1px solid ${theme.accentBorder}`,
    background: theme.accentBg
  },
  consentText: { color: theme.text, fontSize: 11, lineHeight: 1.6 },
  panel: {
    // CR-01：间距改用 marginBottom，bottom 只表达「贴着输入行上沿」，不再把偏移量算进锚点
    position: "absolute",
    bottom: "100%",
    right: 0,
    zIndex: 40,
    width: 380,
    maxWidth: "min(380px, calc(100vw - 24px))",
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    border: `1px solid ${theme.border}`,
    fontSize: 12,
    background: theme.bg,
    color: theme.text,
    fontFamily: theme.font,
    boxShadow: "0 8px 24px rgba(0,0,0,0.18)"
  },
  row: { display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" },
  btn: { padding: "5px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, background: "transparent", color: theme.text, cursor: "pointer", fontSize: 12, fontFamily: "inherit" },
  btnPrimary: { padding: "5px 10px", borderRadius: 8, border: `1px solid ${theme.accentBorder}`, background: theme.accentBg, color: theme.text, cursor: "pointer", fontSize: 12, fontFamily: "inherit" },
  muted: { color: theme.textMuted, fontSize: 11 },
  error: { color: theme.danger, fontSize: 11 },
  ok: { color: theme.success, fontSize: 11 },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    minHeight: 120,
    maxHeight: 240,
    resize: "vertical",
    padding: 8,
    borderRadius: 8,
    border: `1px solid ${theme.border}`,
    background: "transparent",
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: 11,
    lineHeight: 1.5
  },
  // 字幕区：定稿强（正文色）、中间结果弱（灰 + 斜体），不引入新颜色令牌
  liveBox: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: 8,
    borderRadius: 8,
    border: `1px solid ${theme.border}`,
    maxHeight: 168,
    overflowY: "auto"
  },
  liveFinal: { color: theme.text, fontSize: 11, lineHeight: 1.6 },
  livePartial: { color: theme.textMuted, fontStyle: "italic", fontSize: 11, lineHeight: 1.6 },
  liveTime: { color: theme.textMuted, fontSize: 10, fontFamily: theme.mono, marginRight: 6 },
  // 页面模式（CR-02）：入口搬到侧栏后，这里是主区域的「会记」页面，不再是浮在输入框上的卡片
  pageRoot: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    boxSizing: "border-box",
    overflowY: "auto",
    padding: "20px 24px 28px",
    color: theme.text,
    fontFamily: theme.font,
    background: theme.bg
  },
  pagePanel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    width: "100%",
    maxWidth: 860,
    fontSize: 13,
    border: "none",
    padding: 0,
    background: "transparent"
  }
};
var PHASE_TEXT = {
  starting: "\u542F\u52A8\u5F55\u97F3\u2026",
  stopping: "\u6536\u5C3E\u5F55\u97F3\u2026",
  transcribing: "\u8BC6\u522B\u4E2D\u2026",
  sending: "\u53D1\u9001\u4E2D\u2026",
  sent: "\u5DF2\u53D1\u9001",
  error: "\u51FA\u9519"
};
function QuickPanel({ sessionId, page = false } = {}) {
  const [open, setOpen] = (0, import_react3.useState)(false);
  const [rows, setRows] = (0, import_react3.useState)([]);
  const [health, setHealth] = (0, import_react3.useState)(null);
  const [error, setError] = (0, import_react3.useState)(null);
  const [notice, setNotice] = (0, import_react3.useState)(null);
  const [phase, setPhase] = (0, import_react3.useState)("idle");
  const [current, setCurrent] = (0, import_react3.useState)(null);
  const [transcript, setTranscript] = (0, import_react3.useState)("");
  const [seconds, setSeconds] = (0, import_react3.useState)(0);
  const [elapsed, setElapsed] = (0, import_react3.useState)(0);
  const [labelDraft, setLabelDraft] = (0, import_react3.useState)("");
  const [refreshError, setRefreshError] = (0, import_react3.useState)(null);
  const [live, setLive] = (0, import_react3.useState)(null);
  const [liveSilence, setLiveSilence] = (0, import_react3.useState)(0);
  const rootRef = (0, import_react3.useRef)(null);
  const streamAckRef = (0, import_react3.useRef)(false);
  const liveKeyRef = (0, import_react3.useRef)("");
  const liveChangedAtRef = (0, import_react3.useRef)(0);
  const [consent, setConsent] = (0, import_react3.useState)(null);
  const consentResolveRef = (0, import_react3.useRef)(null);
  const askConsent = (0, import_react3.useCallback)((text) => new Promise((resolve) => {
    consentResolveRef.current = resolve;
    setConsent({ text });
  }), []);
  const answerConsent = (0, import_react3.useCallback)((granted) => {
    const resolve = consentResolveRef.current;
    consentResolveRef.current = null;
    setConsent(null);
    if (resolve) resolve(granted);
  }, []);
  const api2 = (0, import_react3.useMemo)(() => createApi({
    confirmCloud: (text) => askConsent(text)
  }), [askConsent]);
  const caps = (0, import_react3.useMemo)(() => capabilitiesFrom(health), [health]);
  const refresh = (0, import_react3.useCallback)(async () => {
    const [listResult, healthResult] = await Promise.all([api2.list({ limit: 3 }), api2.health()]);
    if (listResult.ok === false) {
      setRefreshError(`\u5237\u65B0\u5931\u8D25\uFF1A${errorText(listResult.code, listResult.detail)}`);
      return;
    }
    setRefreshError(null);
    setRows(listResult.meetings ?? []);
    setHealth(healthResult.ok === false ? null : healthResult);
  }, [api2]);
  const visible = page || open;
  (0, import_react3.useEffect)(() => {
    if (!visible) return void 0;
    refresh();
    const timer2 = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) refresh();
    }, POLL_MS2 * 2);
    return () => clearInterval(timer2);
  }, [visible, refresh]);
  (0, import_react3.useEffect)(() => {
    if (!visible || page) return void 0;
    const close = () => {
      if (consentResolveRef.current) answerConsent(false);
      setOpen(false);
    };
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
    }
    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("mousedown", onDown);
        document.removeEventListener("keydown", onKey);
      }
    };
  }, [open]);
  (0, import_react3.useEffect)(() => {
    if (phase !== "recording") {
      setSeconds(0);
      return void 0;
    }
    const timer2 = setInterval(() => setSeconds((value) => value + 1), 1e3);
    return () => clearInterval(timer2);
  }, [phase]);
  (0, import_react3.useEffect)(() => {
    if (phase !== "transcribing") {
      setElapsed(0);
      return void 0;
    }
    const startedAt = Date.now();
    const timer2 = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1e3)), 1e3);
    return () => clearInterval(timer2);
  }, [phase]);
  (0, import_react3.useEffect)(() => {
    const meetingId = current?.meetingId;
    if (phase !== "recording" || current?.streaming !== true || !meetingId) {
      setLive(null);
      setLiveSilence(0);
      return void 0;
    }
    let stopped = false;
    const tick2 = async () => {
      if (stopped) return;
      if (!shouldPollLive({ phase: "recording", streaming: true, hidden: typeof document !== "undefined" && document.hidden === true })) return;
      const result = await api2.live({ id: meetingId });
      if (stopped || result.ok === false) return;
      const snapshot2 = result.data ?? null;
      setLive(snapshot2);
      const key = `${snapshot2?.chars ?? 0}|${snapshot2?.partial ?? ""}`;
      if (key !== liveKeyRef.current) {
        liveKeyRef.current = key;
        liveChangedAtRef.current = Date.now();
      }
      const silence = liveChangedAtRef.current === 0 ? 0 : Math.floor((Date.now() - liveChangedAtRef.current) / 1e3);
      setLiveSilence(silence);
    };
    liveKeyRef.current = "";
    liveChangedAtRef.current = Date.now();
    tick2();
    const timer2 = setInterval(tick2, LIVE_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer2);
    };
  }, [phase, current?.meetingId, current?.streaming, api2]);
  const startRecord = (0, import_react3.useCallback)(async () => {
    setError(null);
    setNotice(null);
    setPhase("starting");
    const wantStream = caps.streamReady === true;
    if (wantStream && needsStreamConsent({ streamEnabled: true, acknowledged: streamAckRef.current })) {
      const granted = await askConsent(STREAM_CONSENT_TEXT);
      if (!granted) {
        setPhase("idle");
        setNotice("\u5DF2\u53D6\u6D88\uFF1A\u672A\u786E\u8BA4\u5F55\u97F3\u671F\u95F4\u4E0A\u4F20\u97F3\u9891");
        return;
      }
      streamAckRef.current = true;
    }
    const result = await api2.record({ action: "start", stream: wantStream ? true : void 0, sessionId });
    if (result.ok === false) {
      setPhase("error");
      setError(errorText(result.code, result.detail));
      return;
    }
    setCurrent({ meetingId: result.meetingId, label: "", durationSec: null, streaming: result.stream?.stream === true });
    setPhase("recording");
  }, [api2, askConsent, caps.streamReady, sessionId]);
  const awaitTranscript = (0, import_react3.useCallback)(async (meetingId, durationSec) => {
    const deadline = Date.now() + TRANSCRIBE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS2));
      const detail = await api2.detail({ id: meetingId, sessionId });
      if (detail.ok === false) {
        setPhase("error");
        setError(errorText(detail.code, detail.detail));
        return;
      }
      const status = detail.meeting?.status?.transcribe;
      if (status === "done") {
        const label = detail.meeting?.label ?? "";
        setCurrent({
          meetingId,
          label,
          startedAt: detail.meeting?.startedAt,
          durationSec: detail.meeting?.durationSec ?? durationSec,
          outputPath: detail.outputPath ?? null,
          outputMode: detail.outputMode ?? "fallback",
          workspaceRoot: detail.workspaceRoot ?? null,
          streaming: false
        });
        setLabelDraft(label);
        setTranscript(detail.transcript ?? "");
        setPhase("confirm");
        refresh();
        return;
      }
      if (status === "failed") {
        setPhase("error");
        setError(detail.meeting?.errors?.transcribe ?? "\u8BC6\u522B\u5931\u8D25");
        return;
      }
    }
    setPhase("error");
    setError("\u8BC6\u522B\u8D85\u65F6\uFF0C\u8BF7\u7A0D\u540E\u5728\u8BBE\u7F6E\u9875\u67E5\u770B\u72B6\u6001");
  }, [api2, refresh, sessionId]);
  const runTranscribe = (0, import_react3.useCallback)(async (meetingId, durationSec) => {
    setPhase("transcribing");
    setTranscript("");
    const config = await api2.getConfig();
    const engine = config.ok === false ? void 0 : config.config?.asr?.engine;
    const accepted = await api2.transcribe({ id: meetingId, engine, sessionId });
    if (accepted.ok === false) {
      setPhase("error");
      setError(errorText(accepted.code, accepted.detail));
      if (accepted.message) setNotice(accepted.message);
      return;
    }
    await awaitTranscript(meetingId, durationSec);
  }, [api2, sessionId, awaitTranscript]);
  const stopRecord = (0, import_react3.useCallback)(async () => {
    setPhase("stopping");
    const result = await api2.record({ action: "stop", sessionId });
    if (result.ok === false) {
      setPhase("error");
      setError(errorText(result.code, result.detail));
      return;
    }
    const stream = result.stream;
    if (stream?.used === true) {
      setLive(null);
      setNotice(`\u6D41\u5F0F\u8BC6\u522B\u5B8C\u6210\uFF1A${stream.segments} \u6BB5 / ${stream.chars} \u5B57${stream.timedOut ? "\uFF08\u672B\u5C3E\u53EF\u80FD\u622A\u65AD\uFF09" : ""}`);
      setPhase("transcribing");
      await awaitTranscript(result.meetingId, result.durationSec);
      return;
    }
    if (stream?.degraded === true) {
      setLive(null);
      setNotice("\u6D41\u5F0F\u672A\u8FDE\u4E0A\uFF0C\u5DF2\u6539\u7528\u505C\u5F55\u540E\u7684\u6574\u6BB5\u8BC6\u522B");
      setPhase("transcribing");
      await awaitTranscript(result.meetingId, result.durationSec);
      return;
    }
    setLive(null);
    await runTranscribe(result.meetingId, result.durationSec);
  }, [api2, sessionId, awaitTranscript, runTranscribe]);
  const handoff = (0, import_react3.useCallback)(async () => {
    if (!current?.meetingId) return;
    const built = buildHandoffMessage({
      meetingId: current.meetingId,
      label: current.label,
      durationSec: current.durationSec,
      outputPath: current.outputPath,
      outputMode: current.outputMode,
      workspaceRoot: current.workspaceRoot,
      transcript
    });
    if (built.ok === false) {
      setPhase("error");
      setError(built.reason);
      return;
    }
    setPhase("sending");
    const sent = await sendToSession({ sessionId, text: built.text });
    if (sent.ok) {
      setPhase("sent");
      setNotice(`\u5DF2\u53D1\u9001\u5230\u4F1A\u8BDD\uFF08${built.mode === "summary" ? "\u6458\u8981\u6A21\u5F0F" : "\u5168\u6587"}\uFF0C${built.chars} \u5B57\uFF09`);
      return;
    }
    setError(`\u65E0\u6CD5\u81EA\u52A8\u53D1\u9001\uFF1A${sent.reason}`);
    const copied = await copyText(built.text);
    setPhase("sent");
    setNotice(copied.ok ? "\u5BBF\u4E3B\u4E0D\u652F\u6301\u81EA\u52A8\u53D1\u9001\uFF0C\u6587\u672C\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F\uFF0C\u8BF7\u7C98\u8D34\u5230\u8F93\u5165\u6846\u53D1\u9001" : `\u65E0\u6CD5\u53D1\u9001\u4E5F\u65E0\u6CD5\u590D\u5236\uFF08${copied.reason}\uFF09\uFF0C\u8BF7\u624B\u52A8\u91CD\u8BD5`);
  }, [current, transcript, sessionId]);
  const saveLabel = (0, import_react3.useCallback)(async () => {
    if (!current?.meetingId) return;
    const next = labelDraft.trim();
    if (next === (current.label ?? "")) return;
    const result = await api2.rename({ id: current.meetingId, label: next });
    if (result.ok === false) {
      setError(errorText(result.code, result.detail));
      return;
    }
    setCurrent((prev) => ({ ...prev, label: next }));
    setError(null);
  }, [api2, current, labelDraft]);
  const reset = (0, import_react3.useCallback)(() => {
    setPhase("idle");
    setCurrent(null);
    setTranscript("");
    setLabelDraft("");
    setError(null);
    setNotice(null);
    setLive(null);
    setLiveSilence(0);
  }, []);
  const globalRecord = useRecordState();
  const externalRunning = page && globalRecord.running === true;
  const recording = phase === "recording" || externalRunning;
  const liveSeconds = externalRunning ? globalRecord.seconds : seconds;
  const busy = ["starting", "stopping", "transcribing", "sending"].includes(phase);
  const liveCard = liveView(live, { silenceSec: liveSilence });
  const trigger = triggerView({ recording, seconds, open });
  return (0, import_react3.createElement)(
    "div",
    { ref: rootRef, style: page ? styles2.pageRoot : styles2.root },
    page ? null : (0, import_react3.createElement)(
      "button",
      {
        type: "button",
        style: styles2.trigger,
        title: trigger.title,
        "aria-label": trigger.ariaLabel,
        "aria-expanded": trigger.expanded,
        onClick: () => setOpen((value) => !value)
      },
      (0, import_react3.createElement)("span", { key: "dot", style: styles2.dot(trigger.tone), "aria-hidden": "true" }),
      (0, import_react3.createElement)("span", { key: "label" }, trigger.label),
      trigger.timing ? (0, import_react3.createElement)("span", { key: "timing", style: styles2.timing }, trigger.timing) : null
    ),
    page || open ? (0, import_react3.createElement)(
      "div",
      { style: page ? styles2.pagePanel : styles2.panel },
      (0, import_react3.createElement)(
        "div",
        { style: styles2.row },
        (0, import_react3.createElement)("strong", null, "\u4F1A\u8BB0"),
        (0, import_react3.createElement)("span", { style: styles2.muted }, caps.cloudReady ? `\u4E91\u7AEF\u53EF\u7528${caps.cloudModel ? `\xB7${caps.cloudModel}` : ""}` : "\u4E91\u7AEF\u672A\u914D\u7F6E")
      ),
      error ? (0, import_react3.createElement)("div", { style: styles2.error }, error) : null,
      refreshError ? (0, import_react3.createElement)("div", { style: styles2.muted }, refreshError) : null,
      notice ? (0, import_react3.createElement)("div", { style: styles2.ok }, notice) : null,
      // 卡片内确认条（替代 window.confirm：原生弹窗会打断宿主输入法的编辑上下文）
      consent ? (0, import_react3.createElement)(
        "div",
        { style: styles2.consent },
        (0, import_react3.createElement)("div", { style: styles2.consentText }, consent.text),
        (0, import_react3.createElement)(
          "div",
          { style: styles2.row },
          (0, import_react3.createElement)("button", { type: "button", style: styles2.btnPrimary, onClick: () => answerConsent(true) }, "\u7EE7\u7EED"),
          (0, import_react3.createElement)("button", { type: "button", style: styles2.btn, onClick: () => answerConsent(false) }, "\u53D6\u6D88")
        )
      ) : null,
      (0, import_react3.createElement)(
        "div",
        { style: styles2.row },
        recording ? (0, import_react3.createElement)("button", { type: "button", style: styles2.btn, onClick: stopRecord }, `\u505C\u6B62\u5E76\u8BC6\u522B ${formatDuration(liveSeconds)}`) : (0, import_react3.createElement)("button", {
          type: "button",
          style: busy || !caps.recordingReady ? { ...styles2.btn, opacity: 0.5 } : styles2.btn,
          disabled: busy || !caps.recordingReady,
          title: caps.recordingReady ? "" : "\u5F55\u97F3\u4F9D\u8D56\u4E0D\u53EF\u7528",
          onClick: startRecord
        }, "\u5F00\u59CB\u5F55\u97F3"),
        (0, import_react3.createElement)("button", { type: "button", style: busy ? { ...styles2.btn, opacity: 0.5 } : styles2.btn, onClick: refresh, disabled: busy }, "\u5237\u65B0")
      ),
      PHASE_TEXT[phase] ? (0, import_react3.createElement)("div", { style: styles2.muted }, phase === "transcribing" ? `\u8BC6\u522B\u4E2D\u2026 \u5DF2\u7B49\u5F85 ${formatDuration(elapsed)}` : PHASE_TEXT[phase]) : null,
      // 字幕区（R-02/R-03）：定稿强、中间结果弱；降级后冻结并说明
      liveCard ? (0, import_react3.createElement)(
        "div",
        { style: styles2.liveBox },
        (0, import_react3.createElement)(
          "div",
          { style: styles2.row },
          (0, import_react3.createElement)("span", { style: liveCard.tone === "error" ? styles2.error : styles2.muted }, liveCard.statusText),
          (0, import_react3.createElement)("span", { style: styles2.muted }, `${liveCard.elapsedText} \xB7 ${liveCard.chars} \u5B57`)
        ),
        ...liveCard.finals.map((item) => (0, import_react3.createElement)(
          "div",
          { key: item.key, style: styles2.liveFinal },
          (0, import_react3.createElement)("span", { style: styles2.liveTime }, item.timeText),
          item.text
        )),
        liveCard.partial ? (0, import_react3.createElement)("div", { key: "partial", style: styles2.livePartial }, liveCard.partial) : null,
        liveCard.waiting ? (0, import_react3.createElement)("div", { style: styles2.muted }, "\u7B49\u5F85\u8BED\u97F3\u2026") : null,
        liveCard.blank && !liveCard.waiting ? (0, import_react3.createElement)("div", { style: styles2.muted }, liveCard.state === "finalizing" ? "\u6B63\u5728\u5B9A\u7A3F\u2026" : "\u6B63\u5728\u8046\u542C\u2026") : null,
        liveCard.frozen ? (0, import_react3.createElement)("div", { style: styles2.muted }, "\u5B57\u5E55\u5DF2\u505C\u6B62\u66F4\u65B0") : null,
        liveCard.tone === "error" ? (0, import_react3.createElement)("div", { style: styles2.error }, "\u6D41\u5F0F\u5DF2\u964D\u7EA7\uFF1A\u505C\u5F55\u540E\u4F1A\u6539\u7528\u6574\u6BB5\u97F3\u9891\u8BC6\u522B\uFF0C\u5B57\u5E55\u4E0D\u518D\u66F4\u65B0") : null
      ) : null,
      // 当前这场会议：名字可编辑；未命名时以开始时间占位
      current?.meetingId ? (0, import_react3.createElement)(
        "div",
        { style: styles2.row },
        (0, import_react3.createElement)("input", {
          key: "label",
          type: "text",
          style: { ...styles2.btn, flex: 1, minWidth: 0, cursor: "text", textAlign: "left" },
          value: labelDraft,
          placeholder: current.startedAt ? formatDateTime(current.startedAt) : "\u672A\u547D\u540D\uFF08\u6309\u65F6\u95F4\u663E\u793A\uFF09",
          maxLength: 60,
          title: "\u70B9\u8FD9\u91CC\u6539\u4F1A\u8BAE\u540D\uFF0C\u5931\u7126\u5373\u4FDD\u5B58",
          onChange: (event) => setLabelDraft(event.target.value),
          onBlur: saveLabel,
          onKeyDown: (event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }
        }),
        (0, import_react3.createElement)("span", { style: styles2.muted }, formatDuration(current.durationSec))
      ) : null,
      // 产物位置：让用户知道文件落在哪（R-01）
      current?.meetingId && current.outputPath ? (0, import_react3.createElement)(
        "div",
        { style: styles2.muted },
        `\u4EA7\u7269\uFF1A${current.outputPath}${current.outputMode === "workspace" ? "\uFF08\u5DE5\u4F5C\u533A\uFF09" : "\uFF08\u56DE\u843D\u6570\u636E\u76EE\u5F55\uFF09"}`
      ) : null,
      // 确认区：识别完成后出现，可编辑
      phase === "confirm" || phase === "sending" || phase === "sent" ? (0, import_react3.createElement)(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 6 } },
        (0, import_react3.createElement)("div", { style: styles2.muted }, `\u8BC6\u522B\u7ED3\u679C\uFF08\u53EF\u6539\u9519\u5B57\uFF09\xB7 ${transcript.length} \u5B57`),
        (0, import_react3.createElement)("textarea", {
          style: styles2.textarea,
          value: transcript,
          onChange: (event) => setTranscript(event.target.value),
          disabled: phase === "sending"
        }),
        (0, import_react3.createElement)(
          "div",
          { style: styles2.row },
          (0, import_react3.createElement)("button", {
            type: "button",
            style: phase === "sent" ? { ...styles2.btnPrimary, opacity: 0.5 } : styles2.btnPrimary,
            disabled: phase === "sending" || phase === "sent" || transcript.trim() === "",
            onClick: handoff
          }, phase === "sending" ? "\u53D1\u9001\u4E2D\u2026" : phase === "sent" ? "\u5DF2\u53D1\u9001" : "\u4EA4\u7ED9\u4F1A\u8BDD\u751F\u6210\u7EAA\u8981"),
          (0, import_react3.createElement)("button", { type: "button", style: styles2.btn, onClick: reset }, "\u91CD\u65B0\u5F55")
        )
      ) : null,
      phase === "error" && current?.meetingId ? (0, import_react3.createElement)(
        "div",
        { style: styles2.row },
        (0, import_react3.createElement)("button", { type: "button", style: styles2.btn, onClick: () => runTranscribe(current.meetingId, current.durationSec) }, "\u91CD\u8BD5\u8BC6\u522B"),
        (0, import_react3.createElement)("button", { type: "button", style: styles2.btn, onClick: reset }, "\u653E\u5F03")
      ) : null,
      (0, import_react3.createElement)("div", { style: styles2.muted }, "\u5168\u90E8\u4F1A\u8BAE\u5728 \u8BBE\u7F6E \u2192 \u4F1A\u8BB0"),
      (0, import_react3.createElement)("div", { style: { ...styles2.muted, fontSize: 10 } }, hostStatusText())
    ) : null
  );
}

// src/client/MeetingPanel.jsx
var styles3 = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    background: theme.bg,
    color: theme.text,
    fontFamily: theme.font
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: "none",
    padding: "14px 24px",
    borderBottom: `1px solid ${theme.border}`
  },
  title: { fontSize: 14, fontWeight: 600 },
  badge: (tone) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: tone === "recording" ? theme.success : theme.textMuted,
    fontVariantNumeric: "tabular-nums"
  }),
  dot: (tone) => ({
    width: 7,
    height: 7,
    borderRadius: 999,
    flex: "none",
    background: tone === "recording" ? theme.success : theme.textMuted
  }),
  spacer: { flex: 1 },
  body: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }
};
function MeetingPanel({ close } = {}) {
  const { running, seconds, label } = useRecordState();
  const tone = running ? "recording" : "idle";
  return (0, import_react4.createElement)(
    "div",
    { style: styles3.root },
    (0, import_react4.createElement)(
      "div",
      { style: styles3.header },
      (0, import_react4.createElement)("span", { style: styles3.title }, "\u4F1A\u8BB0"),
      (0, import_react4.createElement)(
        "span",
        { style: styles3.badge(tone) },
        (0, import_react4.createElement)("span", { style: styles3.dot(tone), "aria-hidden": "true" }),
        running ? `\u5F55\u5236\u4E2D ${formatClock(seconds)}${label ? ` \xB7 ${label}` : ""}` : "\u7A7A\u95F2"
      ),
      (0, import_react4.createElement)("span", { style: styles3.spacer }),
      typeof close === "function" ? (0, import_react4.createElement)("button", {
        type: "button",
        onClick: close,
        style: {
          padding: "4px 10px",
          borderRadius: 8,
          cursor: "pointer",
          fontSize: 12,
          border: `1px solid ${theme.border}`,
          background: "transparent",
          color: theme.textSecondary,
          fontFamily: "inherit"
        }
      }, "\u8FD4\u56DE\u4F1A\u8BDD") : null
    ),
    (0, import_react4.createElement)("div", { style: styles3.body }, (0, import_react4.createElement)(QuickPanel, { page: true }))
  );
}
function formatClock(totalSec) {
  const sec = Math.max(0, Math.floor(Number(totalSec) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// src/client/RecordIcon.jsx
var import_react5 = require("react");
function RecordIcon({ size = 18 } = {}) {
  const { running, seconds } = useRecordState();
  const box = typeof size === "number" ? size : 18;
  const color = running ? theme.success : theme.textMuted;
  const glyph = (0, import_react5.createElement)(
    "svg",
    {
      width: box,
      height: box,
      viewBox: "0 0 16 16",
      "aria-hidden": "true",
      style: { display: "block", flex: "none" }
    },
    // 外圈：麦克风轮廓的极简版（模拟 "会记" 的圆点 + 环）
    (0, import_react5.createElement)("circle", { cx: 8, cy: 8, r: 6.4, fill: "none", stroke: color, strokeWidth: 1.4, opacity: running ? 0.75 : 0.55 }),
    (0, import_react5.createElement)("circle", { cx: 8, cy: 8, r: running ? 3.4 : 2.6, fill: color })
  );
  if (!running || box > 16) return glyph;
  return (0, import_react5.createElement)(
    "span",
    {
      style: { display: "inline-flex", alignItems: "center", gap: 4 }
    },
    glyph,
    (0, import_react5.createElement)("span", {
      style: {
        fontSize: 10,
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
        color: theme.success,
        whiteSpace: "nowrap"
      }
    }, formatDuration(seconds))
  );
}

// src/client/index.jsx
var name = "dsh-note-taker";
var inject = ["slots"];
var PANEL_ID = "meeting-panel";
function resolveClose(ctx) {
  let layout = null;
  try {
    layout = ctx.layout ?? null;
  } catch {
    return void 0;
  }
  if (typeof layout?.selectPanel !== "function") return void 0;
  return () => {
    try {
      layout.selectPanel(null);
    } catch {
    }
  };
}
function apply(ctx) {
  try {
    probeHost(ctx, { log: (message) => console.info(message) });
  } catch (error) {
    console.warn("[note-taker] \u5BBF\u4E3B\u80FD\u529B\u63A2\u6D4B\u5931\u8D25", error);
  }
  try {
    ctx.slots.inject("settings.section", () => ctx.slots.register(
      { name: "settings.section", id: "meeting-page", order: 120, label: "\u4F1A\u8BB0" },
      SettingsPage
    ));
  } catch (error) {
    console.warn("[note-taker] \u6CE8\u518C settings.section \u5931\u8D25", error);
  }
  try {
    ctx.slots.inject("main", () => ctx.slots.register(
      {
        name: "main",
        key: PANEL_ID,
        inject: () => ({ close: resolveClose(ctx) })
      },
      MeetingPanel
    ));
  } catch (error) {
    console.warn("[note-taker] \u6CE8\u518C main \u5931\u8D25", error);
  }
  try {
    ctx.slots.inject("sidebar.panellist", () => ctx.slots.register(
      { name: "sidebar.panellist", id: PANEL_ID, order: 30, label: "\u4F1A\u8BB0" },
      RecordIcon
    ));
  } catch (error) {
    console.warn("[note-taker] \u6CE8\u518C sidebar.panellist \u5931\u8D25", error);
  }
}
		return module.exports;
	}
});
