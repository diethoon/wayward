const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const React = require("react");
const ReactDOM = require("react-dom");
const { createRoot } = require("react-dom/client");

(async () => {
  const dom = new JSDOM(
    "<!doctype html><html><head></head><body><div id='root'></div></body></html>",
    { url: "https://wayward.test/", pretendToBeVisual: true }
  );
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator, configurable: true
  });
  Object.defineProperty(global.navigator, "userAgent", {
    value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    configurable: true
  });
  global.MutationObserver = dom.window.MutationObserver;
  global.IS_REACT_ACT_ENVIRONMENT = true;

  // Simulate a narrow Android WebView whose UA and host label do not identify
  // it as mobile. The viewport is still the actual mobile-width signal.
  dom.window.matchMedia = (query) => ({
    media: query,
    matches: query.includes("max-width: 1023px"),
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  });

  const hooks = new Map();
  let definition = null;
  global.WML = {
    define(value) { definition = value; }
  };
  vm.runInThisContext(
    fs.readFileSync("mobile-ui-migration/mod.js", "utf8"),
    { filename: "mobile-ui-migration/mod.js" }
  );
  assert.ok(definition, "WML module definition must register");

  const api = {
    game: "2026-11-01-pre7",
    host: { platform: "webview" },
    fn(name) {
      if (name === "React") return React;
      if (name === "ReactDOM") return ReactDOM;
      throw new Error("Unexpected api.fn: " + name);
    },
    has() { return true; },
    hook(name, handlers) {
      hooks.set(name, handlers);
      return () => hooks.delete(name);
    }
  };
  definition.setup(api);

  const prepDispatches = [];
  const stockPayload = { type: "stock_up", skip: true };

  function qoe() {
    return React.createElement("div", null,
      "침실 현재 위치 · 당신 준비 중 · 기력 · 피파 잠든 상태"
    );
  }
  function yst(props) {
    const hook = hooks.get("facilityAccordion");
    const render = () => React.createElement("div", {
      className: "mock-facility-accordion"
    }, props.title);
    return hook ? hook.around(render, props) : render();
  }
  function wst() {
    const render = () => React.createElement("div", null,
      React.createElement("h2", {
        className: "text-lg font-bold text-amber-400 mb-3"
      }, "오후 영업 준비"),
      React.createElement("div", {
        className: "p-3 bg-rose-950/25 rounded-lg border border-rose-800/60 mb-4"
      }, "대출 — 1007골드 남음"),
      React.createElement("div", { className: "mb-4" },
        React.createElement("button", {
          onClick: () => prepDispatches.push(stockPayload)
        }, "물자 채우기")
      ),
      React.createElement(yst, { title: "시설 업그레이드" })
    );
    const hook = hooks.get("prepPanel");
    return hook ? hook.around(render) : render();
  }
  function Zot() {
    return React.createElement("p", null,
      "당신은 위층 침실에 있습니다. 곁에서 피파는 아직 잠들어 있고, 아래층 선술집은 조용합니다."
    );
  }
  function SB() {
    return React.createElement("button", null, "행동 선택지");
  }
  function Hst(props) {
    return React.createElement(React.Fragment, null, props.children);
  }

  const storyPane = React.createElement("div", {
    className: "flex-1 min-h-0 overflow-y-auto p-2 text-[0.78rem]"
  },
    React.createElement(React.Fragment, null,
      React.createElement("div", {
        className: "mb-2 pb-2 border-b border-stone-800"
      }, React.createElement(qoe)),
      React.createElement("div", { className: "min-w-0" },
        React.createElement("div", { className: "mb-3" },
          React.createElement(wst)
        ),
        React.createElement(Zot)
      )
    )
  );

  const actionPanel = React.createElement("div", {
    className: "w-[37%] max-w-[13rem] desk:w-[16rem] shrink-0 flex flex-col min-h-0"
  },
    React.createElement("div", {
      className: "flex-1 min-h-0 overflow-y-auto py-1 text-[0.72rem]"
    }, React.createElement(SB)),
    React.createElement("button", {
      title: "행동 버튼을 반대쪽으로 이동"
    }, "이동")
  );

  // Mirrors gat() in the exact 2026-11-01 source: story tab I contains wst
  // followed by Zot, while the separate 37% action pane owns the scroll area.
  const actualGatShape = React.createElement(Hst, null,
    React.createElement("div", { className: "flex flex-col min-h-0 flex-1" },
      React.createElement("div", { className: "lg:hidden flex-1 flex min-h-0" },
        React.createElement("div", {
          className: "flex-1 min-w-0 flex flex-col min-h-0 border-r border-stone-700"
        },
          storyPane,
          React.createElement("div", { className: "flex shrink-0 border-t" }, "story/focus tabs")
        ),
        actionPanel
      )
    )
  );

  const layoutHook = hooks.get("layout");
  assert.equal(typeof layoutHook?.after, "function",
    "WML layout after hook must be registered");
  const transformedRoot = layoutHook.after(actualGatShape);
  const container = document.getElementById("root");
  const root = createRoot(container);
  await React.act(async () => {
    root.render(transformedRoot);
  });

  const status = window.__M36_MOBILE_UI_MIGRATION__?.getStatus?.();
  assert.equal(status?.mobileHost, true,
    "narrow WebView must be recognized as mobile despite desktop UA/host label");
  assert.ok(status?.actionPanel, "mobile action panel was not transformed");
  assert.ok(status?.actionScroll, "mobile action scroll was not transformed");
  assert.ok(status?.prepPanelInActionScroll,
    "prep panel must appear inside the action-choice scroll");
  assert.equal(status?.prepPanelInStoryPane, false,
    "prep panel must be removed from the story pane");
  assert.ok(status?.pinnedPanel, "location/status panel must be moved above action choices");

  const scroll = container.querySelector(".m36-ui-migration-action-scroll");
  const story = container.querySelector(
    "div[class*='flex-1 min-h-0 overflow-y-auto p-2 text-[0.78rem]']"
  );
  assert.ok(scroll?.querySelector(".m36-ui-migration-prep-slot"));
  assert.ok(scroll?.textContent.includes("오후 영업 준비"));
  assert.ok(scroll?.textContent.includes("대출 — 1007골드 남음"));
  assert.ok(scroll?.textContent.includes("물자 채우기"));
  assert.ok(scroll?.textContent.includes("시설 업그레이드"));
  assert.ok(story?.textContent.includes("아래층 선술집은 조용합니다"));
  assert.ok(!story?.textContent.includes("오후 영업 준비"));
  assert.ok(!story?.textContent.includes("침실 현재 위치"));
  assert.ok(container.querySelector(".m36-ui-migration-pinned-panel")
    ?.textContent.includes("침실 현재 위치"));

  const movedButton = Array.from(scroll.querySelectorAll("button"))
    .find(button => button.textContent.includes("물자 채우기"));
  assert.ok(movedButton, "moved original stock-up button is missing");
  await React.act(async () => {
    movedButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(prepDispatches.length, 1);
  assert.strictEqual(prepDispatches[0], stockPayload,
    "moving the button must preserve the original dispatch payload");

  window.__M36_MOBILE_UI_MIGRATION__?.stop?.();
  await React.act(async () => root.unmount());
  dom.window.close();
  console.log("PASS: real gat-shaped tree; narrow WebView detected; prep panel and status moved; story contains narration only; stock-up payload preserved.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
