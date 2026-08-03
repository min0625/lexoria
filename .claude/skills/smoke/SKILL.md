---
name: smoke
description: Drive Lexoria in a real browser to confirm a change actually works. Use when asked to "run the smoke test", "跑一下 smoke", "開起來看看", "確認遊戲還能玩", or after changing src/, index.html, or sw.js and tests alone aren't enough. Covers only the desktop-verifiable half of design doc §17 — never報「§17 全過」.
---

# Lexoria smoke test

`bun run test` 只涵蓋純邏輯（§12）。這份跑的是「頁面真的還能玩」——DOM、存檔、過關流程。

先 `agent-browser skills get core` 拿指令語法，本檔只列步驟。

## 起服務

```sh
bun run serve   # :8080，背景跑；ES modules 需要 http，file:// 開不起來
```

跑完把它關掉。

## 步驟（第 1 關 = C/T/A，目標字 ACT、CAT）

字母如果對不上，直接讀 `data/levels/1.json`——那是產生器輸出，改過參數就會變。

用**鍵盤**拼字，不要合成拖曳的 pointer 序列：`wheel.js` 有開發期鍵盤輸入（字母鍵選字、Backspace 退一個、Enter 送出，§12）。注意 `keyboardBlocked`——閘門或任何 overlay 開著時鍵盤是無效的，卡住先看是不是有東西沒關掉。

`press` 打在 document focus 上就行，不必先 focus 轉盤。重新整理 = 再 `open` 一次。
以下這串 2026-08-03 實跑過，斷言值是當時的實際輸出：

```sh
agent-browser open http://localhost:8080/
agent-browser snapshot -i                       # 閘門是第一顆 button
agent-browser click @e1                         # 1. 點掉閘門（要的是 click，鍵盤沒用）
for k in a c t Enter; do agent-browser press $k; done          # 2. 拼 ACT
agent-browser eval "document.getElementById('grid').innerText" # → 含 ACT

agent-browser open http://localhost:8080/       # 3. 重整
agent-browser snapshot -i && agent-browser click @e1
agent-browser eval "document.getElementById('grid').innerText" # → ACT 還在（存檔）

for k in c a t Enter; do agent-browser press $k; done          # 4. 拼 CAT → 過關
agent-browser eval "document.getElementById('clear-title').innerText"
# → "第 1 關\n過關！ +10"（+10 在標題裡，#clear-bonus 是 bonus 字專用，第 1 關沒有）

agent-browser eval "document.getElementById('btn-next').click(); 1"   # 5. 下一關
agent-browser eval "document.getElementById('btn-level').innerText"   # → 第 2 關（金幣 60）

agent-browser eval "localStorage.setItem('lexoria-save','{{'); 1"     # 6. 壞存檔
agent-browser open http://localhost:8080/
agent-browser snapshot -i && agent-browser click @e1
agent-browser eval "document.getElementById('wheel').innerText"
# → CTA、金幣 50、格盤空 = 重置成初始存檔，沒白屏（normalizeSave）

agent-browser close --all
```

任何一步卡住，先看 console——`main.js` 的載入錯誤會走 `#screen-error` 而不是丟例外。

## 這份測不到的

VoiceOver 播報、iOS 分享面板、`pointer: coarse` 的轉向遮罩、TTS 發音、動畫手感——全部只有真機驗得準（§12、§17）。**跑綠了只代表桌機那半沒壞**，別在 §17 上打勾。
