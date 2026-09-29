# Wayward source roles

This directory is the target source layout for incremental extraction from the current bundled HTML.

The current HTML remains the runtime baseline until each extracted module has been integrated and verified. Do not copy arbitrary character chunks into these files.

Target responsibilities:

- `app/`: top-level app router and screen selection
- `screens/`: user-facing screens
- `game/`: game state, actions, turns, RNG and IDs
- `ui/`: reusable desktop/mobile presentation components
- `mobile/`: mobile-only presentation and surface orchestration
- `debug/`: development-only controls
- `storage/`: save/load/autosave/import/export boundaries
- `shared/`: cross-cutting utilities and hooks

Extraction rule: move one semantic owner at a time, preserve behavior, run syntax/build checks, then compare the resulting artifact against the previous runtime baseline.
