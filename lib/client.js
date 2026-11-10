// src/client/index.jsx
import React, { useState } from "react";
var inject = ["slots"];
function ProbeSection() {
  const [text, setText] = useState("");
  return React.createElement(
    "div",
    { style: { padding: "12px 2px", display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 } },
    React.createElement("h3", { style: { margin: 0, fontSize: 15 } }, "\u4F1A\u8BB0 \xB7 \u63A2\u9488"),
    React.createElement(
      "p",
      { style: { margin: 0, opacity: 0.7, fontSize: 13 } },
      "\u80FD\u770B\u5230\u8FD9\u6BB5\u6587\u5B57\u8BF4\u660E settings.section \u63D2\u69FD\u53EF\u7528\u3002"
    ),
    React.createElement("input", {
      value: text,
      onChange: (event) => setText(event.target.value),
      placeholder: "\u5728\u8FD9\u91CC\u6253\u5B57\uFF0C\u9A8C\u8BC1\u8F93\u5165\u6846\u6CA1\u88AB\u906E\u6321",
      style: { padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit" }
    }),
    React.createElement("button", {
      type: "button",
      onClick: () => setText(`${text} \u2713`),
      style: { alignSelf: "flex-start", padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", cursor: "pointer" }
    }, "\u70B9\u6211\u8FFD\u52A0 \u2713"),
    React.createElement("div", { style: { fontSize: 12, opacity: 0.6 } }, `\u5F53\u524D\u503C\uFF1A${text || "(\u7A7A)"}`)
  );
}
function ProbeButton() {
  const [count, setCount] = useState(0);
  return React.createElement("button", {
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
export {
  apply,
  inject
};
