# Lexoria — 專案導覽

架構、指令、模組職責、關卡 pipeline、測試策略、限制條款：**一律看 `CLAUDE.md`**（單一維護點，勿在此複製）。規格細節看 `docs/word-puzzle-game-design.md` + `docs/word-puzzle-ui-screens.md`，程式註解引用其章節（如 §10），改動前先查文件。

此檔只記 CLAUDE.md/文件沒有的狀態：

- Phase 1 已完成：GitHub Pages 已部署（main 分支根目錄，legacy build），網址 https://lexoria.min0625.com/（舊網址 min0625.com/lexoria 會 301 轉址）；§17 驗收清單**全數真機測過並打勾**（2026-07-22 補完玩家編號／舊存檔補號／專屬兌換碼那 3 項）——Phase 1 驗收完成。
- 音效已整層移除（PR #72），唯一的聲音是答對時的 TTS 發音。兩種實作都敗給 iOS 音訊 session 行為，完整量測與 5 條死路留在設計文件 §13——**要加音效前先讀那節**，不要重走。
- 開場閘門（#gate）現在唯一的職責是喚醒 TTS 引擎（只有 click 叫得醒），拆掉會讓純拖曳的玩家整場沒發音。
- 匯出/匯入存檔：2026-07-22 拍板**暫緩至 Phase 2**（Phase 1 純單機，改 localStorage 本來就行；坑見 `.local.feature-evaluation.md` §3-1／§4）。別再當待辦。
- Phase 1.5 PWA 已實作（2026-07-22，設計文件 §15 Phase 1.5）：§16 原本的「❌ 不做 PWA」已翻案，理由與快取策略在 §2／§16。**Web 版的離線可玩到這一步才第一次真的成立**（在此之前斷網是白屏）。
- Phase 2（Capacitor）**因成本暫緩、不是取消**：需要一台 Mac + Apple $99/年 + Google Play $25，且純 WebView 有 Apple 4.2 被拒風險。等有留存數據或要收錢再啟動；存檔搬遷的做法寫在設計文件 §15 Phase 2。好友邀請碼也押在這一步（要 `Device.getId()` 才成立，理由見 `.local.feature-evaluation.md` §2，別在網頁版重試）。
- `mise run fetch-data` 只需跑一次（輸出在 tools/data/，已 gitignore）；之後只需 `mise run gen`。
