from pathlib import Path
import hashlib
import zipfile

BASE = Path("/tmp/mobile-ui-v1312.zip")
ROOT = Path("build/mobile-ui-migration")
MOD_PATH = ROOT / "mod.js"
README_PATH = ROOT / "README_ko.md"

with zipfile.ZipFile(BASE) as z:
    z.extractall("build")

mod = MOD_PATH.read_text(encoding="utf-8")
readme = README_PATH.read_text(encoding="utf-8")

if 'version: "1.3.12"' not in mod:
    raise SystemExit("Base mod is not v1.3.12")
mod = mod.replace('version: "1.3.12"', 'version: "1.3.13"', 1)
mod = mod.replace('version: "1.3.12"', 'version: "1.3.13"')
mod = mod.replace('version: "1.3.12",', 'version: "1.3.13",')
mod = mod.replace('version: "1.3.12"', 'version: "1.3.13"')

start = mod.index("    function readPatronPortalTargets() {")
end = mod.index("\n    const unhookPatronInteractionCard = api.hook", start)

replacement = '''    function readPatronPortalTargets() {
      return {
        fixed: document.getElementById(PATRON_DIALOGUE_TARGET_ID),
        scrolling: document.getElementById(PATRON_CHOICES_TARGET_ID)
      };
    }

    // The WML responsive layout mounts the same Pie/Jrt interaction card twice
    // on portrait screens: once in the CSS-hidden desktop focus pane and once
    // in the mobile focus tab. Both Xrt instances were previously creating
    // portals into the same action-scroll target, so every choice was rendered
    // twice. Elect exactly one mounted instance as the shared portal owner.
    const patronPortalRegistry = {
      owner: null,
      listeners: new Map()
    };

    function registerPatronPortalInstance(instance, refresh) {
      patronPortalRegistry.listeners.set(instance, refresh);
      if (!patronPortalRegistry.owner) {
        patronPortalRegistry.owner = instance;
      }
      refresh();

      return () => {
        patronPortalRegistry.listeners.delete(instance);
        if (patronPortalRegistry.owner !== instance) return;

        patronPortalRegistry.owner =
          patronPortalRegistry.listeners.keys().next().value || null;

        const refreshNextOwner = patronPortalRegistry.owner
          ? patronPortalRegistry.listeners.get(patronPortalRegistry.owner)
          : null;
        refreshNextOwner?.();
      };
    }

    function PatronInteractionPortal({ result }) {
      const [targets, setTargets] = React.useState(readPatronPortalTargets);
      const [, refreshPortalOwnership] = React.useReducer(
        (revision) => revision + 1,
        0
      );
      const portalInstanceRef = React.useRef(null);
      if (!portalInstanceRef.current) portalInstanceRef.current = {};
      const portalInstance = portalInstanceRef.current;

      React.useLayoutEffect(() =>
        registerPatronPortalInstance(portalInstance, refreshPortalOwnership),
      [portalInstance]);

      React.useEffect(() => {
        let active = true;
        const refreshTargets = () => {
          if (!active) return;
          const next = readPatronPortalTargets();
          setTargets((current) =>
            current.fixed === next.fixed && current.scrolling === next.scrolling
              ? current
              : next
          );
        };
        refreshTargets();
        const observedRoot = document.querySelector(GAME_SELECTOR) || document.documentElement;
        const observer = typeof MutationObserver !== "undefined"
          ? new MutationObserver(refreshTargets)
          : null;
        observer?.observe(observedRoot, { childList: true, subtree: true });
        return () => {
          active = false;
          observer?.disconnect();
        };
      }, []);

      const parts = splitPatronInteraction(result);
      if (!parts) return result;

      const isPortalOwner = patronPortalRegistry.owner === portalInstance;
      const canCreatePortal = typeof ReactDOM?.createPortal === "function";
      const targetsReady = !!(
        targets.fixed &&
        targets.scrolling &&
        canCreatePortal
      );

      // Before portal targets mount, preserve the original card as fallback.
      // Once ready, every duplicate card removes its own native copy, while
      // only the elected owner creates the two shared portals.
      if (!targetsReady) return result;
      if (!isPortalOwner) return parts.originalWithoutChoices;

      return h(
        React.Fragment,
        null,
        parts.originalWithoutChoices,
        ReactDOM.createPortal(parts.fixed, targets.fixed),
        ReactDOM.createPortal(parts.scrolling, targets.scrolling)
      );
    }
'''
mod = mod[:start] + replacement + mod[end:]

# Keep the status/debug metadata and startup log consistent with the package version.
mod = mod.replace('version: "1.3.12"', 'version: "1.3.13"')
mod = mod.replace('M36 mobile UI migration 1.3.12 ready', 'M36 mobile UI migration 1.3.13 ready')
mod = mod.replace("console.info(\\"[WML] M36 mobile UI migration 1.3.12 ready\\"", "console.info(\\"[WML] M36 mobile UI migration 1.3.13 ready\\"")

README_PATH.write_text(readme.replace("1.3.12", "1.3.13").replace(
    "대화 선택지 단일 출력",
    "중복 반응형 카드의 포털 단일 소유자 처리"
), encoding="utf-8")
MOD_PATH.write_text(mod, encoding="utf-8")

assert 'version: "1.3.13"' in mod
assert "patronPortalRegistry" in mod
assert "registerPatronPortalInstance" in mod
assert "if (!isPortalOwner) return parts.originalWithoutChoices;" in mod
assert "ReactDOM.createPortal(parts.scrolling, targets.scrolling)" in mod
assert "1.3.13" in README_PATH.read_text(encoding="utf-8")

print("v1.3.13 mod bytes", len(mod.encode()), "sha256", hashlib.sha256(mod.encode()).hexdigest())
print("v1.3.13 README bytes", README_PATH.stat().st_size,
      "sha256", hashlib.sha256(README_PATH.read_bytes()).hexdigest())
