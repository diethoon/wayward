const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

const REPO = process.cwd();
const ARCHIVE = path.join(REPO, "wayward 11.2.zip");
const STAGE = "/tmp/wayward-wml-runtime-live";
const EXPECTED = {
  bytes: 4373978,
  sha256: "e159fb2002d31559b1ac1936cf6b48cdbbdc4858bfbb0b67e2d7284ca2195d1d",
  md5: "d75797d4101f4a1312b3ae0571d77f68"
};
const SAVE_PATH = path.join(REPO, "새 세이브.json");
const MOD_PATH = path.join(REPO, "mobile-ui-migration", "mod.js");

function hash(algorithm, bytes) {
  return crypto.createHash(algorithm).update(bytes).digest("hex");
}

function writeZipEntry(entry, destination) {
  const bytes = execFileSync("unzip", ["-p", ARCHIVE, entry], {
    encoding: "buffer", maxBuffer: 32 * 1024 * 1024
  });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  return bytes;
}

function startServer(root) {
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
      fs.stat(file, (error, stat) => {
        if (error || !stat.isFile()) { res.writeHead(404); return res.end("not found"); }
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
  assert.ok(fs.existsSync(ARCHIVE), "canonical source archive missing");
  assert.ok(fs.existsSync(SAVE_PATH), "prep phase test save missing");
  assert.ok(fs.existsSync(MOD_PATH), "v1.3.15 migration module missing");

  const save = JSON.parse(fs.readFileSync(SAVE_PATH, "utf8"));
  assert.equal(save.state?.phase, "prep", "test save is not phase=prep");

  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });

  const htmlEntry = "wayward 11.5/Wayward_WML_ko.html";
  const htmlBytes = writeZipEntry(htmlEntry, path.join(STAGE, "Wayward_WML_ko.html"));
  const htmlMeta = {
    bytes: htmlBytes.length,
    sha256: hash("sha256", htmlBytes),
    md5: hash("md5", htmlBytes)
  };
  assert.equal(htmlMeta.bytes, EXPECTED.bytes);
  assert.equal(htmlMeta.sha256, EXPECTED.sha256);
  assert.equal(htmlMeta.md5, EXPECTED.md5);
  console.log("CANONICAL_HTML_EXACT_PASS", JSON.stringify(htmlMeta));

  const runtimeEntries = [
    "wayward 11.5/wml/runtime/wml-core.js",
    "wayward 11.5/wml/symbols/2026-11-01.js"
  ];
  for (const entry of runtimeEntries) {
    const relative = entry.slice("wayward 11.5/".length);
    const bytes = writeZipEntry(entry, path.join(STAGE, relative));
    console.log("RUNTIME_ASSET", JSON.stringify({
      path: relative, bytes: bytes.length, sha256: hash("sha256", bytes)
    }));
  }

  const modDestination = path.join(STAGE, "wml/mods/mobile-ui-migration/mod.js");
  fs.mkdirSync(path.dirname(modDestination), { recursive: true });
  fs.copyFileSync(MOD_PATH, modDestination);

  // The archive omits the Korean i18n shims referenced by the canonical HTML.
  // Empty files only prevent optional translation-script 404s in this isolated test.
  const i18nPaths = [
    "wml/i18n/ko/finals.js", "wml/i18n/ko/display.js",
    "wml/i18n/ko/voice.js", "wml/i18n/ko/runtime.js"
  ];
  for (const relative of i18nPaths) {
    const destination = path.join(STAGE, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, "/* isolated test shim: absent from archive */\\n");
  }
  fs.mkdirSync(path.join(STAGE, "wml/compat"), { recursive: true });
  fs.writeFileSync(path.join(STAGE, "wml/compat/compat.js"), "/* optional compat omitted */\\n");
  fs.mkdirSync(path.join(STAGE, "wml/presets"), { recursive: true });
  fs.writeFileSync(path.join(STAGE, "wml/presets/presets.js"), "/* optional presets omitted */\\n");
  fs.writeFileSync(path.join(STAGE, "wml/mods/mods.js"), 'WML.enable(["mobile-ui-migration"]);\\n');

  const server = await startServer(STAGE);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 15; SM-S938N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
  });

  await context.addInitScript(() => localStorage.setItem("wml.dev", "true"));\n  const page = await context.newPage();
  const pageErrors = [];
  const failedRequests = [];
  const relevantConsole = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("requestfailed", request => failedRequests.push({
    url: request.url(), error: request.failure()?.errorText
  }));
  page.on("console", message => {
    const value = message.text();
    if (/\\[WML|mobile-ui-migration|hook .* threw|setup failed|unknown symbol/i.test(value)) {
      relevantConsole.push({ type: message.type(), text: value.slice(0, 1600) });
    }
  });

  try {
    await page.goto("http://127.0.0.1:4173/Wayward_WML_ko.html", {
      waitUntil: "domcontentloaded", timeout: 120000
    });
    await page.waitForFunction(() => window.WML?.status?.().booted === true, {
      timeout: 60000
    });

    const boot = await page.evaluate(() => {
      const s = window.WML.status();
      return {
        wmlVersion: window.WML.VERSION, game: s.game, host: s.host,
        loaded: s.loaded, failed: s.failed, warnings: s.warnings,
        order: s.order, symbols: s.modSymbols
      };
    });
    console.log("REAL_WML_BOOT_REPORT", JSON.stringify(boot));
    assert.equal(boot.wmlVersion, "0.9.5");
    assert.ok(boot.loaded.includes("mobile-ui-migration"),
      "migration module did not reach loaded state: " + JSON.stringify(boot));
    assert.equal(boot.failed.length, 0,
      "WML boot reported failures: " + JSON.stringify(boot.failed));

    const stateResult = await page.evaluate(testState => {
      const api = window.WML.dev();
      const before = api.store.game();
      api.store.update(() => testState);
      const after = api.store.game();
      return { beforePhase: before?.phase ?? null, afterPhase: after?.phase ?? null, slot: after?.slot ?? null };
    }, save.state);
    assert.equal(stateResult.afterPhase, "prep");
    console.log("REAL_GAME_STORE_PASS", JSON.stringify(stateResult));

    await page.waitForFunction(() => {
      const value = window.__M36_MOBILE_UI_MIGRATION__?.getStatus?.();
      return value && value.prepPanelInActionScroll === true;
    }, { timeout: 20000 });

    const dom = await page.evaluate(() => {
      const status = window.__M36_MOBILE_UI_MIGRATION__?.getStatus?.() || null;
      const action = document.querySelector("#root .m36-ui-migration-action-scroll");
      const prep = action?.querySelector(".m36-ui-migration-prep-slot");
      const story = [...document.querySelectorAll("#root div")].find(el =>
        String(el.className || "").includes("flex-1 min-h-0 overflow-y-auto p-2 text-[0.78rem]")
      );
      return {
        status, actionScrollFound: Boolean(action), prepSlotFound: Boolean(prep),
        prepPanelCount: document.querySelectorAll(
          "#root .m36-ui-migration-prep-slot .m36-ui-migration-prep-panel"
        ).length,
        actionText: (prep?.textContent || "").slice(0, 2000),
        storyText: (story?.textContent || "").slice(0, 3000),
        storyContainsPrep: (story?.textContent || "").includes("오후 영업 준비"),
        storyContainsNarration: (story?.textContent || "").includes("당신은 위층 침실"),
        viewport: { width: innerWidth, height: innerHeight }
      };
    });

    console.log("REAL_GAT_DOM_REPORT", JSON.stringify(dom));
    assert.equal(dom.status?.prepPanelInActionScroll, true);
    assert.equal(dom.status?.prepPanelInStoryPane, false);
    assert.equal(dom.actionScrollFound, true);
    assert.equal(dom.prepSlotFound, true);
    assert.equal(dom.prepPanelCount, 1);
    assert.equal(dom.storyContainsPrep, false);
    assert.equal(dom.storyContainsNarration, true);
    for (const label of ["오후 영업 준비", "대출", "물자 채우기", "시설 업그레이드"]) {
      assert.ok(dom.actionText.includes(label), "action area missing: " + label);
    }
    assert.equal(pageErrors.length, 0, "page errors: " + JSON.stringify(pageErrors));

    const gatHook = hookReport.find(item => item.raw === "gat");\n    assert.ok(gatHook, "WML did not register the gat hook");\n    assert.ok(gatHook.calls > 0, "gat hook never ran after real game render");\n    console.log("REAL_WML_RELEVANT_CONSOLE", JSON.stringify(relevantConsole));
    console.log("OPTIONAL_RESOURCE_FAILURES", JSON.stringify(
      failedRequests.filter(x => /i18n|compat|presets/.test(x.url))
    ));
    console.log("ACTUAL_WML_RUNTIME_AND_LAYOUT_PASS");
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error("ACTUAL_WML_RUNTIME_AND_LAYOUT_FAIL", error.stack || String(error));
  process.exitCode = 1;
});
