const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const ReactDOM = require("react-dom");
const ReactDOMClient = require("react-dom/client");
const { act } = require("react-dom/test-utils");
const { JSDOM } = require("jsdom");

const modPath = path.resolve("build/mobile-ui-migration/mod.js");
const source = fs.readFileSync(modPath, "utf8");

const dom = new JSDOM(
  '<!doctype html><html><head></head><body>' +
    '<div id="root">' +
      '<div id="m36-ui-migration-patron-dialogue-portal"></div>' +
      '<div id="m36-ui-migration-patron-choices-portal"></div>' +
      '<div id="mount"></div>' +
    '</div>' +
  '</body></html>',
  { url: "https://wayward.test/" }
);

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.MutationObserver = dom.window.MutationObserver;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({
  matches: true,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {}
});
window.PointerEvent = function PointerEvent() {};
window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);

let definition;
global.WML = { define(value) { definition = value; } };
require(modPath);
assert.ok(definition && typeof definition.setup === "function", "WML module registers");

const hooks = new Map();
const api = {
  game: "2026-11-01",
  host: { platform: "mobile" },
  fn(name) {
    if (name === "React") return React;
    if (name === "ReactDOM") return ReactDOM;
    throw new Error("Unexpected WML symbol: " + name);
  },
  has() { return true; },
  hook(name, handlers) {
    hooks.set(name, handlers);
    return () => {};
  }
};
const pluginApi = definition.setup(api);
const hook = hooks.get("patronInteractionCard");
assert.ok(hook && typeof hook.around === "function", "interaction-card hook installed");

const dispatched = [];
const button = (label) => React.createElement(
  "button",
  { onClick: () => dispatched.push(label) },
  label
);

const result = React.createElement(
  "div",
  { className: "bg-stone-800/80 border-l-2 border-violet-600 text-sm overflow-hidden" },
  React.createElement(
    "div",
    { className: "px-3 py-2" },
    React.createElement(
      "div",
      { className: "flex items-baseline justify-between gap-2" },
      "고객 · 아내"
    ),
    React.createElement(
      "div",
      { className: "text-[0.7rem] text-violet-300/80 mt-0.5" },
      "다른 손님 한 명이 합류했습니다."
    ),
    React.createElement(
      "div",
      { className: "text-stone-300 text-xs mt-1.5 italic" },
      "그가 그녀에게 말을 건넵니다."
    ),
    React.createElement(
      "div",
      { className: "grid gap-1 mt-2" },
      button("계속 일하기 — 상황은 그대로 두기"),
      button("대화에 끼기"),
      button("그녀를 부르기")
    )
  )
);

const first = React.cloneElement(hook.around(() => result), { key: "hidden-desktop-focus" });
const second = React.cloneElement(hook.around(() => result), { key: "mobile-focus-tab" });
const mount = document.getElementById("mount");
const root = ReactDOMClient.createRoot(mount);

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 35));
  });
}

function assertSingleChoicePortal(stage) {
  const choicesTarget = document.getElementById("m36-ui-migration-patron-choices-portal");
  const dialogueTarget = document.getElementById("m36-ui-migration-patron-dialogue-portal");
  const choiceButtons = [...choicesTarget.querySelectorAll("button")];
  const labels = choiceButtons.map((node) => node.textContent.trim());

  assert.equal(choiceButtons.length, 3, stage + ": exactly three native choices");
  assert.equal(labels.filter((text) => text === "대화에 끼기").length, 1,
    stage + ": '대화에 끼기' appears once");
  assert.equal(labels.filter((text) => text.startsWith("계속 일하기")).length, 1,
    stage + ": wait choice appears once");
  assert.equal(labels.filter((text) => text === "그녀를 부르기").length, 1,
    stage + ": intervene choice appears once");
  assert.equal(dialogueTarget.querySelectorAll(".m36-ui-migration-patron-dialogue").length, 1,
    stage + ": pinned dialogue appears once");
  assert.equal(mount.querySelectorAll("button").length, 0,
    stage + ": neither responsive source card retains a duplicate button set");
}

(async () => {
  await act(async () => {
    root.render(React.createElement(React.Fragment, null, first, second));
  });
  await flush();
  assertSingleChoicePortal("two responsive copies mounted");

  const engageButton = [...document.querySelectorAll(
    "#m36-ui-migration-patron-choices-portal button"
  )].find((node) => node.textContent.trim() === "대화에 끼기");
  await act(async () => {
    engageButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(dispatched, ["대화에 끼기"],
    "original choice callback is preserved and invoked exactly once");

  // The mobile focus tab can mount/unmount while the CSS-hidden desktop
  // focus pane stays mounted. The owner must stay singular after that change.
  await act(async () => {
    root.render(React.createElement(React.Fragment, null, second));
  });
  await flush();
  assertSingleChoicePortal("desktop copy unmounted and mobile copy promoted");

  await act(async () => root.unmount());
  if (typeof pluginApi?.stop === "function") pluginApi.stop();
  dom.window.close();
  process.stdout.write("PASS: responsive duplicate interaction cards produce one dialogue portal and one choice set.\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
