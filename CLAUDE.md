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
mise run test        # unit tests: bun test (same as bun run test)
mise run lint        # Biome lint + format check (biome.json): bun run lint
mise run check       # lint + test — what CI's PR Check job runs: bun run check
mise run serve       # dev server on :8080 (ES modules need http; opening index.html from file:// won't work)
mise run fetch-data  # download generator inputs → tools/data/ (ENABLE word list; wordfreq+WordNet via uv/python)
mise run gen         # regenerate data/levels/ (requires fetch-data first)
```

Run a single test: `bun test --test-name-pattern='<name>' tests/game.test.mjs`. There is no build step. Runtime is Bun, not Node — `node:*` built-ins (fs, child_process, url) still work since Bun implements them natively.

## Architecture

### Runtime (src/)

`main.js` is the only wiring point — game modules never import each other, and there is no event bus. The single data flow is:

```
wheel.js ──gesture ends(word)──▶ game.submit(word) ──result object──▶ main.js dispatches to grid / HUD / sfx
```

- [game.js](src/game.js) — all level state and win logic, **pure logic, no DOM** (this is what makes it unit-testable). `submit(word)` returns a discriminated result object (`target` / `bonus` / `duplicate` / `invalid`) — the shape is specified in design doc §10. `createGame` accepts an injectable `rng` (default `Math.random`) so hint-cell selection is deterministic in tests. Economy constants live in the `ECONOMY` object at the top; never scatter coin values elsewhere.
- [wheel.js](src/wheel.js) — letter wheel + pointer gestures. Hit-testing (`hitIndex`), selection (`applyHit`), and shuffle permutation (`permutationAt` + `shuffleStep`, Lehmer-code unranking stepped by a golden-ratio coprime step for a deterministic full cycle back to the initial layout) are exported pure functions for testing. Selection is bound to button *index*, not letter value, because wheels can contain duplicate letters.
- [grid.js](src/grid.js), [dictionary-card.js](src/dictionary-card.js) — DOM rendering only. grid.js also exports `snapshotText` (emoji grid for the text-only share — board *shape* only, two colors, no progress; share targets tend to drop text when files are attached, so sharing sends no image) and `snapshotBlob` (canvas PNG for the manual download button — the button is currently `hidden` in index.html, code kept for later: board as spoiler-free colored blocks plus the letter wheel; colors read from CSS variables so it follows the theme). dictionary-card.js also owns `speechSynthesis` pronunciation (`speak`/`stopSpeech`), used by both its speaker button and main.js's auto-pronounce on target hit (§6.1). Its iOS unlock rule is **not** the same as the `<audio>` one below — only a `click` wakes the TTS engine (`touchend`/`pointerdown` were both measured failing) and a drag never produces one, so pure-drag play has no pronunciation until the first tap, re-locking on every page load; design doc §7 has the measurements, don't re-test.
- [redeem.js](src/redeem.js) — redemption-code verification: JWT (alg pinned to ES256) checked with WebCrypto against the `PUBLIC_KEYS` kid→JWK whitelist; single-use tracked by `jti` in the save. Codes are minted locally with `tools/make-code.mjs` (private keys in gitignored `tools/keys/` — never commit them).
- [storage.js](src/storage.js) — single-key JSON save. `normalizeSave` is pure: any corrupt/unrecognized data resets to a fresh save.
- [bridge.js](src/bridge.js) — platform abstraction (save/load/share/ads/IAP). **Game code must go through `bridge`, never touch `localStorage` or native APIs directly** — this is the one module that gets swapped for native implementations in Phase 2.
- [strings.js](src/strings.js) — all UI copy in one object. No i18n framework.

Screens are `<section>` elements toggled with `hidden` in [index.html](index.html) — no router, no history API. Only one interactive overlay may be open at a time (stacking rules in UI doc §4).

### Level data pipeline (tools/)

`data/levels/` is **generated — do not hand-edit it**. Pipeline: `fetch-data` downloads `tools/data/enable1.txt` (bonus dictionary) and `tools/data/ecdict.csv` (Chinese translations), then builds `tools/data/wordinfo.json` (frequency + WordNet English definitions + ECDICT Traditional Chinese translations via OpenCC, via [build-wordinfo.py](tools/build-wordinfo.py) run through `uv`), then [generate-levels.mjs](tools/generate-levels.mjs) picks base words per difficulty band, finds subwords via an alphagram index, backtracks a crossword layout (20 attempts per level, best-scored kept), and embeds each target word's definition. RNG is seeded by level id, so output is fully deterministic and diffable. A built-in validator runs last — any invalid level fails the whole batch. Difficulty curve (3–4 letter wheels for the first 100 levels, ramp to 6 letters by level 300, then mixed bands with occasional easy levels, 500 total) and frequency thresholds live in `BANDS` + `bandFor` in generate-levels.mjs. build-wordinfo.py skips ECDICT `abbr.` senses — abbreviation-only word forms (e.g. "tho") are excluded from target candidates entirely.

Output is one `data/levels/<id>.json` per level plus a `data/levels/index.json` manifest (`{ "count": N }`) — not a single monolithic file. A single `levels.json` embedding every level's English+Chinese definitions grew past 500KB and blocked first paint (`boot()` had to fetch and parse it all before rendering anything). `src/main.js` `boot()` only fetches `index.json`; `startLevel(id)` fetches that level's own file on demand, so first load only pays for the current level (~1–2KB). Two background prefetches warm the HTTP cache so the real fetch hits it: `boot()` fires one for `save.currentLevel` *in parallel with* `index.json` (the saved level id is known without the manifest — awaiting it first would just trade the old waterfall for a new one), and `startLevel` fires one for `id + 1` once the current level is rendered. Both go through `prefetchLevel`, which reads the response body — a `fetch` left unread gets aborted by Safari and may never reach the cache. Biome's formatter/linter skip `data/levels/` (`biome.json` `files.includes`) since it's generated output with its own diffable layout.

### Testing split (design doc §12)

Only pure logic is auto-tested (`tests/*.test.mjs`): game rules, wheel hit/selection math, save normalization, redemption-code verification, plus a validator pass over `data/levels/`. Unit tests use inline fixtures — never assert on `data/levels/` contents, which change on regeneration. UI, animation, and touch feel are manually tested against the §17 acceptance checklist on real devices. Desktop keyboard input in the wheel (letter keys / Backspace / Enter) exists for dev iteration, not for players.

## Doc sync map

Before finishing any change, update the docs that describe what you touched (a Stop hook in `.claude/settings.json` reminds you once per turn). Each fact has one source of truth; the other files named in its row carry only a short summary or pointer that must be kept in sync — never a second full copy:

| You changed | Update |
|---|---|
| Gameplay rules, economy, level algorithm, licensing | design doc section first (source of truth), then CLAUDE.md/README if they summarize it |
| Commands / tasks (mise.toml, package.json) | CLAUDE.md Commands + README 快速開始 |
| Module added/renamed/responsibility moved (src/) | CLAUDE.md Architecture + README 專案結構 |
| Generator pipeline (tools/) | CLAUDE.md pipeline section + README 關卡資料 |
| Project status (deployed, phase done) | `.serena/memories/project-overview.md` only |

`.serena/memories/*` must stay a thin pointer to CLAUDE.md plus status deltas — if you're writing architecture there, it belongs in CLAUDE.md instead.

## Constraints worth remembering

- Everything must work fully offline from local files — no runtime network calls, no dictionary/pronunciation APIs, no CDN assets. Pronunciation uses the browser's built-in `speechSynthesis`.
- Data/asset licensing is tracked in design doc §14; the attribution text lives in the About section of index.html. TWL/SOWPODS word lists and the COCA frequency table are prohibited (proprietary/paid).
- Animations should use `transform`/`opacity` only, and respect `prefers-reduced-motion`.
- Sound effects are WAV files in `assets/sfx/` (iOS Safari won't play OGG; source mapping in assets/sfx/README.md), played via plain `<audio>` elements in main.js — not the Web Audio API, whose `AudioContext.resume()` was measured taking 10+ seconds to unlock on some iOS devices. Two more iOS measurements shape main.js: playback unlock is counted **per element**, so every `<audio>` instance must be played once inside the first gesture (and because that muted unlock playback spans the whole first gesture, `playSfx` must `pause()` before rewinding — unmuting mid-playback only plays the tail); muted playback unlocks permission but not latency, so the same gesture also plays an inline silent WAV **unmuted** to absorb the one-time 191ms first-audible-`play()` block; and `play()` blocks the main thread when called in rapid succession (up to 173ms), so sfx calls go *after* the visual update and no sound fires per-letter during a drag — design doc §7 has the numbers and the history.
