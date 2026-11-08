from pathlib import Path
import hashlib, zipfile

mod_path = Path("mobile-ui-migration/mod.js")
readme_path = Path("mobile-ui-migration/README_ko.md")
mod = mod_path.read_text(encoding="utf-8")
readme = readme_path.read_text(encoding="utf-8")

old = 'const MOBILE_PORTRAIT = window.matchMedia("(max-width: 1023px) and (orientation: portrait)");'
new = old + '\n    const MOBILE_VIEWPORT = window.matchMedia("(max-width: 1023px)");'
assert mod.count(old) == 1
mod = mod.replace(old, new, 1)

old = '''const COMPONENT_NAME_ALIASES = api.game === "2026-11-01"
      ? { qoe: "loe", wb: "fb", snt: "utt" }
      : {};'''
new = '''const COMPONENT_NAME_ALIASES = String(api.game || "").includes("2026-11-01")
      ? { qoe: "loe", wb: "fb", snt: "utt" }
      : {};'''
assert mod.count(old) == 1
mod = mod.replace(old, new, 1)

old = '''const mobileHost = hostPlatform === "mobile" ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");'''
new = '''const mobileHost =
      /mobile|android|ios|tablet/i.test(hostPlatform) ||
      /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent || "") ||
      MOBILE_VIEWPORT.matches;'''
assert mod.count(old) == 1
mod = mod.replace(old, new, 1)

# Make the runtime diagnostic tell us whether the prep panel actually reached
# the action pane. v1.3.14 only reported a generic "hook available" flag.
old = '''          mobileHost,
          portrait: MOBILE_PORTRAIT.matches,
          actionPanel: !!document.querySelector(GAME_SELECTOR + " ." + ACTION_PANEL_CLASS),
          actionScroll: !!document.querySelector(GAME_SELECTOR + " ." + ACTION_SCROLL_CLASS),
          prepActionPanel: !!document.querySelector(GAME_SELECTOR + " ." + PREP_PANEL_CLASS),
          prepPanelButtons: document.querySelectorAll(GAME_SELECTOR + " ." + PREP_PANEL_CLASS + " button").length,'''
new = '''          mobileHost,
          mobileViewport: MOBILE_VIEWPORT.matches,
          portrait: MOBILE_PORTRAIT.matches,
          actionPanel: !!document.querySelector(GAME_SELECTOR + " ." + ACTION_PANEL_CLASS),
          actionScroll: !!document.querySelector(GAME_SELECTOR + " ." + ACTION_SCROLL_CLASS),
          prepActionPanel: !!document.querySelector(GAME_SELECTOR + " ." + PREP_PANEL_CLASS),
          prepPanelInActionScroll: !!document.querySelector(
            GAME_SELECTOR + " ." + ACTION_SCROLL_CLASS + " ." + PREP_PANEL_CLASS
          ),
          prepPanelInStoryPane: Array.from(
            document.querySelectorAll(GAME_SELECTOR + " div")
          ).some((element) =>
            String(element.className || "").includes(
              "flex-1 min-h-0 overflow-y-auto p-2 text-[0.78rem]"
            ) && !!element.querySelector("." + PREP_PANEL_CLASS)
          ),
          prepPanelButtons: document.querySelectorAll(GAME_SELECTOR + " ." + PREP_PANEL_CLASS + " button").length,'''
assert mod.count(old) == 1
mod = mod.replace(old, new, 1)

old = '''      layoutHook: api.has("layout"),
      prepPanelHook: true,
      facilityAccordionHook: true,
      patronInteractionCardHook: true,
      patronPortal: typeof ReactDOM?.createPortal === "function"'''
new = '''      mobileViewport: MOBILE_VIEWPORT.matches,
      layoutHook: api.has("layout"),
      prepPanelHook: api.has("prepPanel"),
      facilityAccordionHook: api.has("facilityAccordion"),
      patronInteractionCardHook: api.has("patronInteractionCard"),
      patronPortal: typeof ReactDOM?.createPortal === "function"'''
assert mod.count(old) == 1
mod = mod.replace(old, new, 1)

# Update every package version/report marker consistently.
assert "1.3.14" in mod
mod = mod.replace("1.3.14", "1.3.15")
readme = readme.replace("1.3.14", "1.3.15")
notice = "\n- **모바일 판별 보강:** WML host 라벨과 User-Agent가 모바일을 표시하지 않는 WebView에서도 실제 CSS 뷰포트 폭(1023px 이하)을 확인해 모바일 레이아웃 훅이 빠지지 않도록 보완합니다. 실행 중 상태 조회에는 영업 준비 패널이 선택지 스크롤 안으로 들어갔는지 여부를 별도로 표시합니다.\n"
if "모바일 판별 보강" not in readme:
    marker = "## 설치"
    assert marker in readme
    readme = readme.replace(marker, notice + "\n" + marker, 1)

mod_path.write_text(mod, encoding="utf-8")
readme_path.write_text(readme, encoding="utf-8")

zip_path = Path("mobile-ui-migration-437-v1.3.15.zip")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, 9) as z:
    z.write(mod_path, "mobile-ui-migration/mod.js")
    z.write(readme_path, "mobile-ui-migration/README_ko.md")
with zipfile.ZipFile(zip_path) as z:
    assert z.testzip() is None
    entries = {i.filename: i.file_size for i in z.infolist()}
    assert entries["mobile-ui-migration/mod.js"] == len(mod.encode("utf-8"))
    assert entries["mobile-ui-migration/README_ko.md"] == len(readme.encode("utf-8"))
print("PACKAGE", entries)
print("ZIP_BYTES", zip_path.stat().st_size)
print("ZIP_SHA256", hashlib.sha256(zip_path.read_bytes()).hexdigest())
print("MOD_SHA256", hashlib.sha256(mod.encode("utf-8")).hexdigest())
print("README_SHA256", hashlib.sha256(readme.encode("utf-8")).hexdigest())
