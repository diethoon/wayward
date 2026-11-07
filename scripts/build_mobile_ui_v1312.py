from pathlib import Path
from textwrap import dedent, indent
import hashlib
import zipfile

BASE_ZIP = Path("/tmp/mobile-ui-v1310.zip")
ROOT = Path("build/mobile-ui-migration")
MOD_PATH = ROOT / "mod.js"
README_PATH = ROOT / "README_ko.md"

with zipfile.ZipFile(BASE_ZIP) as archive:
    archive.extractall("build")

mod = MOD_PATH.read_text(encoding="utf-8")
readme = README_PATH.read_text(encoding="utf-8")

def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, got {count}")
    return source.replace(old, new, 1)

mod = mod.replace("1.3.10", "1.3.12")
mod = replace_once(
    mod,
    'description: "4.37MB WML 빌드용: 피파 탭 대화 중복 제거, 원본 선택지 스크롤 미러링",',
    'description: "4.37MB WML 빌드용: 이야기 탭 알림 제거, 대화 선택지 단일 출력",',
    "mod description",
)
mod = replace_once(
    mod,
    '''      // "hoe" is the response-needed alert, not the narration log ("itt").
      // Keep only the original story log in the story tab.
      if (portraitMode && storyPane && typeName === "hoe") return null;''',
    '''      // The 2026-11-01 WML build names the response-needed list "Voe".
      // Keep it out of the story tab so that tab contains only the narration log.
      // Retain the legacy name for the pre7 mapping; this is scoped to the story pane,
      // so the same list in the house/status panel remains untouched.
      if (portraitMode && storyPane && (typeName === "Voe" || typeName === "hoe")) return null;''',
    "story alert owner",
)

start = mod.index("    function splitPatronInteraction(result) {")
end = mod.index("\n    function readPatronPortalTargets()", start)
new_function = indent(dedent("""\
function splitPatronInteraction(result) {
  if (!React.isValidElement(result) || result.type !== "div") return null;
  const rootClass = typeof result.props?.className === "string"
    ? result.props.className
    : "";
  if (!rootClass.includes("border-l-2 border-violet-600")) return null;

  const rootChildren = React.Children.toArray(result.props?.children);
  const content = rootChildren.find((node) =>
    React.isValidElement(node) &&
    node.type === "div" &&
    typeof node.props?.className === "string" &&
    node.props.className.includes("px-3 py-2")
  );
  if (!content) return null;

  const children = React.Children.toArray(content.props?.children);
  const header = children.find((node) =>
    React.isValidElement(node) &&
    node.type === "div" &&
    typeof node.props?.className === "string" &&
    node.props.className.includes("flex items-baseline justify-between gap-2")
  );
  const description = children.find((node) =>
    React.isValidElement(node) &&
    node.type === "div" &&
    typeof node.props?.className === "string" &&
    node.props.className.includes("text-[0.7rem] text-violet-300/80 mt-0.5")
  );
  const narration = children.find((node) =>
    React.isValidElement(node) &&
    node.type === "div" &&
    typeof node.props?.className === "string" &&
    node.props.className.includes("text-stone-300 text-xs mt-1.5 italic")
  );
  const choices = children.find((node) =>
    React.isValidElement(node) &&
    node.type === "div" &&
    typeof node.props?.className === "string" &&
    node.props.className.includes("grid gap-1 mt-2")
  );

  // Move the native interaction header, description and narration to the
  // pinned dialogue panel. The exact native choice-grid element is moved
  // once to the action scroll portal; its handlers and choice IDs are unchanged.
  if (!header || !narration || !choices) return null;

  const makeOriginal = (omitChoices) => {
    const retainedContent = children.filter((node) =>
      node !== header && node !== description && node !== narration &&
      (!omitChoices || node !== choices)
    );
    const originalChildren = rootChildren.flatMap((node) => {
      if (node !== content) return [node];
      // When the moved choice grid is the only remaining child, remove
      // the whole native card instead of calling cloneElement with zero
      // child arguments (which would preserve the original children).
      return retainedContent.length
        ? [React.cloneElement(content, null, ...retainedContent)]
        : [];
    });
    return originalChildren.length
      ? React.cloneElement(result, null, ...originalChildren)
      : null;
  };

  return {
    // Fallback keeps native buttons in the original card when a portal
    // target is unavailable. With both targets, choices are removed here.
    original: makeOriginal(false),
    originalWithoutChoices: makeOriginal(true),
    fixed: h("div", { className: "m36-ui-migration-patron-dialogue" },
      header,
      description || null,
      narration
    ),
    scrolling: h("div", { className: "m36-ui-migration-patron-choices" }, choices)
  };
}
"""), "    ")
mod = mod[:start] + new_function + mod[end:]

old_portal = '''      const pinDialogue = !!(parts && targets.fixed && canCreatePortal);
      const mirrorChoices = !!(parts && targets.scrolling && canCreatePortal);

      if (pinDialogue) {
        portals.push(ReactDOM.createPortal(parts.fixed, targets.fixed));
      }
      if (mirrorChoices) {
        portals.push(ReactDOM.createPortal(parts.scrolling, targets.scrolling));
      }

      // If the pinned target is available, omit the duplicate text in the
      // native third-tab card but leave its original buttons in place.
      // If it is not available, fall back to the complete untouched result.
      return h(React.Fragment, null,
        pinDialogue ? parts.original : result,
        ...portals
      );'''
new_portal = '''      const pinDialogue = !!(parts && targets.fixed && canCreatePortal);
      // Choices leave the native card only when both portal roots are ready.
      // This avoids rendering the same buttons in the character tab and the
      // action list, and preserves the complete native card during fallback.
      const moveChoices = !!(pinDialogue && targets.scrolling && canCreatePortal);

      if (pinDialogue) {
        portals.push(ReactDOM.createPortal(parts.fixed, targets.fixed));
      }
      if (moveChoices) {
        portals.push(ReactDOM.createPortal(parts.scrolling, targets.scrolling));
      }

      return h(React.Fragment, null,
        moveChoices
          ? parts.originalWithoutChoices
          : pinDialogue
            ? parts.original
            : result,
        ...portals
      );'''
mod = replace_once(mod, old_portal, new_portal, "portal routing")

readme = readme.replace("**모드 버전:** 1.3.10", "**모드 버전:** 1.3.12")
readme = replace_once(
    readme,
    "세 번째 탭 고객 대화 미러링",
    "세 번째 탭 고객 대화 이동",
    "README section heading",
)
readme = replace_once(
    readme,
    "원본 세 번째 탭에서는 이 문구만 중복되지 않게 제외하고 원래 선택지 버튼은 그대로 남깁니다. 같은 선택지 버튼을 행동 선택지 일반 스크롤 맨 위에도 표시하며, 고정 영역에는 선택지를 넣지 않습니다. 두 위치의 버튼 모두 원본 dispatch 콜백과 선택지 ID를 유지합니다.",
    "원본 세 번째 탭에서는 대화 제목·설명·나레이션과 선택지 버튼 그리드를 모두 제외합니다. 선택지 그리드는 행동 선택지 일반 스크롤 맨 위에 한 번만 표시하며, 고정 영역에는 선택지를 넣지 않습니다. 원본 React 요소를 그대로 이동하므로 dispatch 콜백과 선택지 ID는 변경하지 않습니다. 두 포털 대상이 모두 준비되지 않은 경우에는 원본 카드 전체를 그대로 표시해 선택지를 잃거나 부분 중복시키지 않습니다.",
    "README choice description",
)
readme = replace_once(
    readme,
    "세로 모바일에서 이야기 탭 내부의 위치·인물 목록과 “당신의 대응이 필요한 상황” 목록을 제거해, 원래 이야기 기록(itt)과 하단 탭이 남도록 합니다.",
    "세로 모바일에서 이야기 탭 내부의 위치·인물 목록과 “당신의 대응이 필요한 상황” 목록을 제거해, 원래 이야기 기록만 남도록 합니다. 2026-11-01 빌드의 실제 알림 컴포넌트 이름은 Voe이며, 이전 코드가 잘못 검사하던 hoe만 남겨 둬 알림이 노출되던 문제를 수정했습니다. 같은 목록이 가게 상태 패널에 나타나는 경우에는 제거하지 않습니다.",
    "README story alert description",
)
readme = readme.replace("M36 모바일 UI 마이그레이션 1.3.10", "M36 모바일 UI 마이그레이션 1.3.12")

MOD_PATH.write_text(mod, encoding="utf-8")
README_PATH.write_text(readme, encoding="utf-8")
assert 'version: "1.3.10"' not in mod
assert 'typeName === "Voe"' in mod
assert "originalWithoutChoices" in mod
assert "1.3.12" in readme
print("patched mod", len(mod.encode()), hashlib.sha256(mod.encode()).hexdigest())
print("patched README", len(readme.encode()), hashlib.sha256(readme.encode()).hexdigest())
