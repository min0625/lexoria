# Lexoria

Wordscapes 風格的英文單字拼圖遊戲：從字母轉盤滑選字母拼出單字，填入交叉字謎格。純 Vanilla JS + ES Modules，無框架、無打包、無後端，完全離線可玩。介面為正體中文；單字釋義為正體中文（ECDICT）+ 英文（WordNet）。

## 快速開始

需要 [mise](https://mise.jdx.dev/)（或自行安裝 [Bun](https://bun.sh/)）：

```sh
mise run serve   # 開發伺服器 http://localhost:8080（ES modules 需經 http，直接開 index.html 不行）
mise run test    # 單元測試（= bun test）
mise run lint    # Biome 靜態檢查 + 格式檢查（= bun run lint；bun run fix 可自動修正）
mise run check   # lint + test，PR Check 會跑這個（= bun run check）
```

跑單一測試：`bun test --test-name-pattern='<名稱>' tests/game.test.mjs`。沒有 build step。

## 關卡資料

`data/levels.json` 是產生出來的，**不要手改**；要改關卡就改產生器再重跑：

```sh
mise run fetch-data  # 下載產生器輸入（ENABLE 字表、ECDICT、wordfreq、WordNet；只需跑一次，需 uv）
mise run gen         # 重新產生 data/levels.json（以關卡 id 為種子，輸出完全可重現）
```

難度曲線與字頻門檻在 [tools/generate-levels.mjs](tools/generate-levels.mjs) 的 `BANDS`。

## 專案結構

```
index.html          畫面骨架（<section> 以 hidden 切換，無 router）
src/
  main.js           唯一接線點：wheel → game.submit(word) → 結果分派給 grid/HUD/音效
  game.js           關卡狀態與規則，純邏輯無 DOM（可單元測試）；經濟數值在 ECONOMY
  wheel.js          字母轉盤與指標手勢（hitIndex/applyHit/permutationAt 為純函式）
  grid.js           字謎格渲染（含分享用 emoji 文字快照 snapshotText、下載用 canvas 快照 snapshotBlob，下載按鈕暫時隱藏）
  dictionary-card.js 查詢單字卡片
  storage.js        單一 key JSON 存檔（normalizeSave 壞資料一律重置）
  redeem.js         兌換碼驗證（JWT ES256 公鑰驗簽；tools/make-code.mjs 簽發）
  bridge.js         平台抽象層（存檔/震動/分享/廣告/IAP）— Phase 2 換 native 實作
  strings.js        所有 UI 文案
  style.css         全站樣式
tools/              關卡產生 pipeline（fetch-data → build-wordinfo.py → generate-levels.mjs）＋ make-code.mjs 兌換碼簽發
tests/              純邏輯單元測試 + levels.json 驗證器
docs/               設計文件（單一事實來源，程式註解引用其章節如 §10）
```

設計文件：

- [docs/word-puzzle-game-design.md](docs/word-puzzle-game-design.md) — 玩法規則、架構、關卡產生演算法、經濟數值、驗收清單
- [docs/word-puzzle-ui-screens.md](docs/word-puzzle-ui-screens.md) — 畫面清單、overlay 疊放規則、文案表、色票

## 開發階段

- **Phase 1**：純 Web MVP，500 關，完全離線。
- **Phase 2**：以 Capacitor 嵌入 iOS / Android，替換 `bridge.js` 為 native 實作。

## 授權

程式碼採 [Apache-2.0](LICENSE)。資料與素材：

- 字表：ENABLE（public domain）
- 英文釋義：WordNet®（Princeton University, WordNet License）
- 中文翻譯：ECDICT by Wei Lin（MIT），經 OpenCC（Apache-2.0）轉正體
- 字頻：wordfreq by Robyn Speer（MIT）
- 音效：Kenney "Interface Sounds"（CC0）

完整授權盤點見設計文件 §14。
