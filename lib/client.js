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
    label: meeting.label || "(\u672A\u547D\u540D)",
    startedAt: meeting.startedAt,
    startedText: formatDateTime(meeting.startedAt),
    durationText: formatDuration(meeting.durationSec),
    engineText: ENGINE_TEXT[meeting.engine ?? "local"] ?? meeting.engine ?? "\u672C\u5730",
    record: statusMeta(meeting, "record"),
    transcribe: statusMeta(meeting, "transcribe"),
    minutes: statusMeta(meeting, "minutes"),
    segments: meeting?.stats?.segments ?? null,
    chars: meeting?.stats?.chars ?? null
  }));
  return rows;
}
function errorText(code, detail = {}) {
  switch (code) {
    case "E_DEP":
      return detail?.env ? `\u7F3A\u5C11\u914D\u7F6E\uFF1A${detail.env}\uFF0C\u8BBE\u7F6E\u540E\u91CD\u8BD5` : "\u7F3A\u5C11\u5FC5\u8981\u7684\u4F9D\u8D56\u6216\u914D\u7F6E\uFF0C\u8BF7\u68C0\u67E5\u63D2\u4EF6\u8BBE\u7F6E";
    case "E_LLM":
      return "\u4E91\u7AEF\u8BC6\u522B\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\uFF08\u82E5\u6301\u7EED\u5931\u8D25\u8BF7\u68C0\u67E5\u4F59\u989D\u4E0E\u7F51\u7EDC\uFF09";
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
    localModels: health?.local?.models ?? []
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
  const inflight = /* @__PURE__ */ new Set();
  async function request(path, { method = "GET", query, body } = {}) {
    if (typeof fetchImpl !== "function") return toErrorEnvelope("E_DEP", "\u5F53\u524D\u73AF\u5883\u6CA1\u6709 fetch");
    const controller = new AbortController();
    inflight.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
          { ...parsed?.detail ?? {}, httpStatus: response.status }
        );
      }
      if (parsed === null) return toErrorEnvelope("E_LLM", "\u63A5\u53E3\u8FD4\u56DE\u7684\u4E0D\u662F JSON");
      return parsed;
    } catch (error) {
      const aborted = error?.name === "AbortError";
      return toErrorEnvelope("E_LLM", aborted ? `\u8BF7\u6C42\u8D85\u65F6\uFF08${timeoutMs}ms\uFF09` : `\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25\uFF1A${error?.message ?? error}`);
    } finally {
      clearTimeout(timer);
      inflight.delete(controller);
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
    list: ({ limit } = {}) => request("/list", { query: { limit } }),
    detail: ({ id }) => request("/detail", { query: { id } }),
    health: () => request("/health"),
    getConfig: () => request("/config"),
    saveConfig: (patch) => request("/config", { method: "POST", body: patch }),
    transcribe: ({ id, engine } = {}) => longAction("/transcribe", { id, engine }, { engine }),
    minutes: ({ id, force } = {}) => request("/minutes", { method: "POST", body: { id, force } }),
    record: ({ action, label } = {}) => request("/record", { method: "POST", body: { action, label } }),
    importAudio: ({ path, label } = {}) => request("/import", { method: "POST", body: { path, label } }),
    cancelAll() {
      for (const controller of inflight) controller.abort();
      inflight.clear();
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
  wrap: { display: "flex", flexDirection: "column", gap: 14, padding: "4px 2px", maxWidth: 860, color: theme.text, fontFamily: theme.font },
  card: { border: `1px solid ${theme.border}`, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 12, background: theme.bg, color: theme.text },
  row: { display: "grid", gridTemplateColumns: "150px 1fr", gap: "8px 12px", alignItems: "center", fontSize: 13 },
  label: { color: theme.textSecondary, fontSize: 12 },
  input: { padding: "6px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, background: "transparent", color: theme.text, fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box" },
  select: { padding: "6px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, background: "transparent", color: theme.text, fontSize: 13, fontFamily: "inherit" },
  hint: { fontSize: 11, color: theme.textMuted, gridColumn: "2 / 3" },
  fieldError: { fontSize: 11, color: theme.danger, gridColumn: "2 / 3" },
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
  const api = (0, import_react.useMemo)(() => createApi({}), []);
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
    const result = await api.getConfig();
    if (result.ok === false) {
      setError(errorText(result.code, result.detail));
      return;
    }
    setForm(result.config);
    setSources(result.sources ?? {});
    setError(null);
  }, [api]);
  const loadMinutes = (0, import_react.useCallback)(async () => {
    const result = await api.list({ limit: 50 });
    if (result.ok === false) {
      setError(errorText(result.code, result.detail));
      return;
    }
    setMeetings(result.meetings ?? []);
  }, [api]);
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
    if (form.dataRoot) patch.dataRoot = form.dataRoot;
    const result = await api.saveConfig(patch);
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
    const health = await api.health();
    if (health.ok !== false) {
      setNotice((prev) => `${prev} \uFF5C \u5F53\u524D\u751F\u6548\uFF1A\u4E91\u7AEF${health.cloud?.configured ? "\u5DF2\u914D\u7F6E" : "\u672A\u914D\u7F6E"}\uFF0F${health.cloud?.model ?? "\u2014"}`);
    }
  }, [api, form, loadConfig]);
  const openMinutes = (0, import_react.useCallback)(async (id) => {
    if (openedId === id) {
      setOpenedId(null);
      setMinutesText(null);
      return;
    }
    const result = await api.detail({ id });
    if (result.ok === false) {
      setError(errorText(result.code, result.detail));
      return;
    }
    setOpenedId(id);
    setMinutesText(result.minutes ?? "");
    setShowAll(false);
  }, [api, openedId]);
  const minutesRows = (0, import_react.useMemo)(
    () => toListRows(meetings, { limit: 50 }).filter((row) => row.minutes.status === "done"),
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
            style: styles.input,
            value: form.cloud.apiKey ?? "",
            placeholder: "sk-\u2026",
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
            hint: "\u5F55\u97F3\u3001\u8F6C\u5199\u3001\u7EAA\u8981\u90FD\u5B58\u8FD9\u91CC\uFF1B**\u4FEE\u6539\u540E\u9700\u91CD\u542F\u5BBF\u4E3B\u751F\u6548**",
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

// src/client/QuickPanel.jsx
var import_react2 = require("react");

// src/client/host.js
var state = {
  /** 'unknown' | 'available' | 'unavailable' */
  conversation: "unknown",
  /** 拿到的服务实例（available 时非空） */
  instance: null,
  /** 拿到的途径：direct / inject / none */
  via: "none",
  /** 不可用时的原因（给用户看的一句话） */
  reason: "\u5C1A\u672A\u63A2\u6D4B",
  /** 探测时间，便于判断是否过期 */
  probedAt: null
};
function getHostStatus() {
  return { ...state };
}
function markAvailable(instance, via) {
  state.conversation = "available";
  state.instance = instance;
  state.via = via;
  state.reason = "";
  state.probedAt = (/* @__PURE__ */ new Date()).toISOString();
}
function markUnavailable(reason, via = "none") {
  state.conversation = "unavailable";
  state.instance = null;
  state.via = via;
  state.reason = reason;
  state.probedAt = (/* @__PURE__ */ new Date()).toISOString();
}
function probeHost(ctx, { log } = {}) {
  const say = log ?? (() => {
  });
  try {
    const direct = (typeof ctx?.get === "function" ? ctx.get("conversation") : void 0) ?? ctx?.conversation;
    if (direct && typeof direct.send === "function") {
      markAvailable(direct, "direct");
      say("[note-taker] \u4EA4\u63A5\u80FD\u529B\uFF1A\u81EA\u52A8\u53D1\u9001\u53EF\u7528\uFF08direct\uFF09");
      return getHostStatus();
    }
    markUnavailable("conversation \u670D\u52A1\u5B58\u5728\u4F46\u6CA1\u6709 send \u65B9\u6CD5", "direct");
  } catch (error) {
    markUnavailable(`\u76F4\u63A5\u53D6\u5931\u8D25\uFF1A${String(error?.message ?? error).slice(0, 80)}`, "direct");
  }
  try {
    if (typeof ctx?.inject === "function") {
      ctx.inject(["conversation"], (inner) => {
        const instance = inner?.conversation ?? inner?.get?.("conversation");
        if (instance && typeof instance.send === "function") {
          markAvailable(instance, "inject");
          say("[note-taker] \u4EA4\u63A5\u80FD\u529B\uFF1A\u81EA\u52A8\u53D1\u9001\u53EF\u7528\uFF08inject\uFF09");
        } else {
          markUnavailable("\u6CE8\u5165\u6210\u529F\u4F46\u6CA1\u6709 send \u65B9\u6CD5", "inject");
          say("[note-taker] \u4EA4\u63A5\u80FD\u529B\uFF1A\u6CE8\u5165\u540E\u4ECD\u65E0 send\uFF0C\u8D70\u515C\u5E95");
        }
      });
    } else {
      markUnavailable("\u5BBF\u4E3B\u4E0A\u4E0B\u6587\u6CA1\u6709 inject\uFF0C\u65E0\u6CD5\u53D6\u5F97 conversation", "none");
    }
  } catch (error) {
    markUnavailable(`\u6CE8\u5165\u5931\u8D25\uFF1A${String(error?.message ?? error).slice(0, 80)}`, "inject");
    say(`[note-taker] \u4EA4\u63A5\u80FD\u529B\u63A2\u6D4B\u5931\u8D25\uFF1A${String(error?.message ?? error).slice(0, 80)}`);
  }
  return getHostStatus();
}
function hostStatusText(status = getHostStatus()) {
  if (status.conversation === "available") return `\u4F1A\u8BDD\u53D1\u9001\uFF1A\u53EF\u7528\uFF08${status.via}\uFF09`;
  if (status.conversation === "unavailable") return `\u4F1A\u8BDD\u53D1\u9001\uFF1A\u4E0D\u53EF\u7528\uFF08${status.reason}\uFF09`;
  return "\u4F1A\u8BDD\u53D1\u9001\uFF1A\u5C1A\u672A\u63A2\u6D4B";
}

// src/client/QuickPanel.jsx
var POLL_MS = 2e3;
var styles2 = {
  root: { position: "relative", display: "inline-block" },
  trigger: (active) => ({
    padding: "4px 10px",
    borderRadius: 8,
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    border: `1px solid ${active ? theme.accentBorder : theme.border}`,
    background: active ? theme.accentBg : "transparent",
    color: theme.text
  }),
  panel: {
    position: "absolute",
    bottom: "calc(100% + 8px)",
    right: 0,
    zIndex: 40,
    width: 320,
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
  btn: { padding: "4px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, background: "transparent", color: theme.text, cursor: "pointer", fontSize: 12, fontFamily: "inherit" },
  muted: { color: theme.textMuted },
  error: { color: theme.danger }
};
function QuickPanel() {
  const [open, setOpen] = (0, import_react2.useState)(false);
  const [rows, setRows] = (0, import_react2.useState)([]);
  const [health, setHealth] = (0, import_react2.useState)(null);
  const [error, setError] = (0, import_react2.useState)(null);
  const [seconds, setSeconds] = (0, import_react2.useState)(0);
  const rootRef = (0, import_react2.useRef)(null);
  const api = (0, import_react2.useMemo)(() => createApi({
    confirmCloud: (text) => typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(text) : false
  }), []);
  const caps = (0, import_react2.useMemo)(() => capabilitiesFrom(health), [health]);
  const listRows = (0, import_react2.useMemo)(() => toListRows(rows, { limit: 3 }), [rows]);
  const refresh = (0, import_react2.useCallback)(async () => {
    const [listResult, healthResult] = await Promise.all([api.list({ limit: 3 }), api.health()]);
    if (listResult.ok === false) {
      setError(errorText(listResult.code, listResult.detail));
      return;
    }
    setError(null);
    setRows(listResult.meetings ?? []);
    setHealth(healthResult.ok === false ? null : healthResult);
  }, [api]);
  (0, import_react2.useEffect)(() => {
    if (!open) return void 0;
    refresh();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [open, refresh]);
  (0, import_react2.useEffect)(() => {
    if (!open) return void 0;
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    if (typeof document !== "undefined") document.addEventListener("mousedown", onDown);
    return () => {
      if (typeof document !== "undefined") document.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  const recording = listRows.find((row) => row.record.status === "running");
  (0, import_react2.useEffect)(() => {
    if (!recording) {
      setSeconds(0);
      return void 0;
    }
    const timer = setInterval(() => setSeconds((value) => value + 1), 1e3);
    return () => clearInterval(timer);
  }, [recording]);
  const act = (0, import_react2.useCallback)(async (fn) => {
    const result = await fn();
    if (result?.ok === false) setError(errorText(result.code, result.detail));
    else setError(null);
    await refresh();
  }, [refresh]);
  return (0, import_react2.createElement)(
    "div",
    { ref: rootRef, style: styles2.root },
    (0, import_react2.createElement)("button", {
      type: "button",
      style: styles2.trigger(open),
      title: "\u4F1A\u8BB0",
      onClick: () => setOpen((value) => !value)
    }, recording ? `\u25CF ${formatDuration(seconds)}` : "\u4F1A\u8BB0"),
    open ? (0, import_react2.createElement)(
      "div",
      { style: styles2.panel },
      (0, import_react2.createElement)(
        "div",
        { style: styles2.row },
        (0, import_react2.createElement)("strong", null, "\u4F1A\u8BB0"),
        (0, import_react2.createElement)("span", { style: styles2.muted }, caps.cloudReady ? "\u4E91\u7AEF\u53EF\u7528" : "\u4E91\u7AEF\u672A\u914D\u7F6E")
      ),
      error ? (0, import_react2.createElement)("div", { style: styles2.error }, error) : null,
      (0, import_react2.createElement)(
        "div",
        { style: styles2.row },
        recording ? (0, import_react2.createElement)(
          "button",
          { type: "button", style: styles2.btn, onClick: () => act(() => api.record({ action: "stop" })) },
          `\u505C\u6B62\u5F55\u97F3 ${formatDuration(seconds)}`
        ) : (0, import_react2.createElement)("button", {
          type: "button",
          style: styles2.btn,
          disabled: !caps.recordingReady,
          title: caps.recordingReady ? "" : "\u5F55\u97F3\u4F9D\u8D56\u4E0D\u53EF\u7528",
          onClick: () => act(() => api.record({ action: "start" }))
        }, "\u5F00\u59CB\u5F55\u97F3"),
        (0, import_react2.createElement)("button", { type: "button", style: styles2.btn, onClick: refresh }, "\u5237\u65B0")
      ),
      (0, import_react2.createElement)("div", { style: styles2.muted }, "\u6700\u8FD1 3 \u573A"),
      rows.length === 0 ? (0, import_react2.createElement)("div", { style: styles2.muted }, "\u8FD8\u6CA1\u6709\u4F1A\u8BAE") : listRows.map((row) => (0, import_react2.createElement)(
        "div",
        { key: row.id, style: { ...styles2.row, alignItems: "flex-start" } },
        (0, import_react2.createElement)("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, row.label),
        (0, import_react2.createElement)("span", { style: styles2.muted }, `${row.transcribe.text} \xB7 ${row.durationText}`)
      )),
      (0, import_react2.createElement)("div", { style: styles2.muted }, "\u5168\u90E8\u4F1A\u8BAE\u5728 \u8BBE\u7F6E \u2192 \u4F1A\u8BB0"),
      (0, import_react2.createElement)("div", { style: { ...styles2.muted, fontSize: 11 } }, hostStatusText())
    ) : null
  );
}

// src/client/index.jsx
var name = "dsh-note-taker";
var inject = ["slots"];
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
    ctx.slots.inject("conversation.input.right", function* () {
      yield ctx.slots.register(
        { name: "conversation.input.right", id: "meeting-quick", order: 60 },
        QuickPanel
      );
    });
  } catch (error) {
    console.warn("[note-taker] \u6CE8\u518C conversation.input.right \u5931\u8D25", error);
  }
}
		return module.exports;
	}
});
