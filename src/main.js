// 進入點與接線（設計文件 §10）：模組之間不互相溝通，資料流一條——
// wheel → game.submit(word) → 結果物件 → 這裡分派給 grid / HUD / 特效。

import { bridge } from './bridge.js';
import { createDictionaryCard, setSpeechDebug, speak, stopSpeech } from './dictionary-card.js';
import { claimStatus, createGame, ECONOMY } from './game.js';
import { createGrid, snapshotBlob, snapshotText } from './grid.js';
import { verifyCode } from './redeem.js';
import { formatUid, loadSave, persist } from './storage.js';
import { strings } from './strings.js';
import { createWheel } from './wheel.js';

const $ = (id) => document.getElementById(id);

// 播一次動畫 class，播完就拆掉：留著的話切到關卡選擇（screen 用 hidden → display:none）
// 再切回來會讓 CSS 動畫整個重播，看起來像按鈕自己動了一下。
// 先移除→強制回流→加回，否則同一個 class 還在時動畫不會重播。
function playOnce(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

// ---- 除錯紀錄：網址帶 ?debug 才收集，設定裡多一顆「複製除錯紀錄」（非正式功能）----
const DEBUG = new URLSearchParams(location.search).has('debug');
const debugLog = [];
function dbg(msg) {
  if (!DEBUG) return;
  debugLog.push(`[${(performance.now() / 1000).toFixed(2)}s] ${msg}`);
}
if (DEBUG) {
  $('btn-debug-copy').hidden = false;
  $('btn-debug-copy').addEventListener('click', async () => {
    await bridge.copy(debugLog.join('\n'));
    $('btn-debug-copy').textContent = '已複製';
    setTimeout(() => {
      $('btn-debug-copy').textContent = '複製除錯紀錄';
    }, 1500);
  });

  // 轉盤拖曳量測：每個手勢結束時記一行。分辨「延遲來自我們的程式」還是「來自繪製 / Safari
  // 自己的輸入管線」——lag 是事件進得慢（rate 低）、事件排隊久（queue 高）、還是畫面畫不動
  // （frame 長）。掛在 window 上被動監聽，不介入轉盤自己的手勢處理。
  let g = null;
  const frameTick = (t) => {
    if (!g) return;
    if (g.lastFrame) g.maxFrame = Math.max(g.maxFrame, t - g.lastFrame);
    g.lastFrame = t;
    g.frames++;
    requestAnimationFrame(frameTick);
  };
  $('wheel').addEventListener('pointerdown', (ev) => {
    g = { t0: ev.timeStamp, moves: 0, maxQueue: 0, maxGap: 0, frames: 0, maxFrame: 0 };
    requestAnimationFrame(frameTick);
  });
  window.addEventListener(
    'pointermove',
    (ev) => {
      if (!g) return;
      g.maxQueue = Math.max(g.maxQueue, performance.now() - ev.timeStamp);
      if (g.lastMove) g.maxGap = Math.max(g.maxGap, ev.timeStamp - g.lastMove);
      g.lastMove = ev.timeStamp;
      g.moves++;
    },
    { passive: true }
  );
  for (const type of ['pointerup', 'pointercancel'])
    window.addEventListener(type, (ev) => {
      if (!g) return;
      const ms = ev.timeStamp - g.t0;
      const n = (v) => v.toFixed(1);
      dbg(
        `drag ${n(ms)}ms moves=${g.moves} rate=${n((g.moves / ms) * 1000)}/s ` +
          `gap.max=${n(g.maxGap)}ms queue.max=${n(g.maxQueue)}ms ` +
          `frames=${g.frames} frame.max=${n(g.maxFrame)}ms`
      );
      g = null;
    });
}

// ---- 靜態文案 ----
$('tutorial-text').textContent = strings.tutorial;
$('rotate-text').textContent = strings.rotateDevice;
$('allclear-text').textContent = strings.allClear;
$('btn-allclear-back').textContent = strings.backToLevels;
$('clear-title').textContent = strings.levelClear;
$('clear-words-hint').textContent = strings.tapWordHint;
$('btn-next').textContent = strings.nextLevel;
$('settings-title').textContent = strings.settings;
$('label-sound').textContent = strings.sound;
$('label-about').textContent = strings.about;
$('label-uid').textContent = strings.playerId;
$('btn-download').textContent = strings.download;
$('redeem-input').placeholder = strings.redeemPlaceholder;
// placeholder 不是可存取名稱：多數輔助技術只在欄位還空著時唸它，開始輸入後就沒有名字了，
// 有些設定下根本不唸。旁邊的［兌換］鈕也標不了它——那顆是動作，不是這格的標籤。
$('redeem-input').setAttribute('aria-label', strings.redeemPlaceholder);
$('btn-redeem').textContent = strings.redeemAction;
$('hint-cost').textContent = `−${ECONOMY.hintCost}`; // 價格唯一來源是 ECONOMY（設計文件 §8）

// ---- 狀態 ----
const save = loadSave();
let levelCount = 0;
let game = null;
let grid = null;
let wheel = null;
let currentLevelId = save.currentLevel;
let replay = false; // 重玩已完成關卡：不存 levelState、過關不給金幣（UI 文件 §3）

const dictCard = createDictionaryCard($('dict-card'));
setSpeechDebug(dbg);

// ---- 沒有音效，只有 TTS 發音（設計文件 §13、§16）----
// 這裡曾經有一整層音效系統，兩種實作都試過、都在 iOS 上輸給同一件事：音訊 session 的行為。
//   - `<audio>` 元素：`play()` 會**同步阻塞主執行緒**（閒置後 191ms，被 TTS 佔過 session 後
//     752ms），轉盤掉幀、連線畫不出來、音效被 TTS 吃掉都是它。為了繞開它長出了元素池、
//     逐元素解鎖、無聲暖機、閘門等待窗口，一百多行，還是修不好。
//   - Web Audio：`start()` 確實是 0.0ms、完全不阻塞，但 iOS 靜音鍵開著時 `AudioContext`
//     醒不過來，`resume()` 實機量到 3163／5124／8974ms——開頭好幾秒的音效全部靜靜地消失，
//     只有等 TTS 真的唸出人聲才會被連帶喚醒。靜音音檔改 loop、改成 -84dB 正弦波都試過，
//     變異度大到分不出有沒有效。
// 於是砍掉整層。代價比看起來小：命中與過關音效**本來就設計成被 TTS 發音取代**（§6.1），
// 無效字有抖動動畫、bonus 有 +N 金幣動畫，兩個留下來的缺口都已經有視覺回饋。
// 多數 iOS 遊戲在靜音模式下本來就是安靜的，這也更貼近平台慣例。
// 別再加回來（§16）——量測與完整經過留在設計文件 §13，不必重測。
// iOS Safari 連續快速點擊仍會叫出文字選取放大鏡，CSS（user-select / touch-action）擋不掉，
// 只能對第二次 touchend preventDefault（設計文件 §4）。跳過互動元素：preventDefault 會吃掉
// 它們的 click/focus/toggle，連點提示鈕會漏拍、勾選框會少切一次；轉盤走 pointer events，不受影響。
// 拖曳結束的那次 touchend 不算一次點擊：轉盤放手後緊接著點格盤上已找到的字（§6.1）必落在
// 350ms 內，被當成連點就吃掉 click，變成「按下去有縮放、卻什麼都沒發生」。判斷用位移門檻，
// 不是把 .cell 加進上面的跳過名單——放大鏡只跟「同一點連點兩下」來，拖過的手勢根本不需要擋，
// 而放行格子等於把放大鏡放回唯一有字（可被選取）的格子上。
let lastTouchEnd = 0;
let touchStart = null; // 這次 touch 的起點；判定為拖曳後設 null
document.addEventListener(
  'touchstart',
  (e) => {
    const t = e.touches[0];
    touchStart = t ? { x: t.clientX, y: t.clientY } : null;
  },
  { passive: true }
);
document.addEventListener(
  'touchmove',
  (e) => {
    // 10px：手指點下去本來就會抖幾 px，門檻太小會把真的連點誤判成拖曳、把放大鏡放回來。
    // 用「起點到目前」而不是逐段位移，繞一圈回到原點的轉盤手勢中途就已經超標，仍算拖曳。
    const t = e.touches[0];
    if (touchStart && t && Math.hypot(t.clientX - touchStart.x, t.clientY - touchStart.y) > 10)
      touchStart = null;
  },
  { passive: true }
);
document.addEventListener(
  'touchend',
  (e) => {
    const tap = touchStart !== null;
    const now = Date.now();
    if (tap && now - lastTouchEnd < 350 && !e.target.closest('button, input, label, a, summary'))
      e.preventDefault();
    lastTouchEnd = tap ? now : 0; // 拖曳不進窗口；留著舊值會讓緊接著的那次點擊接著被誤判
    touchStart = null;
  },
  { passive: false }
);

// 雙指捏合縮放：Android 靠 viewport 的 user-scalable=no 就夠，iOS Safari 從 10 起忽略該設定，
// 只剩 Safari 專屬的 gesture 事件可擋。整頁是固定版面（html/body overflow: hidden），
// 玩家縮放後只會卡在錯位的畫面，沒有內容需要放大來讀（設計文件 §4）。
for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });

// iOS 從別的 App 點連結會用內嵌 WebView（WKWebView）開，它帶了原生的「下拉關閉」手勢。
// 那個手勢屬於外層 App，網頁 JS 無法完全停用；但多數內嵌瀏覽器是靠 WKWebView 內部
// scrollView 在頂端往下 rubber-band 來觸發的。整頁本就是固定版面（html/body overflow: hidden），
// 只有 .level-list 和 .card 真的要捲動（style.css 裡僅有的兩個 overflow-y: auto），於是其餘一律擋掉
// touchmove，讓 scrollView 不 rubber-band → 大幅降低下滑誤觸關閉。關卡列表放行，捲到邊界
// 交給它自己的 overscroll-behavior: none 不外溢。多指一起擋：兩指下滑照樣 rubber-band，
// 而縮放本來就由 gesture*／viewport 擋掉了，這裡多擋不會多吃到任何手勢。
// 不用「往上找可捲動祖先」的通用判斷：那要逐事件讀 scrollHeight／getComputedStyle，
// 轉盤拖曳時每個 touchmove 都會強制一次同步 reflow——正是 wheel.js 特地快取 rect 避開的成本。
// 輸入框放行：iOS 拖曳游標／選字是原生手勢，preventDefault 會吃掉（同上面 touchend 的理由）。
// 這是緩解而非保證：少數自帶 UIPanGestureRecognizer 的內嵌瀏覽器仍擋不掉，
// 根治只能離開內嵌瀏覽器（先「以 Safari 開啟」再加到主畫面，以 standalone 開）——
// 但沒有任何程式在引導這件事，也不打算做，理由見設計文件 §4／§15 Phase 1.5-4。
document.addEventListener(
  'touchmove',
  (e) => {
    if (!e.target.closest('.level-list, .card, input')) e.preventDefault();
  },
  { passive: false }
);

// ---- 畫面切換：顯示/隱藏 section，不做路由（UI 文件 §5）----
function showScreen(name) {
  $('screen-game').hidden = name !== 'game';
  $('screen-levels').hidden = name !== 'levels';
  $('screen-allclear').hidden = name !== 'allclear';
  $('screen-error').hidden = name !== 'error'; // 錯誤畫面也走同一套，重試成功才收得掉
  // 過關卡片／教學是 screen 的兄弟節點，不跟著 hidden 走——離開遊戲畫面時要自己收，
  // 否則換關 fetch 失敗時它會浮在錯誤畫面上（UI 文件 §4：一次只開一層）
  if (name !== 'game') {
    $('overlay-clear').hidden = true;
    $('overlay-tutorial').hidden = true;
    hideTapHint();
  }
  dictCard.hide();
}

function updateCoins() {
  // 金幣圖示由 CSS（.chip.coin::before）畫，這裡只放數字
  $('coin-count').textContent = save.coins;
  $('coin-count-b').textContent = save.coins;
}

// ---- 拼字串顯示區與提示訊息 ----
let previewTimer = 0;
function showPreview(word) {
  clearTimeout(previewTimer);
  const el = $('preview');
  el.className = 'preview';
  el.textContent = word;
}
// #preview 是純視覺的（showPreview 逐字母重寫，掛 aria-live 會整段拖曳都在播報），
// 所以結果訊息另外寫進看不見的 #status live region。900ms 後兩邊一起清空：不清的話，
// 連續兩次同樣的訊息（例如連撞兩個「已找到」）文字沒變、輔助技術就不會再播第二次。
// say 預設等於畫面上那句；只有無效字要分開——那則的「無效」全在抖動動畫裡，
// 畫面上的字就是玩家剛拼的那個字，照抄進 live region 等於什麼都沒說（答對時聽到的也是同一個字）。
function flashPreview(text, cls, say = text) {
  const el = $('preview');
  el.textContent = text;
  el.className = `preview ${cls}`;
  $('status').textContent = say;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    el.textContent = '';
    el.className = 'preview';
    $('status').textContent = '';
  }, 900);
}

// ---- 存檔 ----
function persistProgress() {
  const s = game.getState();
  if (!replay) {
    save.levelState = { foundWords: s.foundWords, revealedCells: s.revealedCells };
  }
  save.foundBonusWords[currentLevelId] = s.foundBonusWords;
  persist(save);
}

// ---- 關卡流程 ----
// 換關的流水號：fetch 期間玩家又點了別關時，舊的那次回來要整個作廢——
// 兩關的檔案大小不同，回應順序不保證跟點擊順序一致，不擋就會停在先點的那關。
let startSeq = 0;

// 把關卡檔暖進瀏覽器 HTTP 快取。一定要把 body 讀完：只丟著不讀的 fetch 在 Safari 會被中止，
// 快取也不見得寫得進去，預取就白做了。
const prefetchLevel = (id) =>
  fetch(`data/levels/${id}.json`)
    .then((r) => r.blob())
    .catch(() => {});

async function startLevel(id) {
  // 流水號要比全破的 early return 更早遞增：不然還在飛的上一次 fetch 回來時 seq 仍然相等，
  // 會把剛切好的全破畫面蓋回遊戲畫面。
  const seq = ++startSeq;
  if (id > levelCount) {
    showScreen('allclear'); // 最後一關破完 → 全破畫面（§7）
    return;
  }
  // 換關期間舊的 grid/wheel 還掛在畫面上但 game 已經不對應——先拆掉，避免 fetch 還沒回來時
  // onCellTap/hint/share 摸到已經過期的狀態（它們都是靠 !game 判斷「還沒準備好」）。
  game = null;
  wheel?.destroy();
  wheel = null;
  // 查詞提示要在 fetch 之前就收掉，不是等關卡回來才收：兌換碼跳關這類路徑進來時它可能還開著，
  // 留著就會停在上一關格盤的座標上蓋著載入畫面（同 onWin 收它的理由）。
  hideTapHint();
  $('grid').innerHTML = `<p class="loading-text">${strings.loading}</p>`;
  let level;
  try {
    const res = await fetch(`data/levels/${id}.json`);
    if (!res.ok) throw new Error(res.status); // 404 的內文未必是 JSON，靠 parse 失敗才發現太碰運氣
    level = await res.json();
  } catch {
    if (seq === startSeq) showLoadError();
    return;
  }
  if (seq !== startSeq) return; // 這次已被後來的換關取代
  currentLevelId = id;
  replay = id !== save.currentLevel;
  const state = replay
    ? { foundBonusWords: save.foundBonusWords[id] ?? [] }
    : { ...save.levelState, foundBonusWords: save.foundBonusWords[id] ?? [] };
  game = createGame(level, state);
  grid = createGrid($('grid'), level, { onCellTap, isFound: game.isFound });
  grid.update(game.getCells(), false);
  wheel = createWheel($('wheel'), level.letters, { onChange: showPreview, onSubmit });
  $('btn-level').textContent = strings.levelTitle(id);
  updateCoins();
  $('overlay-clear').hidden = true;
  $('overlay-tutorial').hidden = !(id === 1 && !save.settings.tutorialDone);
  showScreen('game');
  showTapHint(); // 要等 showScreen 之後才量得到版面；該不該出現由 showTapHint 自己判斷
  // 玩這關的期間先把下一關的檔案暖進瀏覽器快取，按「下一關」時 startLevel() 的 fetch 直接命中。
  if (id + 1 <= levelCount) prefetchLevel(id + 1);
}

// 查詞提示（UI 文件 §4-F 第二段）：貼著格盤下緣，刻意不跟滑字教學共用轉盤上方那個位置——
// 兩段疊在同一格會被當成同一句話忽略掉，而且這句講的是格盤，眼睛卻被帶去看轉盤。
// 也刻意各用一個節點：兩段的位置、生命週期、完成旗標都不同，共用一個節點就得在過關、換關、
// 點開查詞、換畫面四處手動同步狀態，漏一處就會殘留在下一關的載入畫面上。
// 後期大盤面會填滿整個 .grid-area，那時夾在區域下緣：寧可疊在最後一列上，也不要溢出去壓到預覽列
//（用元素自己的高度夾，字級是 rem，寫死 px 在放大字型時就會壓到預覽列）。夾住時一定會疊到格子
// ——格盤高度由 cqh 決定，剛好等於容器內容框，沒有空隙可躲——所以文字有實心膠囊底（style.css
// .tutorial.at-grid），否則會跟底下的粗體字母糊成一團。
function placeTapHint() {
  const el = $('tap-hint');
  const area = $('grid').getBoundingClientRect();
  // 格盤一定已經 render：載入中提示是空的（hideTapHint），showTapHint 只在 render 之後叫得動
  const board = $('grid').firstElementChild.getBoundingClientRect();
  el.style.top = `${Math.min(board.bottom + 10, area.bottom - el.offsetHeight)}px`;
}

// 開關一律走文字空／不空，不用 hidden：aria-live 區塊只要離開過無障礙樹（hidden／display:none），
// 下次寫入就被當成「新插入的子樹」而不是既有 live region 的變更，多數輔助技術不會播報（APG）。
// 節點因此常駐，收起來的樣子交給 style.css 的 #tap-hint:empty。
function hideTapHint() {
  $('tap-hint').textContent = '';
}

// 所有條件都在這裡擋，不擺在呼叫點：四個入口各判一次遲早漏一個，而且重複呼叫不是白工——
// 重寫 textContent 會讓 aria-live 每找到一個字就再報一次同一句，placeTapHint 也會在手勢剛結束的
// 熱路徑上多逼一次同步版面計算（盤面尺寸沒變，量了也是同一個值）。
// 條件是「格盤上有字可以點了」，不是「剛拼出來」（UI 文件 §4-F）——中途離開再回來的人一進關卡
// 就有填好的字可以點，靠提示補滿的也算（§8）。
function showTapHint() {
  const el = $('tap-hint');
  if (save.settings.dictHintDone || el.textContent) return;
  // 閘門蓋著時先不寫：aria-live 一寫就播報，會在玩家還停在「點擊繼續」、格盤還點不到的時候
  // 就唸出這句（續玩已有找到字的關卡必經此路），而文字沒變不會再播第二次。閘門收掉時補叫一次。
  if (!$('gate').hidden) return;
  if (!game?.getState().foundWords.length) return;
  el.textContent = strings.tapWordHint;
  placeTapHint();
}

// top 是量出來的視窗座標，轉向、iOS 網址列收合都會讓它失準——還開著就重量一次
addEventListener('resize', () => {
  if ($('tap-hint').textContent) placeTapHint();
});

function onSubmit(word) {
  const result = game.submit(word);
  switch (result.type) {
    case 'target': {
      const t0 = performance.now();
      grid.update(game.getCells());
      dbg(`grid.update sync ${(performance.now() - t0).toFixed(1)}ms`);
      // 答對目標字自動念一次（§6.1）。這是唯一的聽覺回饋了——音效整層已移除（§13），
      // 引擎叫不出來時就只剩飛入動畫，沒有東西可以退回去補。
      const t1 = performance.now();
      if (save.settings.sound) speak(word, 'wheel');
      dbg(`speak() sync ${(performance.now() - t1).toFixed(1)}ms`);
      if (!save.settings.tutorialDone) {
        save.settings.tutorialDone = true; // 完成第一個字即收掉教學（UI 文件 §4-F）
        $('overlay-tutorial').hidden = true;
      }
      persistProgress();
      if (result.won) onWin();
      else showTapHint();
      break;
    }
    case 'bonus': {
      save.coins += result.coins;
      flashPreview(strings.bonusFound(result.coins), 'good');
      persistProgress();
      updateCoins();
      break;
    }
    case 'duplicate':
      flashPreview(strings.alreadyFound, 'dup'); // 不重播動畫、不重複給金幣（§1）
      break;
    case 'invalid':
      // 無效字的畫面回饋純視覺——沒有音效了（§13）；播報那份要自己說出「不是單字」
      flashPreview(word, 'shake', strings.notAWord(word));
      break;
  }
}

function onWin() {
  // 過關的慶祝感完全交給過關卡片——這裡曾經在「最後一字沒發音」時補一段 jingle（音效已移除，§13）
  const bonusCount = game.getState().foundBonusWords.length;
  if (!replay) {
    save.coins += ECONOMY.clearCoins;
    save.currentLevel = currentLevelId + 1;
    save.levelState = { foundWords: [], revealedCells: [] }; // 過關清空（§9）
    persist(save);
  }
  updateCoins();
  $('clear-title').innerHTML = replay
    ? strings.levelClear
    : `${strings.levelClear} +${ECONOMY.clearCoins} <span class="icon icon-coin"></span>`;
  $('clear-bonus').textContent = replay ? strings.replayNote : strings.bonusFound(bonusCount);
  dictCard.hide(); // 換一批單字前先收掉舊卡片，避免錨點指向已消失的格子
  // 查詞提示要跟著收：過關卡片的背景是半透明模糊，留著會透出來，按「下一關」後還會停在
  // 上一關格盤的座標上、蓋在載入畫面上閃。過關後改由卡片的單字鈕承接「點字查解釋」（§4-C）
  hideTapHint();
  renderClearWords();
  $('overlay-clear').hidden = false;
  // 焦點進卡片本身（tabindex="-1"），VoiceOver 才會唸出「過關！+10 金幣」——不然過關這件事
  // 對讀螢幕的人是完全無聲的（畫面上的慶祝全是視覺）。不進［下一關］鈕：那樣只聽得到
  // 「下一關，按鈕」，仍然不知道剛剛贏了。
  $('overlay-clear').querySelector('.card').focus();
}

// 過關卡片列出本關全部目標字，點字可彈出查詞卡（不強制關閉，UI 文件 §4）
function renderClearWords() {
  const box = $('clear-words');
  box.innerHTML = '';
  for (const entry of game.level.words) {
    const chip = document.createElement('button');
    chip.className = 'clear-word-chip';
    chip.textContent = entry.word;
    chip.addEventListener('click', () => openDict(entry.word, entry, chip));
    box.appendChild(chip);
  }
}

$('btn-next').addEventListener('click', () => {
  $('overlay-clear').hidden = true;
  dictCard.hide();
  startLevel(currentLevelId + 1);
});

// ---- 提示（§8）----
$('btn-hint').addEventListener('click', () => {
  if (!game) return; // 關卡資料還在 fetch 中（boot 或換關），同 btn-share 的守衛
  const result = game.useHint(save.coins);
  if (!result.ok) {
    // 金幣不足 → 按鈕抖動並強調價格，不彈購買視窗
    playOnce($('btn-hint'), 'shake');
    flashPreview(strings.noCoins, 'dup');
    return;
  }
  save.coins -= result.cost;
  grid.update(game.getCells());
  stopSpeech(); // 提示揭完一個字時上一個字可能還在念，收掉（§6.1 不疊播）
  persistProgress();
  updateCoins();
  if (result.won) onWin();
  // 提示補滿的字同樣算找到（§8），格盤上就多了一個可以點的字——卡到要花金幣的人反而更想知道
  // 那個字是什麼意思。只揭一格、整字還沒補滿時 showTapHint 自己會擋（沒有新的可點字）。
  else showTapHint();
});

// ---- 定時領取金幣（§8）：每 4 小時一份、不累積，邏輯在 game.js 的 claimStatus ----
// 倒數顯示的分鐘數：剛領完（剩恰好 4 小時整）要顯示 3:59 而非 4:00，
// 純 floor 在整分邊界會多顯示一分鐘，ceil−1 讓邊界也落在下一格（最後一分鐘走秒級顯示，不經這裡）
const claimMinutes = (remainingMs) => Math.ceil(remainingMs / 60_000) - 1;
const CLAIM_FINAL_MS = 60_000; // 最後一分鐘逐秒倒數——守著歸零領獎的儀式感窗口
let claimTimer = 0;
let claimWasReady = null; // 上次刷新是否可領：偵測「歸零瞬間」才播彈跳，開頁初次刷新不播
function updateClaim() {
  const { ready, remainingMs } = claimStatus(save.lastClaimAt);
  const btn = $('btn-claim');
  btn.classList.toggle('cooling', !ready); // 冷卻中仍可點——點了會解釋倒數的意思
  // 彈跳播完就卸掉 .pop：#btn-claim.pop（id）比共用的 .shake 特異性高，
  // 留著會讓冷卻中點擊的抖動整個不播（class 加了但 animation 仍解析成 pop）
  if (!ready) btn.classList.remove('pop');
  clearTimeout(claimTimer);
  if (ready) {
    btn.textContent = strings.claimReady(ECONOMY.claimCoins);
    btn.setAttribute('aria-label', strings.claimLabel); // 「+25」對螢幕閱讀器太隱晦，補上動作名
    // 從倒數翻成可領（守到歸零，或切回分頁時剛好過期）→ 彈跳登場
    if (claimWasReady === false) playOnce(btn, 'pop');
  } else if (remainingMs <= CLAIM_FINAL_MS) {
    // 進入秒級的那一刻 remainingMs 幾乎剛好 60000（setTimeout 只會晚不會早），
    // ceil 會先閃一格「60 秒」——夾到 59，秒級倒數才真的從 59 開始
    btn.textContent = strings.claimSeconds(Math.min(59, Math.ceil(remainingMs / 1000)));
    btn.setAttribute('aria-label', strings.claimWait(0, 1));
    claimTimer = setTimeout(updateClaim, remainingMs % 1000 || 1000); // 對齊秒界
  } else {
    const m = claimMinutes(remainingMs);
    btn.textContent = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    btn.setAttribute('aria-label', strings.claimWait(Math.floor(m / 60), m % 60)); // 「3:59」讀不出倒數意涵
    // 平常每分鐘醒一次就好；快進最後一分鐘時提早醒來銜接秒級倒數
    claimTimer = setTimeout(updateClaim, Math.min(60_000, remainingMs - CLAIM_FINAL_MS));
  }
  claimWasReady = ready;
}
$('btn-claim').addEventListener('click', () => {
  const { ready, remainingMs } = claimStatus(save.lastClaimAt);
  if (!ready) {
    // 同提示鈕金幣不足的模式：抖動 + 說明訊息，讓倒數不會被誤讀成限時
    playOnce($('btn-claim'), 'shake');
    if (remainingMs <= CLAIM_FINAL_MS) {
      flashPreview(strings.claimAlmost, 'good'); // 最後一分鐘：承認他在等，不再報時
    } else {
      const m = claimMinutes(remainingMs);
      flashPreview(strings.claimWait(Math.floor(m / 60), m % 60), 'dup');
    }
    return;
  }
  save.lastClaimAt = Date.now();
  save.coins += ECONOMY.claimCoins;
  persist(save);
  flashPreview(strings.claimSuccess(ECONOMY.claimCoins), 'good');
  updateCoins();
  updateClaim();
});
// 分頁退到背景時計時器被凍結，切回來可能顯示過期倒數（甚至其實已可領）——回前景立刻補刷一次
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updateClaim();
});
updateClaim();

// ---- 查詞卡片（§6）：只有已找到的字能查 ----
// 彈卡 + 記下「玩家已經知道可以點了」。格盤的格子與過關卡片的單字鈕共用這段，但參數是
// 已經查好的 entry 而不是字串：按「下一關」到新關卡 fetch 回來這段期間 game 是 null，
// 而過關卡片還在畫面上、單字鈕還點得到——這條路不能碰 game。
// learned = 這一次點得算「學會格盤可以點」，只有格盤那條路傳 true。過關卡片的單字鈕本來就是
// <button>、長得就像按鈕，點它學到的是「這些膠囊可以點」，推不出「格盤上的字磚也可以點」——
// 而後者正是這句提示存在的唯一理由（UI 文件 §4-F）。何況完成最後一個字時過關卡片馬上蓋上來，
// 玩家根本沒機會在格子上點，第一次接觸查詞卡幾乎必然是從單字鈕：兩者算同一件事的話，
// 相當比例的玩家會在從沒點過格子的情況下永久失去提示。預設 false，日後多一個入口不會誤殺。
function openDict(word, entry, anchorEl, learned = false) {
  dictCard.show(word, entry, anchorEl); // word 與 entry 分開傳：dictCard 對 entry 缺漏是容錯的
  if (learned && !save.settings.dictHintDone) {
    save.settings.dictHintDone = true; // 真的在格盤上點過一次才算學會，之後永不再提示
    hideTapHint(); // 只收查詞提示：滑字教學是另一個旗標，收了它 tutorialDone 卻沒推進
    persist(save);
  }
}

function onCellTap(words, cellEl) {
  const word = words.find((w) => game.isFound(w));
  if (!word) return; // 未找到的字點了沒反應（否則變相洩題，§6.1）
  const entry = game.level.words.find((w) => w.word === word);
  openDict(word, entry, cellEl, true);
}

// ---- 關卡選擇（UI 文件 §3）----
function renderLevelList() {
  const list = $('level-list');
  list.innerHTML = '';
  for (let id = 1; id <= levelCount; id++) {
    const b = document.createElement('button');
    b.className = 'level-btn';
    if (id < save.currentLevel) b.innerHTML = `<span class="icon icon-check"></span>${id}`;
    else if (id === save.currentLevel) {
      b.innerHTML = `<span class="icon icon-play"></span>${id}`;
      b.classList.add('current');
    } else {
      b.innerHTML = `<span class="icon icon-lock"></span>${id}`;
      b.disabled = true;
    }
    b.addEventListener('click', () => startLevel(id));
    list.appendChild(b);
  }
}

function showLevels() {
  renderLevelList();
  updateCoins();
  showScreen('levels');
  // 直接捲到目前關卡——玩到後期每次從第 1 關捲下來太折騰；全破時沒有 current 鈕，留在頂部
  $('level-list').querySelector('.current')?.scrollIntoView({ block: 'center' });
}
$('btn-level').addEventListener('click', showLevels);
$('btn-back').addEventListener('click', () => startLevel(currentLevelId));
$('btn-allclear-back').addEventListener('click', showLevels);

// 按鈕暫時閃一句提示、ms 後還原原文（複製類操作沒有別的地方能回饋成功與否）。
// timer 逐顆各自持有：共用一個時，連點兩顆會互相取消還原，把先點的那顆永久卡在提示文案上；
// 連點同一顆時前一顆 timer 也會把新提示提早擦掉，看起來像沒複製到。
function flasher(btn, label, ms) {
  btn.textContent = label;
  let timer = 0;
  return (msg) => {
    btn.textContent = msg;
    clearTimeout(timer);
    timer = setTimeout(() => {
      btn.textContent = label;
    }, ms);
  };
}

// ---- 設定 overlay ----
// 三條關閉路徑（點卡片外、右上角 ✕、Escape）共用這支，才不會有一條忘了把焦點還回去。
function closeSettings() {
  $('overlay-settings').hidden = true;
  // 焦點交還給開卡的那顆齒輪：不還的話焦點落回 body，讀螢幕的人得從畫面最上面重新滑一次
  // 才找得回自己剛才在哪裡。
  $('btn-settings').focus();
}
$('btn-settings').addEventListener('click', () => {
  dictCard.hide(); // 同時只留一個互動 overlay（UI 文件 §4）
  $('opt-sound').checked = save.settings.sound;
  $('redeem-msg').hidden = true; // 上次的兌換結果不留到下次開卡
  $('overlay-settings').hidden = false;
  // 同過關卡：焦點進卡片本身，VoiceOver 會唸出 aria-labelledby 指的「設定」標題。
  // 不進第一顆按鈕，那樣只聽得到「關閉」，不知道自己開了什麼。
  $('overlay-settings').querySelector('.card').focus();
});
// 玩家編號：一輩子不變，填一次就好；點一下複製。
// 複製失敗（非 secure context 沒有 clipboard）也要出文案——按鈕按下去毫無反應使用者不知道
// 發生什麼事，同 bridge.share 的取捨；編號本來就印在鈕上，抄得下來。
// 複製帶分隔線的版本：跟鈕上看到的一字不差，貼進聊天室才不會像複製錯了；
// make-code.mjs 的 normalizeUid 會把分隔符剝掉，帶不帶都簽得出來。
const uidLabel = formatUid(save.uid);
const flashUid = flasher($('btn-uid'), uidLabel, 1500);
$('btn-uid').addEventListener('click', async () => {
  flashUid((await bridge.copy(uidLabel)) ? strings.copied : strings.copyFailed);
});
$('opt-sound').addEventListener('change', (e) => {
  save.settings.sound = e.target.checked;
  persist(save);
});
$('overlay-settings').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSettings(); // 點卡片外關閉
});
$('btn-settings-close').addEventListener('click', closeSettings);
// Escape：桌面鍵盤的退出鍵，跟轉盤的鍵盤輸入（wheel.js）一樣只服務開發迭代，不是玩家的出口
// ——玩家的出口是 ✕ 與點卡片外。由上往下關一層：查詞卡(z 35) 疊在 overlay(30) 之上，
// 兩張都開著時（過關卡片 + 點單字彈出的查詞卡，UI 文件 §4 允許）先關上面那張。
// 過關卡片刻意不接：那是單向流程，跟「點卡片外不關閉」同一條規則（§4-C）。
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('dict-card').hidden) dictCard.hide();
  else if (!$('overlay-settings').hidden) closeSettings();
});
// 分享進度：Wordle 式純文字（emoji 格盤 + 關卡數），內容是目前畫面這一關——重玩舊關時誠實。
// 三顆按鈕共用這套流程，差別全在 buildText：過關報戰績、設定邀人玩、全破報總關數。
function wireShare(btn, label, buildText) {
  // 分享面板關閉後才開始計時；文案較長，給足閱讀時間
  const flash = flasher(btn, label, 2500);
  btn.addEventListener('click', async () => {
    try {
      const text = buildText();
      if (!text) return; // 關卡資料還在 fetch 中（boot 或換關）
      // 分享的網址一律用乾淨的首頁，不是 location.href：進來時網址上帶什麼就會原封不動送出去
      // ——平台補的 ?fbclid=／?utm_source=（sw.js 有註解，等於把別人的追蹤參數再傳一手）、?debug，
      // 以及舊的 ?code= 兌換連結（設計文件 §9 拿掉了自動帶入，但網址還留在 location.search 一整個
      // session，照送就等於把還能用的兌換碼分享出去——那正是 §9 要擋的那件事）。
      const mode = await bridge.share(text, `${location.origin}${location.pathname}`);
      if (mode === 'copied') flash(strings.shareCopied);
      else if (mode === 'failed') flash(strings.shareFailed); // 剪貼簿與分享面板都不可用
    } catch {
      // bridge.share 不會 throw（剪貼簿／取消都在裡面吞掉），這裡只兜底文案組裝出錯
    }
  });
}
// cleared：過關卡片上那顆才報額外單字數，設定裡那顆只說在玩哪一關。
// 字母排序後才附上：getLetters 給的是洗牌後的視覺順序（快照圖要跟畫面對得上才這樣設計），
// 但純文字裡沒有畫面可對，未排序的話同一關分享兩次字母串就不一樣，看起來像亂碼而不是字母組。
const levelShareText = (cleared) => () =>
  game && wheel
    ? strings.shareText(
        currentLevelId,
        [...wheel.getLetters()].sort(),
        snapshotText(game.getCells()),
        cleared ? game.getState().foundBonusWords.length : null
      )
    : null;
wireShare($('btn-share'), strings.share, levelShareText(false));
wireShare($('btn-share-clear'), strings.shareScore, levelShareText(true));
// 全破畫面：startLevel 走的是 early return，game/wheel 還停在最後一關，秀那張盤面沒有意義
wireShare($('btn-share-allclear'), strings.shareScore, () => strings.shareAll());
// 快照圖（含 wheel 目前排列）改為手動下載——帶檔分享時多數目標會丟 text，圖只給想要的人
$('btn-download').addEventListener('click', async () => {
  if (!game || !wheel) return;
  try {
    const blob = await snapshotBlob(
      game.getCells(),
      wheel.getLetters(),
      strings.shareImageTitle(currentLevelId)
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lexoria-${currentLevelId}.png`;
    document.body.append(a); // Firefox 不會觸發未掛進文件的 <a> 的下載
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); // 立即 revoke 可能搶在下載開始前
  } catch {
    // canvas.toBlob 失敗——靜默即可
  }
});

// ---- 兌換碼（設計文件 §9）：JWT 驗簽在 redeem.js，這裡只套用效果 ----
function showRedeemMsg(text) {
  $('redeem-msg').textContent = text;
  $('redeem-msg').hidden = false;
}
$('btn-redeem').addEventListener('click', async () => {
  // 舊的 `?code=…` 兌換連結（設計文件 §9 已移除）發出去的仍在玩家手上，點進來不會有任何反應，
  // 他們只會把整串網址貼進來——切掉前綴當作收下。JWT 是 base64url，本身不可能含 `code=`。
  const token = $('redeem-input').value.trim().split('code=').pop();
  if (!token) return;
  const result = await verifyCode(token, {
    redeemed: save.redeemedCodes,
    uid: save.uid,
  }).catch(() => ({ ok: false, reason: 'invalid' }));
  if (!result.ok) {
    const msg = {
      expired: strings.redeemExpired,
      used: strings.redeemUsed,
      wrongUid: strings.redeemWrongUid,
    }[result.reason];
    showRedeemMsg(msg ?? strings.redeemInvalid);
    return;
  }
  const { jti, effect } = result;
  if (effect.type === 'level' && effect.id <= save.currentLevel) {
    showRedeemMsg(strings.redeemBehind); // 沒有效果就不消耗碼（設計文件 §9）
    return;
  }
  // 簽發端讀自己那份 index.json 把關，擋不住「碼比這台裝置手上的關卡新」：SW 是
  // stale-while-revalidate，剛推完新關卡那一趟載入拿到的仍是舊的 index.json（設計文件 §2）。
  // 沒有這道防線就會把 currentLevel 寫成 levelCount 以外的值，之後每次開場都直接掉進全破畫面
  // 而且再也回不來（startLevel 的 id > levelCount 分支）。同樣不消耗碼——關卡上線後還能再兌。
  if (effect.type === 'level' && effect.id > levelCount) {
    showRedeemMsg(strings.redeemNoLevel);
    return;
  }
  if (effect.type === 'coins') {
    save.coins += effect.amount;
    showRedeemMsg(strings.redeemCoins(effect.amount));
  } else {
    save.currentLevel = effect.id;
    save.levelState = { foundWords: [], revealedCells: [] }; // 換關即作廢，同過關語意（§9）
    showRedeemMsg(strings.redeemLevel(effect.id));
  }
  save.redeemedCodes.push(jti);
  persist(save);
  updateCoins();
  $('redeem-input').value = '';
  if (effect.type === 'level') startLevel(effect.id); // 上面已保證 1 <= effect.id <= levelCount
});

// ---- 啟動 ----
// 取不到關卡資料（斷網、部署中 404）→ 顯示重試畫面，不留白屏；boot() 跟換關的 fetch 共用。
function showLoadError() {
  $('error-text').textContent = strings.loadFailed;
  $('btn-reload').textContent = strings.retry;
  $('gate').hidden = true; // 錯誤要馬上看得到，別讓閘門壓著；重試鈕本身也是 click，解鎖不會漏
  showScreen('error');
}
$('btn-reload').addEventListener('click', () => location.reload());
// 閘門的 click 本身就是 TTS 的解鎖手勢（listener 掛在 dictionary-card.js 的 document 上），
// 這裡只管收掉。點了就收——曾經為了等音效解鎖而延後並顯示「準備中…」，音效移除後沒有東西
// 要等了（設計文件 §13）。
$('gate').addEventListener('click', () => {
  $('gate').hidden = true;
  dbg('gate hidden');
  showTapHint(); // 閘門蓋著時 showTapHint 不寫（會提早播報），收掉才補這一次
});

(async function boot() {
  // 開場閘門（UI 文件 §1-I）：關卡載入照常在背後跑，閘門只是等一下 click，不拖慢首屏。
  $('gate-level').textContent = strings.levelTitle(save.currentLevel);
  // 當前關卡 id 從存檔就知道，不必等 index.json 回來——兩支同時發，首屏省一趟 RTT。
  // 這裡只負責把檔案暖進 HTTP 快取，真正的取用還是 startLevel() 自己那次 fetch。
  prefetchLevel(save.currentLevel);
  try {
    const res = await fetch('data/levels/index.json');
    if (!res.ok) throw new Error(res.status); // 同 startLevel：404 內文未必是 JSON
    ({ count: levelCount } = await res.json());
    if (!Number.isInteger(levelCount) || levelCount < 1) throw new Error('bad index');
  } catch {
    showLoadError();
    return;
  }
  startLevel(save.currentLevel);
})();

// PWA：service worker 只負責離線可開與二次載入加速，遊戲邏輯完全不知道它存在（sw.js 有策略說明）。
// 等 load 之後才註冊——安裝當下要把整份 SHELL 預快取起來，跟首屏的關卡 fetch 搶頻寬不划算。
// 非 secure context（LAN IP 真機測試）沒有 navigator.serviceWorker，?. 直接短路整串。
// 首次安裝那一趟頁面還沒被接管，boot()/startLevel() 的關卡 fetch 全部繞過 SW，Cache Storage
// 裡只有 SHELL、沒有任何關卡——裝完就斷網重開會拿到載入失敗畫面。clients.claim() 接管時把
// startLevel() 那兩趟（當前關 + 下一關）補回來，這趟才真的離線可玩：只補當前關的話，玩家
// 破完這關按「下一關」還是會撞上載入失敗。之後的載入本來就被接管，只有推新版 sw.js 時
// （skipWaiting + claim）才會再觸發一次，成本是重抓兩個 1–2KB 的關卡檔。
addEventListener('load', () => {
  navigator.serviceWorker?.register('sw.js').catch(() => {});
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    prefetchLevel(currentLevelId);
    if (currentLevelId + 1 <= levelCount) prefetchLevel(currentLevelId + 1);
  });
});
