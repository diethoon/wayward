# Image Studio launcher-first routing specification

Status: approved requirements; implementation tracked separately in PR #46.
Scope: Android launcher + Wayward Image Studio WML adapter.

## 1. Absolute request-routing priority

1. When a NovelAI server started by the launcher is running, every Image Studio image-generation request must be sent to that launcher-managed NovelAI server.
2. When a ComfyUI server started by the launcher is running, every Image Studio image-generation request must be sent to that launcher-managed ComfyUI server.
3. The active game session's backend selector, saved server URL, auto/off mode, or other backend-routing preferences must never redirect an Image Studio generation request away from a running launcher-managed server.
4. When no launcher-managed generation server is running, do not send a generation request to a game-configured external server or any other endpoint. Keep the existing installed image-pack lookup/render path active.
5. A server that is running but not provider-ready is not a usable generation destination yet. Keep image-pack rendering active and do not silently reroute to another engine. Once that same launcher server becomes ready, route to it.

The launcher server is the sole generation transport authority. No automatic server start or implicit engine switch occurs merely because a game session opens.

## 2. Preserve game-side Image Studio settings

Launcher routing overrides only the generation destination/transport. It must not disable, replace, reset, or rewrite game-side Image Studio configuration.

The following remain game-controlled and must continue to affect request construction and presentation:
- Prompt editing and prompt composition.
- Character/outfit constraints (including preventing unwanted clothing changes).
- Situation/scene-specific prompt rules.
- Character, style, composition, negative-prompt, and other Image Studio settings.
- Existing cache, image-pack lookup, and display behavior.

The bridge may replace the backend probe and API base URL, and must neutralize a game-session offline/backend toggle while a launcher server is ready; it must preserve the original Image Studio API facade and all unrelated functions/settings. A ready launcher server always wins over game-session backend/offline selection. It must not modify game saves, RNG, IDs, Undo, economy, supply, character behavior, or turn logic.

## 3. Engine selection

The engine is selected only by the launcher server that is currently running:
- Launcher NovelAI server -> NovelAI route.
- Launcher ComfyUI server -> ComfyUI route.

Changing a game-session backend or offline setting must not change the running launcher's engine or request destination, and must not suppress generation while the launcher server is ready. Switching engines requires an explicit launcher action.

## 4. Per-engine generate-only-when-pack-missing controls (new UI requirement)

Add one independent toggle immediately to the right of each launcher server start button:
- NovelAI start button + "Generate only when image pack is missing".
- ComfyUI start button + "Generate only when image pack is missing".

These are launcher-level generation policies, independent per engine and persisted in launcher settings.

When the toggle for the currently running engine is enabled:
- Before generating, determine whether the exact image applicable to the current in-game situation is already available through the existing installed image-pack/cache lookup.
- If an applicable image exists, do not send a generation request; display the existing image.
- If no applicable image exists, send the request to the currently running launcher server.
- Do not treat "character has any image" as a match. Matching must reflect the game's actual image selection context (character + current situation/state + applicable variant), using the existing game lookup semantics.
- If the game lookup cannot reliably determine a match, fail closed: do not generate automatically; log why.

The toggle controls automatic in-game generation only. It must not disable manual generation explicitly requested by the user unless a later requirement says so.

## 5. Non-goals and safety constraints

- Do not change game logic or the existing image-pack data/selection rules.
- Do not change prompt/settings payloads except for the generation destination.
- Do not start servers automatically on game entry.
- Do not fall back from one running engine to another.
- Do not contact remote game-configured endpoints when the launcher server is stopped.
- Keep diagnostics for selected engine, server state, request route, pack hit/miss, and generation decision without logging prompts, credentials, or tokens.

## 6. Acceptance tests

- NAI running + game session set to ComfyUI/off/external URL -> generation request goes only to launcher NAI.
- ComfyUI running + game session set to NAI/off/external URL -> generation request goes only to launcher ComfyUI.
- Launcher server stopped + game session has an external backend URL -> no generation request; installed image packs still render.
- Launcher server starting/provider-not-ready -> no generation request; installed image packs still render; no alternate engine fallback.
- Prompt/outfit/situation rules changed in-game -> outgoing request reflects those settings unchanged while destination remains launcher server.
- NAI and ComfyUI missing-pack toggles are independent and each suppresses only automatic generation when the exact applicable pack image exists.
- Manual generation behavior remains unchanged by the missing-pack-only toggle.
