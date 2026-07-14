# Lexoria — 專案導覽

架構、指令、模組職責、關卡 pipeline、測試策略、限制條款：**一律看 `CLAUDE.md`**（單一維護點，勿在此複製）。規格細節看 `docs/word-puzzle-game-design.md` + `docs/word-puzzle-ui-screens.md`，程式註解引用其章節（如 §10），改動前先查文件。

此檔只記 CLAUDE.md/文件沒有的狀態：

- 尚未做：部署靜態託管 + 真機測試（設計文件 §15 Phase 1 規劃第 7 項，需使用者操作）；Capacitor 嵌入（Phase 2）。
- `mise run fetch-data` 只需跑一次（輸出在 tools/data/，已 gitignore）；之後只需 `mise run gen`。
