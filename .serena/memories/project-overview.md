# Lexoria — Wordscapes-like 英文填字遊戲（Phase 1 Web MVP）

規格：`docs/word-puzzle-game-design.md`（架構/玩法/數值）＋ `docs/word-puzzle-ui-screens.md`（畫面/文案/色票）。實作嚴格照文件章節走，改動前先查文件。

## 結構
- 純 Vanilla JS + ES Modules，無框架、無打包、無後端（設計 §2）。
- `index.html` → `src/main.js` 接線；模組不互相溝通，資料流：wheel → `game.submit(word)` → 結果物件 → main 分派（§10）。
- `src/game.js`：純邏輯（ECONOMY 數值、createGame/submit/useHint），可注入 rng。
- `src/wheel.js`：`hitIndex`/`applyHit` 為純函式（供測試）；DOM 在 `createWheel`。
- `src/storage.js`：`normalizeSave` 純函式，壞資料一律重置；IO 走 `src/bridge.js`（唯一准碰 localStorage 的模組，Phase 2 換 native）。
- `data/levels.json`：50 關，由 `tools/generate-levels.mjs` 產生（§5：alphagram 索引+回溯擺放+20 版挑最佳+末端驗證器；種子=關卡 id，重跑輸出 byte-identical）。手改無意義，要改關卡就改產生器再 `mise run gen`。
- `tools/fetch-data.mjs`（+`build-wordinfo.py`，經 uv 跑 wordfreq/NLTK）：下載 ENABLE 字表與產出 `tools/data/wordinfo.json`（字頻+WordNet 釋義）；產生器的離線輸入，只需跑一次。

## 工作流
- 測試：`mise run test`（= `node --test 'tests/**/*.test.mjs'`）。tests/game.test.mjs 內含關卡驗證器（交叉一致/相鄰規則/連通/可組成），改 levels.json 必跑；邏輯測試用檔內 fixtures（原手刻第 1、2 關），不依賴產生器輸出。
- 關卡：`mise run fetch-data`（一次）→ `mise run gen`。難度曲線/字頻門檻在 generate-levels.mjs 的 `BANDS`。
- 本地跑：`mise run serve`（npx serve）。
- 音效：Kenney Interface Sounds（CC0）轉 WAV 放 `assets/sfx/`（iOS Safari 不吃 OGG；來源對照見 assets/sfx/README.md），main.js 以 Web Audio decodeAudioData 播放、手勢內 resume。
- 尚未做：部署靜態託管+真機測試（Phase 1 第 7 項，需使用者操作）、Capacitor（Phase 2）。
