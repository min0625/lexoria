# Lexoria

▶ **[立即遊玩](https://lexoria.min0625.com/)**

Wordscapes 風格的英文單字拼圖遊戲：從字母轉盤滑選字母拼出單字，填入交叉字謎格。純 Vanilla JS + ES Modules，無框架、無打包、無後端，完全離線可玩。介面為正體中文；單字釋義為正體中文（ECDICT）+ 英文（WordNet）。

## 快速開始

建議裝 [mise](https://mise.jdx.dev/)：`mise install` 會照 [mise.toml](mise.toml) 裝好 bun、prek（釘版本）與 uv（取 latest）——CI 用 `jdx/mise-action` 讀同一份，**工具**版本只有這一個來源（hook 版本另計，釘在 `.pre-commit-config.yaml` 的 `rev:`）。只裝 [Bun](https://bun.sh/) 也跑得動下面的指令，但拿不到 prek，就沒有 git hook。指令一律走 `bun run`：

```sh
bun install      # 安裝 devDependencies（Biome）
bun run serve    # 開發伺服器 http://localhost:8080（ES modules 需經 http，直接開 index.html 不行）
bun run test     # 單元測試
bun run lint     # Biome 靜態檢查 + 格式檢查，warning 也會擋（bun run fix 可自動修正）
bun run check    # lint + test，prek 那個 local hook（本地與 CI 都跑它）
```

跑單一測試：`bun test --test-name-pattern='<名稱>' tests/game.test.mjs`。沒有 build step。

檢查一律經 [prek](https://prek.j178.dev/)：每個 clone 跑一次 `bun install` 與 `prek install` 裝好相依套件與 git hook（devcontainer 的 `post_create.sh` 已代勞），之後每次 commit 會自動跑 [.pre-commit-config.yaml](.pre-commit-config.yaml) 裡的 hook（upstream 的檔案檢查、`gitleaks` 祕密掃描，加上跑 `bun run check` 的那一個）。手動全跑 `prek run --all-files`，要跳過用 `git commit --no-verify`。PR Check 跑的也是 `prek run --all-files`，所以往後加的 hook 不必再改 workflow——但 `gitleaks` 只擋得住 commit：它的 entry 寫死 `--staged`，CI 沒有 staged 內容、掃的是空 diff 一定綠（原因與升級路徑見 CLAUDE.md，那裡也列了同一類「有跑但沒在量」的其他 hook）。

另外 `pr-check.yml` 的 job `name:` 就是 ruleset 裡 required status check 的 context，**不能隨手改名**，否則 main 的 PR 會等一個永遠不會回報的檢查。

## 關卡資料

`data/levels/`（每關一個 JSON 檔＋一份 `index.json` 索引）是產生出來的，**不要手改**；要改關卡就改產生器再重跑：

```sh
bun run fetch-data  # 下載產生器輸入（ENABLE 字表、ECDICT、wordfreq、WordNet；只需跑一次，需 uv）
bun run gen         # 重新產生 data/levels/ 並套上 Biome 格式（以關卡 id 為種子，輸出完全可重現）
```

前端啟動時只抓 `index.json`（僅關卡數）與當前那一關（兩者並行），其餘關卡在切換過去時才按需 `fetch`，首次載入不必等 500 關資料下載完。

難度曲線與字頻門檻在 [tools/generate-levels.mjs](tools/generate-levels.mjs) 的 `BANDS`。

## 專案結構

```
index.html          畫面骨架（<section> 以 hidden 切換，無 router）
manifest.webmanifest  PWA：主畫面圖示、standalone 全螢幕、直式鎖定（Android；iOS 不吃，見設計文件 §15）
sw.js               service worker：全站 stale-while-revalidate，離線可開
src/
  main.js           唯一接線點：wheel → game.submit(word) → 結果分派給 grid/HUD/發音
  game.js           關卡狀態與規則，純邏輯無 DOM（可單元測試）；經濟數值在 ECONOMY
  wheel.js          字母轉盤與指標手勢（hitIndex/applyHit/permutationAt 為純函式）
  grid.js           字謎格渲染（含分享用 emoji 文字快照 snapshotText、下載用 canvas 快照 snapshotBlob，下載按鈕暫時隱藏）
  dictionary-card.js 查詢單字卡片
  storage.js        單一 key JSON 存檔（normalizeSave 壞資料一律重置）＋玩家編號 uid 產生／驗證
  redeem.js         兌換碼驗證（JWT ES256 公鑰驗簽；tools/make-code.mjs 簽發，--uid 可綁定單一玩家）
  bridge.js         平台抽象層（存檔/分享/複製）— Phase 2 換 native 實作
  strings.js        所有 UI 文案
  style.css         全站樣式
tools/              關卡產生 pipeline（fetch-data → build-wordinfo.py → generate-levels.mjs）＋ make-code.mjs 兌換碼簽發
tests/              純邏輯單元測試（含 bridge.share 的三態決策表）+ data/levels/ 驗證器 + PWA 清單一致性檢查（sw.js SHELL／modulepreload、部署白名單）
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
- 中文翻譯：ECDICT by Linwei（MIT），經 OpenCC（Apache-2.0）轉正體
- 字頻：wordfreq by Robyn Speer（Apache-2.0，僅建置期使用）

WordNet 與 ECDICT 的授權條文全文隨站台散布，見 [assets/licenses.txt](assets/licenses.txt)（遊戲內「設定 → 關於 → License texts」連過去）。

完整授權盤點見設計文件 §14。
