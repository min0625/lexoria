# Lexoria — 專案導覽

架構、指令、模組職責、關卡 pipeline、測試策略、限制條款：**一律看 `CLAUDE.md`**（單一維護點，勿在此複製）。規格細節看 `docs/word-puzzle-game-design.md` + `docs/word-puzzle-ui-screens.md`，程式註解引用其章節（如 §10），改動前先查文件。

此檔只記 CLAUDE.md/文件沒有的狀態：

- Phase 1 已完成：GitHub Pages 已部署（main 分支根目錄，legacy build），網址 https://lexoria.min0625.com/（舊網址 min0625.com/lexoria 會 301 轉址）；§17 驗收清單 18 項已全數真機測過並打勾。
- 下一步：Phase 2 — Capacitor 嵌入 iOS / Android（設計文件 §15），存檔需換掉 `bridge.save/load` 的 native 實作。
- `mise run fetch-data` 只需跑一次（輸出在 tools/data/，已 gitignore）；之後只需 `mise run gen`。
