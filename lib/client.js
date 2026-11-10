window.__ModuleLoader__.load({
	id: "dsh-note-taker",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/MeetingPage.jsx
var import_react = __toESM(require("react"), 1);

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
function toDetailView(payload) {
  const meeting = payload?.meeting ?? null;
  if (!meeting) return null;
  return {
    id: meeting.id,
    label: meeting.label || "(\u672A\u547D\u540D)",
    startedText: formatDateTime(meeting.startedAt),
    durationText: formatDuration(meeting.durationSec),
    engineText: ENGINE_TEXT[meeting.engine ?? "local"] ?? "\u672C\u5730",
    audioPath: meeting?.audio?.path ?? null,
    record: statusMeta(meeting, "record"),
    transcribe: statusMeta(meeting, "transcribe"),
    minutes: statusMeta(meeting, "minutes"),
    stats: meeting?.stats ?? null,
    hasTranscript: Boolean(payload?.transcript),
    hasMinutes: Boolean(payload?.minutes),
    transcriptText: payload?.transcript ?? "",
    minutesText: payload?.minutes ?? ""
  };
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

// src/client/MeetingPage.jsx
var POLL_MS = 2e3;
var POLL_MAX_MS = 30 * 60 * 1e3;
var styles = {
  wrap: { display: "flex", flexDirection: "column", gap: 12, padding: "4px 2px", maxWidth: 980 },
  bar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  card: { border: "1px solid rgba(127,127,127,0.25)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid rgba(127,127,127,0.25)", fontWeight: 600, opacity: 0.75 },
  td: { padding: "6px 8px", borderBottom: "1px solid rgba(127,127,127,0.12)", verticalAlign: "top" },
  btn: { padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 13 },
  btnPrimary: { padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(90,150,255,0.6)", background: "rgba(90,150,255,0.12)", color: "inherit", cursor: "pointer", fontSize: 13 },
  btnDisabled: { opacity: 0.45, cursor: "not-allowed" },
  input: { padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", fontSize: 13, minWidth: 220 },
  muted: { fontSize: 12, opacity: 0.65 },
  error: { fontSize: 12, color: "#e5484d" },
  ok: { fontSize: 12, color: "#30a46c" },
  pre: { margin: 0, maxHeight: 320, overflow: "auto", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "ui-monospace, Consolas, monospace" },
  detail: { display: "grid", gridTemplateColumns: "160px 1fr", gap: "4px 12px", fontSize: 13 },
  badge: (tone) => ({
    display: "inline-block",
    padding: "1px 8px",
    borderRadius: 999,
    fontSize: 11,
    border: "1px solid rgba(127,127,127,0.3)",
    color: tone === "error" ? "#e5484d" : tone === "ok" ? "#30a46c" : tone === "active" ? "#5a96ff" : "inherit",
    borderColor: tone === "error" ? "rgba(229,72,77,0.5)" : tone === "ok" ? "rgba(48,164,108,0.5)" : tone === "active" ? "rgba(90,150,255,0.5)" : "rgba(127,127,127,0.3)"
  })
};
function StatusBadge({ meta }) {
  return import_react.default.createElement("span", { style: styles.badge(meta.tone), title: meta.reason ?? "" }, meta.text);
}
function MeetingPage() {
  const [rows, setRows] = (0, import_react.useState)([]);
  const [health, setHealth] = (0, import_react.useState)(null);
  const [selectedId, setSelectedId] = (0, import_react.useState)(null);
  const [detail, setDetail] = (0, import_react.useState)(null);
  const [showAll, setShowAll] = (0, import_react.useState)(false);
  const [busy, setBusy] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(null);
  const [notice, setNotice] = (0, import_react.useState)(null);
  const [recordSeconds, setRecordSeconds] = (0, import_react.useState)(0);
  const [importPath, setImportPath] = (0, import_react.useState)("");
  const consentRef = (0, import_react.useRef)(false);
  const api = (0, import_react.useMemo)(() => createApi({
    // 云端动作前的二次确认（R-07）：确认一次后本页不再重复问
    confirmCloud: (text) => {
      if (consentRef.current) return true;
      const ok = typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(text) : false;
      if (ok) consentRef.current = true;
      return ok;
    }
  }), []);
  const caps = (0, import_react.useMemo)(() => capabilitiesFrom(health), [health]);
  const refresh = (0, import_react.useCallback)(async () => {
    const [listResult, healthResult] = await Promise.all([api.list({ limit: 50 }), api.health()]);
    if (listResult.ok === false) {
      setError(errorText(listResult.code, listResult.detail));
      return;
    }
    setError(null);
    setRows(listResult.meetings ?? []);
    if (healthResult.ok !== false) setHealth(healthResult);
    else setHealth(null);
  }, [api]);
  const loadDetail = (0, import_react.useCallback)(async (id) => {
    if (!id) {
      setDetail(null);
      return;
    }
    const result = await api.detail({ id });
    if (result.ok === false) {
      setError(errorText(result.code, result.detail));
      setDetail(null);
      return;
    }
    setDetail(toDetailView(result));
  }, [api]);
  (0, import_react.useEffect)(() => {
    refresh();
  }, [refresh]);
  (0, import_react.useEffect)(() => {
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);
  const pollStart = (0, import_react.useRef)(Date.now());
  (0, import_react.useEffect)(() => {
    const running = rows.some((row) => row.transcribe.status === "running" || row.minutes.status === "running" || row.record.status === "running");
    if (!running && !selectedId) return void 0;
    const timer = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (Date.now() - pollStart.current > POLL_MAX_MS) return;
      await refresh();
      if (selectedId) await loadDetail(selectedId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [rows, selectedId, refresh, loadDetail]);
  (0, import_react.useEffect)(() => {
    const recording = rows.find((row) => row.record.status === "running");
    if (!recording) {
      setRecordSeconds(0);
      return void 0;
    }
    const timer = setInterval(() => setRecordSeconds((value) => value + 1), 1e3);
    return () => clearInterval(timer);
  }, [rows]);
  const runAction = (0, import_react.useCallback)(async (name2, fn) => {
    setBusy(name2);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if (result?.ok === false) {
        setError(errorText(result.code, result.detail));
        if (result.message) setNotice(result.message);
      } else if (result?.accepted) {
        setNotice("\u5DF2\u63D0\u4EA4\uFF0C\u6B63\u5728\u540E\u53F0\u5904\u7406\u2026");
      } else if (result?.meetingId) {
        setNotice(`\u5B8C\u6210\uFF1A${result.meetingId}`);
      }
      await refresh();
      if (selectedId) await loadDetail(selectedId);
    } catch (thrown) {
      setError(String(thrown?.message ?? thrown));
    } finally {
      setBusy(null);
    }
  }, [refresh, loadDetail, selectedId]);
  const recordingRow = rows.find((row) => row.record.status === "running");
  return import_react.default.createElement(
    "div",
    { style: styles.wrap },
    import_react.default.createElement(
      "div",
      { style: styles.bar },
      import_react.default.createElement("strong", { style: { fontSize: 15 } }, "\u4F1A\u8BB0"),
      import_react.default.createElement("button", { type: "button", style: styles.btn, onClick: refresh }, "\u5237\u65B0"),
      import_react.default.createElement(
        "span",
        { style: styles.muted },
        caps.cloudReady ? `\u4E91\u7AEF\u53EF\u7528${caps.cloudModel ? `\uFF08${caps.cloudModel}\uFF09` : ""}` : "\u4E91\u7AEF\u672A\u914D\u7F6E\uFF08\u9700 DASHSCOPE_API_KEY\uFF09"
      ),
      import_react.default.createElement(
        "span",
        { style: styles.muted },
        caps.localModels.length > 0 ? `\u672C\u5730\u6A21\u578B\uFF1A${caps.localModels.join("/")}` : "\u672C\u5730\u6A21\u578B\u672A\u4E0B\u8F7D"
      )
    ),
    error ? import_react.default.createElement("div", { style: styles.error }, error) : null,
    notice ? import_react.default.createElement("div", { style: styles.muted }, notice) : null,
    import_react.default.createElement(
      "div",
      { style: styles.card },
      import_react.default.createElement(
        "div",
        { style: styles.bar },
        recordingRow ? import_react.default.createElement("button", {
          type: "button",
          style: styles.btn,
          disabled: busy === "stop",
          onClick: () => runAction("stop", () => api.record({ action: "stop" }))
        }, `\u505C\u6B62\u5F55\u97F3 ${formatDuration(recordSeconds)}`) : import_react.default.createElement("button", {
          type: "button",
          style: styles.btnPrimary,
          disabled: busy === "start" || !caps.recordingReady,
          title: caps.recordingReady ? "" : "\u5F55\u97F3\u4F9D\u8D56\u4E0D\u53EF\u7528",
          onClick: () => runAction("start", () => api.record({ action: "start", label: "" }))
        }, "\u5F00\u59CB\u5F55\u97F3"),
        import_react.default.createElement("input", {
          style: styles.input,
          placeholder: "\u5BFC\u5165\u97F3\u9891\u7684\u672C\u5730\u8DEF\u5F84\uFF0C\u5982 D:\\\u4F1A\u8BAE\\a.m4a",
          value: importPath,
          onChange: (event) => setImportPath(event.target.value)
        }),
        import_react.default.createElement("button", {
          type: "button",
          style: importPath ? styles.btn : { ...styles.btn, ...styles.btnDisabled },
          disabled: !importPath || busy === "import",
          onClick: () => runAction("import", async () => {
            const result = await api.importAudio({ path: importPath });
            if (result?.ok !== false) setImportPath("");
            return result;
          })
        }, "\u5BFC\u5165")
      )
    ),
    import_react.default.createElement(
      "div",
      { style: styles.card },
      rows.length === 0 ? import_react.default.createElement("div", { style: styles.muted }, "\u8FD8\u6CA1\u6709\u4EFB\u4F55\u4F1A\u8BAE\u3002\u70B9\u4E0A\u9762\u300C\u5F00\u59CB\u5F55\u97F3\u300D\uFF0C\u6216\u586B\u8DEF\u5F84\u5BFC\u5165\u4E00\u6BB5\u97F3\u9891\u3002") : import_react.default.createElement(
        "table",
        { style: styles.table },
        import_react.default.createElement(
          "thead",
          null,
          import_react.default.createElement(
            "tr",
            null,
            import_react.default.createElement("th", { style: styles.th }, "\u65F6\u95F4"),
            import_react.default.createElement("th", { style: styles.th }, "\u6807\u7B7E"),
            import_react.default.createElement("th", { style: styles.th }, "\u65F6\u957F"),
            import_react.default.createElement("th", { style: styles.th }, "\u5F15\u64CE"),
            import_react.default.createElement("th", { style: styles.th }, "\u5F55\u97F3"),
            import_react.default.createElement("th", { style: styles.th }, "\u8F6C\u5199"),
            import_react.default.createElement("th", { style: styles.th }, "\u7EAA\u8981")
          )
        ),
        import_react.default.createElement(
          "tbody",
          null,
          toListRows(rows, { limit: 50 }).map((row) => import_react.default.createElement(
            "tr",
            {
              key: row.id,
              onClick: () => {
                setSelectedId(row.id === selectedId ? null : row.id);
                setShowAll(false);
              },
              style: { cursor: "pointer", background: row.id === selectedId ? "rgba(90,150,255,0.08)" : "transparent" }
            },
            import_react.default.createElement("td", { style: styles.td }, row.startedText),
            import_react.default.createElement("td", { style: styles.td }, row.label),
            import_react.default.createElement("td", { style: styles.td }, row.durationText),
            import_react.default.createElement("td", { style: styles.td }, row.engineText),
            import_react.default.createElement("td", { style: styles.td }, import_react.default.createElement(StatusBadge, { meta: row.record })),
            import_react.default.createElement("td", { style: styles.td }, import_react.default.createElement(StatusBadge, { meta: row.transcribe })),
            import_react.default.createElement("td", { style: styles.td }, import_react.default.createElement(StatusBadge, { meta: row.minutes }))
          ))
        )
      )
    ),
    detail ? import_react.default.createElement(
      "div",
      { style: styles.card },
      import_react.default.createElement(
        "div",
        { style: styles.bar },
        import_react.default.createElement("strong", null, detail.label),
        import_react.default.createElement("span", { style: styles.muted }, `${detail.startedText} \xB7 ${detail.durationText} \xB7 ${detail.engineText}`),
        import_react.default.createElement("button", {
          type: "button",
          style: caps.localModels.length > 0 ? styles.btn : { ...styles.btn, ...styles.btnDisabled },
          disabled: busy === "local" || caps.localModels.length === 0,
          onClick: () => runAction("local", () => api.transcribe({ id: detail.id, engine: "local" }))
        }, "\u672C\u5730\u8F6C\u5199"),
        import_react.default.createElement("button", {
          type: "button",
          style: caps.cloudReady ? styles.btn : { ...styles.btn, ...styles.btnDisabled },
          disabled: busy === "cloud" || !caps.cloudReady,
          title: caps.cloudReady ? "" : "\u672A\u914D\u7F6E DASHSCOPE_API_KEY",
          onClick: () => runAction("cloud", () => api.transcribe({ id: detail.id, engine: "cloud" }))
        }, "\u4E91\u7AEF\u8F6C\u5199"),
        import_react.default.createElement("button", {
          type: "button",
          style: styles.btn,
          disabled: busy === "minutes" || detail.transcribe.status !== "done",
          onClick: () => runAction("minutes", () => api.minutes({ id: detail.id, force: false }))
        }, "\u751F\u6210\u7EAA\u8981"),
        import_react.default.createElement("button", {
          type: "button",
          style: styles.btn,
          disabled: busy === "minutes2",
          onClick: () => runAction("minutes2", () => api.minutes({ id: detail.id, force: true }))
        }, "\u91CD\u65B0\u751F\u6210")
      ),
      import_react.default.createElement(
        "div",
        { style: styles.detail },
        import_react.default.createElement("span", { style: styles.muted }, "\u97F3\u9891"),
        import_react.default.createElement("span", null, detail.audioPath ?? "\u2014"),
        import_react.default.createElement("span", { style: styles.muted }, "\u7EDF\u8BA1"),
        import_react.default.createElement("span", null, detail.stats ? `${detail.stats.segments ?? "?"} \u6BB5 / ${detail.stats.chars ?? "?"} \u5B57` : "\u2014")
      ),
      import_react.default.createElement(
        "div",
        null,
        import_react.default.createElement("div", { style: styles.muted }, detail.hasTranscript ? "\u8F6C\u5199" : "\u8F6C\u5199\uFF08\u5C1A\u672A\u751F\u6210\uFF09"),
        detail.hasTranscript ? import_react.default.createElement(
          "div",
          null,
          import_react.default.createElement(
            "pre",
            { style: styles.pre },
            paginateTranscript(detail.transcriptText, { showAll }).lines.join("\n")
          ),
          paginateTranscript(detail.transcriptText, { showAll }).truncated ? import_react.default.createElement("button", {
            type: "button",
            style: styles.btn,
            onClick: () => setShowAll(true)
          }, `\u5C55\u5F00\u5269\u4F59 ${paginateTranscript(detail.transcriptText, { showAll }).remaining} \u884C`) : null
        ) : null
      ),
      import_react.default.createElement(
        "div",
        null,
        import_react.default.createElement("div", { style: styles.muted }, detail.hasMinutes ? "\u7EAA\u8981" : "\u7EAA\u8981\uFF08\u5C1A\u672A\u751F\u6210\uFF09"),
        detail.hasMinutes ? import_react.default.createElement("pre", { style: styles.pre }, detail.minutesText) : null
      )
    ) : null
  );
}

// src/client/QuickPanel.jsx
var import_react2 = __toESM(require("react"), 1);
var POLL_MS2 = 2e3;
var styles2 = {
  root: { position: "relative", display: "inline-block" },
  trigger: (active) => ({
    padding: "4px 10px",
    borderRadius: 8,
    fontSize: 12,
    cursor: "pointer",
    border: `1px solid ${active ? "rgba(90,150,255,0.6)" : "rgba(127,127,127,0.35)"}`,
    background: active ? "rgba(90,150,255,0.12)" : "transparent",
    color: "inherit"
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
    border: "1px solid rgba(127,127,127,0.3)",
    fontSize: 12,
    background: "var(--dsh-elevated-surface, rgba(24,24,26,0.98))",
    boxShadow: "0 8px 24px rgba(0,0,0,0.28)"
  },
  row: { display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" },
  btn: { padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 12 },
  muted: { opacity: 0.65 },
  error: { color: "#e5484d" }
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
    }, POLL_MS2);
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
  const recording = rows.find((row) => row.record.status === "running");
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
  return import_react2.default.createElement(
    "div",
    { ref: rootRef, style: styles2.root },
    import_react2.default.createElement("button", {
      type: "button",
      style: styles2.trigger(open),
      title: "\u4F1A\u8BB0",
      onClick: () => setOpen((value) => !value)
    }, recording ? `\u25CF ${formatDuration(seconds)}` : "\u4F1A\u8BB0"),
    open ? import_react2.default.createElement(
      "div",
      { style: styles2.panel },
      import_react2.default.createElement(
        "div",
        { style: styles2.row },
        import_react2.default.createElement("strong", null, "\u4F1A\u8BB0"),
        import_react2.default.createElement("span", { style: styles2.muted }, caps.cloudReady ? "\u4E91\u7AEF\u53EF\u7528" : "\u4E91\u7AEF\u672A\u914D\u7F6E")
      ),
      error ? import_react2.default.createElement("div", { style: styles2.error }, error) : null,
      import_react2.default.createElement(
        "div",
        { style: styles2.row },
        recording ? import_react2.default.createElement(
          "button",
          { type: "button", style: styles2.btn, onClick: () => act(() => api.record({ action: "stop" })) },
          `\u505C\u6B62\u5F55\u97F3 ${formatDuration(seconds)}`
        ) : import_react2.default.createElement("button", {
          type: "button",
          style: styles2.btn,
          disabled: !caps.recordingReady,
          title: caps.recordingReady ? "" : "\u5F55\u97F3\u4F9D\u8D56\u4E0D\u53EF\u7528",
          onClick: () => act(() => api.record({ action: "start" }))
        }, "\u5F00\u59CB\u5F55\u97F3"),
        import_react2.default.createElement("button", { type: "button", style: styles2.btn, onClick: refresh }, "\u5237\u65B0")
      ),
      import_react2.default.createElement("div", { style: styles2.muted }, "\u6700\u8FD1 3 \u573A"),
      rows.length === 0 ? import_react2.default.createElement("div", { style: styles2.muted }, "\u8FD8\u6CA1\u6709\u4F1A\u8BAE") : toListRows(rows, { limit: 3 }).map((row) => import_react2.default.createElement(
        "div",
        { key: row.id, style: { ...styles2.row, alignItems: "flex-start" } },
        import_react2.default.createElement("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, row.label),
        import_react2.default.createElement("span", { style: styles2.muted }, `${row.transcribe.text} \xB7 ${row.durationText}`)
      )),
      import_react2.default.createElement("div", { style: styles2.muted }, "\u5168\u90E8\u4F1A\u8BAE\u5728 \u8BBE\u7F6E \u2192 \u4F1A\u8BB0")
    ) : null
  );
}

// src/client/index.jsx
var name = "dsh-note-taker";
var inject = ["slots"];
function apply(ctx) {
  try {
    ctx.slots.inject("settings.section", () => ctx.slots.register(
      { name: "settings.section", id: "meeting-page", order: 120, label: "\u4F1A\u8BB0" },
      MeetingPage
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
