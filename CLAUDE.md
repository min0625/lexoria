# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Lexoria — a Wordscapes-like English word puzzle game (letter wheel + crossword grid), built as a pure vanilla JS/ES-modules web app with no framework, no bundler, and no backend (Phase 1; Capacitor embedding is Phase 2). UI text is Traditional Chinese; word definitions are Traditional Chinese (ECDICT, primary) plus English (WordNet, secondary).

The two design documents are the source of truth and code comments cite their sections (e.g. `§10`):

- [docs/word-puzzle-game-design.md](docs/word-puzzle-game-design.md) — gameplay rules, architecture decisions, level-generator algorithm, economy values, licensing, the Phase 1 acceptance checklist (§17), and an explicit YAGNI list (§16) of things deliberately not built. Consult §16 before adding any new system.
- [docs/word-puzzle-ui-screens.md](docs/word-puzzle-ui-screens.md) — screen inventory, overlay stacking rules, UI copy table, color palette.

## Commands

Tasks are defined in [mise.toml](mise.toml):

```sh
mise run test        # unit tests: node --test 'tests/**/*.test.mjs' (same as npm test)
mise run serve       # dev server on :8080 (ES modules need http; opening index.html from file:// won't work)
mise run fetch-data  # download generator inputs → tools/data/ (ENABLE word list; wordfreq+WordNet via uv/python)
mise run gen         # regenerate data/levels.json (requires fetch-data first)
```

Run a single test: `node --test --test-name-pattern='<name>' tests/game.test.mjs`. There is no linter or build step.

## Architecture

### Runtime (src/)

`main.js` is the only wiring point — game modules never import each other, and there is no event bus. The single data flow is:

```
wheel.js ──gesture ends(word)──▶ game.submit(word) ──result object──▶ main.js dispatches to grid / HUD / sfx
```

- [game.js](src/game.js) — all level state and win logic, **pure logic, no DOM** (this is what makes it unit-testable). `submit(word)` returns a discriminated result object (`target` / `bonus` / `duplicate` / `invalid`) — the shape is specified in design doc §10. Economy constants live in the `ECONOMY` object at the top; never scatter coin values elsewhere.
- [wheel.js](src/wheel.js) — letter wheel + pointer gestures. Hit-testing (`hitIndex`) and selection (`applyHit`) are exported pure functions for testing. Selection is bound to button *index*, not letter value, because wheels can contain duplicate letters.
- [grid.js](src/grid.js), [dictionary-card.js](src/dictionary-card.js) — DOM rendering only.
- [storage.js](src/storage.js) — single-key JSON save. `normalizeSave` is pure: any corrupt/unrecognized data resets to a fresh save.
- [bridge.js](src/bridge.js) — platform abstraction (save/load/haptics/ads/IAP). **Game code must go through `bridge`, never touch `localStorage` or native APIs directly** — this is the one module that gets swapped for native implementations in Phase 2.
- [strings.js](src/strings.js) — all UI copy in one object. No i18n framework.

Screens are `<section>` elements toggled with `hidden` in [index.html](index.html) — no router, no history API. Only one interactive overlay may be open at a time (stacking rules in UI doc §4).

### Level data pipeline (tools/)

`data/levels.json` is **generated — do not hand-edit it**. Pipeline: `fetch-data` downloads `tools/data/enable1.txt` (bonus dictionary) and `tools/data/ecdict.csv` (Chinese translations), then builds `tools/data/wordinfo.json` (frequency + WordNet English definitions + ECDICT Traditional Chinese translations via OpenCC, via [build-wordinfo.py](tools/build-wordinfo.py) run through `uv`), then [generate-levels.mjs](tools/generate-levels.mjs) picks base words per difficulty band, finds subwords via an alphagram index, backtracks a crossword layout (20 attempts per level, best-scored kept), and embeds each target word's definition. RNG is seeded by level id, so output is fully deterministic and diffable. A built-in validator runs last — any invalid level fails the whole batch.

### Testing split (design doc §12)

Only pure logic is auto-tested (`tests/game.test.mjs`): game rules, wheel hit/selection math, save normalization, plus a validator pass over `levels.json`. Unit tests use inline fixtures — never assert on `levels.json` contents, which change on regeneration. UI, animation, and touch feel are manually tested against the §17 acceptance checklist on real devices. Desktop keyboard input in the wheel (letter keys / Backspace / Enter) exists for dev iteration, not for players.

## Constraints worth remembering

- Everything must work fully offline from local files — no runtime network calls, no dictionary/pronunciation APIs, no CDN assets. Pronunciation uses the browser's built-in `speechSynthesis`.
- Data/asset licensing is tracked in design doc §14; the attribution text lives in the About section of index.html. TWL/SOWPODS word lists and the COCA frequency table are prohibited (proprietary/paid).
- Animations should use `transform`/`opacity` only, and respect `prefers-reduced-motion`.
