const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const root = process.cwd();
const save = JSON.parse(fs.readFileSync("새 세이브.json", "utf8"));
assert.equal(save.state?.phase, "prep", "saved test state must be the real prep-phase save");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname); }
      catch { res.writeHead(400); return res.end("bad path"); }
      if (pathname === "/") pathname = "/Wayward_WML_ko.html";
      const file = path.resolve(root, "." + pathname);
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403); return res.end("forbidden");
      }
      fs.stat(file, (statError, stat) => {
        if (statError || !stat.isFile()) { res.writeHead(404); return res.end("not found"); }
        res.writeHead(200, {
          "content-type": mime[path.extname(file).toLowerCase()] || "application/octet-stream",
          "content-length": stat.size,
          "cache-control": "no-store"
        });
        fs.createReadStream(file).pipe(res);
      });
    });
    server.listen(4173, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 15; SM-S938N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
  });
  await context.addInitScript(() => localStorage.setItem("wml.dev", "true"));

  const page = await context.newPage();
  const pageErrors = [];
  const wmlConsole = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    const value = message.text();
    if (/\\[WML|mobile-ui-migration|setup failed|hook .* threw/i.test(value)) {
      wmlConsole.push({ type: message.type(), text: value });
    }
  });

  try {
    await page.goto("http://127.0.0.1:4173/Wayward_WML_ko.html", {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });
    await page.waitForFunction(() => window.WML?.status?.().booted === true, {
      timeout: 60000
    });

    const boot = await page.evaluate(() => {
      const status = window.WML.status();
      return {
        wmlVersion: window.WML.VERSION,
        game: status.game,
        host: status.host,
        loaded: status.loaded,
        failed: status.failed,
        warnings: status.warnings
      };
    });

    assert.ok(boot.loaded.includes("mobile-ui-migration"),
      "WML did not load mobile-ui-migration: " + JSON.stringify(boot));
    assert.equal(boot.failed.length, 0,
      "WML reported module/setup failures: " + JSON.stringify(boot.failed));

    const saveBytes = Buffer.byteLength(JSON.stringify(save));
    const stateResult = await page.evaluate(testState => {
      const dev = window.WML.dev();
      const before = dev.store.game();
      dev.store.update(() => testState);
      const after = dev.store.game();
      return {
        beforePhase: before?.phase ?? null,
        afterPhase: after?.phase ?? null,
        stateSlot: after?.slot ?? null
      };
    }, save.state);

    assert.equal(stateResult.afterPhase, "prep",
      "real test save was not installed into the live game store");

    await page.waitForFunction(() => {
      const status = window.__M36_MOBILE_UI_MIGRATION__?.getStatus?.();
      return status?.prepPanelInActionScroll === true;
    }, { timeout: 20000 });

    const result = await page.evaluate(() => {
      const status = window.__M36_MOBILE_UI_MIGRATION__.getStatus();
      const actionScroll = document.querySelector("#root .m36-ui-migration-action-scroll");
      const prep = actionScroll?.querySelector(".m36-ui-migration-prep-slot");
      const story = [...document.querySelectorAll("#root div")].find(element =>
        String(element.className || "").includes(
          "flex-1 min-h-0 overflow-y-auto p-2 text-[0.78rem]"
        )
      );
      const prepText = prep?.textContent || "";
      const storyText = story?.textContent || "";
      return {
        ...status,
        prepCount: document.querySelectorAll("#root .m36-ui-migration-prep-panel").length,
        actionContainsHeading: prepText.includes("오후 영업 준비"),
        actionContainsDebt: prepText.includes("대출"),
        actionContainsStockUp: prepText.includes("물자 채우기"),
        actionContainsFacilities: prepText.includes("시설 업그레이드"),
        storyContainsPrep: storyText.includes("오후 영업 준비"),
        storyContainsNarration: storyText.includes("당신은 위층 침실"),
        viewport: { width: innerWidth, height: innerHeight },
        pageErrors: window.__M36_MOBILE_UI_MIGRATION__ ? 0 : -1
      };
    });

    assert.equal(result.mobileHost, true, "WML runtime did not identify Android");
    assert.equal(result.portrait, true, "mobile portrait breakpoint did not activate");
    assert.equal(result.actionPanel, true, "original gat action panel was not transformed");
    assert.equal(result.actionScroll, true, "original action scroll was not transformed");
    assert.equal(result.prepPanelInActionScroll, true, "prep panel is not in action scroll");
    assert.equal(result.prepPanelInStoryPane, false, "prep panel still exists in story pane");
    assert.equal(result.prepCount, 1, "prep panel must be rendered exactly once");
    assert.equal(result.actionContainsHeading, true);
    assert.equal(result.actionContainsDebt, true);
    assert.equal(result.actionContainsStockUp, true);
    assert.equal(result.actionContainsFacilities, true);
    assert.equal(result.storyContainsPrep, false, "story pane still contains prep heading");
    assert.equal(pageErrors.length, 0, "browser page errors: " + JSON.stringify(pageErrors));

    console.log("REAL_WML_BOOT_PASS", JSON.stringify(boot));
    console.log("REAL_GAME_STORE_FIXTURE_PASS", JSON.stringify({
      saveBytes,
      beforePhase: stateResult.beforePhase,
      afterPhase: stateResult.afterPhase,
      slot: stateResult.stateSlot
    }));
    console.log("REAL_GAT_LAYOUT_PASS", JSON.stringify(result));
    console.log("WML_RUNTIME_CONSOLE", JSON.stringify(wmlConsole));
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error("REAL_WML_RUNTIME_FAIL", error.stack || String(error));
  process.exitCode = 1;
});
