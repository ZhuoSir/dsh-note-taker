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
var import_react = __toESM(require("react"), 1);
var name = "dsh-note-taker";
var inject = ["slots"];
function ProbeSection() {
  const [text, setText] = (0, import_react.useState)("");
  return import_react.default.createElement(
    "div",
    { style: { padding: "12px 2px", display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 } },
    import_react.default.createElement("h3", { style: { margin: 0, fontSize: 15 } }, "\u4F1A\u8BB0 \xB7 \u63A2\u9488"),
    import_react.default.createElement(
      "p",
      { style: { margin: 0, opacity: 0.7, fontSize: 13 } },
      "\u80FD\u770B\u5230\u8FD9\u6BB5\u6587\u5B57\u8BF4\u660E settings.section \u63D2\u69FD\u53EF\u7528\u3002"
    ),
    import_react.default.createElement("input", {
      value: text,
      onChange: (event) => setText(event.target.value),
      placeholder: "\u5728\u8FD9\u91CC\u6253\u5B57\uFF0C\u9A8C\u8BC1\u8F93\u5165\u6846\u6CA1\u88AB\u906E\u6321",
      style: { padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit" }
    }),
    import_react.default.createElement("button", {
      type: "button",
      onClick: () => setText(`${text} \u2713`),
      style: { alignSelf: "flex-start", padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", cursor: "pointer" }
    }, "\u70B9\u6211\u8FFD\u52A0 \u2713"),
    import_react.default.createElement("div", { style: { fontSize: 12, opacity: 0.6 } }, `\u5F53\u524D\u503C\uFF1A${text || "(\u7A7A)"}`)
  );
}
function ProbeButton() {
  const [count, setCount] = (0, import_react.useState)(0);
  return import_react.default.createElement("button", {
    type: "button",
    onClick: () => setCount(count + 1),
    title: "\u4F1A\u8BB0\u63A2\u9488\u6309\u94AE",
    style: { padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 12 }
  }, count === 0 ? "\u4F1A\u8BB0" : `\u4F1A\u8BB0 ${count}`);
}
function apply(ctx) {
  try {
    ctx.slots.inject("settings.section", () => ctx.slots.register(
      { name: "settings.section", id: "meeting-page", order: 120, label: "\u4F1A\u8BB0" },
      ProbeSection
    ));
  } catch (error) {
    console.warn("[note-taker] \u6CE8\u518C settings.section \u5931\u8D25", error);
  }
  try {
    ctx.slots.inject("conversation.input.right", function* () {
      yield ctx.slots.register(
        { name: "conversation.input.right", id: "meeting-quick", order: 60 },
        ProbeButton
      );
    });
  } catch (error) {
    console.warn("[note-taker] \u6CE8\u518C conversation.input.right \u5931\u8D25", error);
  }
}
		return module.exports;
	}
});
