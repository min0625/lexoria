// 進入點與接線（設計文件 §10）：模組之間不互相溝通，資料流一條——
// wheel → game.submit(word) → 結果物件 → 這裡分派給 grid / HUD / 特效。

import { bridge } from './bridge.js';
import { createDictionaryCard, setSpeechDebug, speak, stopSpeech } from './dictionary-card.js';
import { claimStatus, createGame, ECONOMY } from './game.js';
import { createGrid, snapshotBlob, snapshotText } from './grid.js';
import { verifyCode } from './redeem.js';
import { loadSave, persist } from './storage.js';
import { strings } from './strings.js';
import { createWheel } from './wheel.js';

const $ = (id) => document.getElementById(id);

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
    await navigator.clipboard.writeText(debugLog.join('\n')).catch(() => {});
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
$('clear-words-hint').textContent = strings.clearWordsHint;
$('btn-next').textContent = strings.nextLevel;
$('settings-title').textContent = strings.settings;
$('label-sound').textContent = strings.sound;
$('label-about').textContent = strings.about;
$('btn-download').textContent = strings.download;
$('redeem-input').placeholder = strings.redeemPlaceholder;
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

// ---- 音效：Kenney Interface Sounds（CC0），本地 wav（§7、§14）----
// 原本走 Web Audio API（AudioContext + decodeAudioData），但實機診斷（?debug 面板）
// 量到 AudioContext.resume() 在部分 iOS 裝置上要拖到 10~15 秒才真正轉成 running，
// 期間所有音效都被吞掉；相同裝置上 <audio> 元素的 play() 卻是手勢當下就立刻 resolve。
// 這款遊戲的音效都是獨立短音、不需要 Web Audio 的混音圖，所以直接改用 <audio>
// 元素——不必自己管 AudioContext 狀態機，也不受這個 resume() 延遲影響。
// 0.05 秒的 8kHz 8-bit mono 數位靜音（8-bit PCM 的靜音是 128 不是 0），內嵌成 data URI 免得
// 為了一段無聲多一個資產檔和一次 fetch。只用來暖機，見下面 pointerdown 解鎖裡的說明。
const SILENT_WAV =
  'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

const sfxAudio = {};
const SFX = {};
for (const name of ['target', 'invalid', 'coin', 'clear']) {
  const el = new Audio(`assets/sfx/${name}.wav`);
  el.preload = 'auto';
  sfxAudio[name] = el;
  SFX[name] = () => playSfx(name);
}
// iOS 對「手勢內播放才允許自動播放」的解鎖是分別針對每個 <audio> 元素算的，不是整頁一次
// 就全解鎖——沒有在手勢當下播過的元素，第一次真的要播時已經不在手勢裡，會被 NotAllowedError
// 擋掉（症狀：invalid/target/coin/clear 偶爾被吃掉）。所以第一個手勢裡把每顆音效都靜音播
// 一次再馬上暫停歸零，一次把全部解鎖。
document.addEventListener(
  'pointerdown',
  () => {
    // 靜音播放解得開「權限」，卻解不開「延遲」：實機量到第一次**真正出聲**的 play() 會同步
    // 阻塞主執行緒 191ms（之後每次都只要 4~6ms，且當下 readyState 已經是 4、不是緩衝問題），
    // 因為系統音訊輸出要到這時才真的啟用，靜音播放付不到這筆帳。結果那 191ms 就落在玩家第一次
    // 拼錯的瞬間（答對時 TTS 出聲的話 <audio> 根本不會被呼叫，所以帳單通常由 invalid 承擔）。
    // 這裡在同一個手勢裡「不靜音」播一段真正無聲的 wav，把這筆帳挪到手勢當下付掉——那一刻玩家
    // 才剛按下、沒有任何畫面等著更新，191ms 看不出來（設計文件 §7）。
    new Audio(SILENT_WAV).play().catch((e) => dbg(`warmup FAILED: ${e}`));
    for (const [name, el] of Object.entries(sfxAudio)) {
      el.muted = true;
      el.play().then(
        () => {
          dbg(`unlock(${name}) ok`);
          // 解除靜音是非同步的，解鎖跟第一次真的播放會落在同一個手勢裡：playSfx 已經把
          // muted 設回 false 就代表這顆被真的播放接手了，這裡再 pause 會把聲音掐掉。
          if (!el.muted) return;
          el.pause();
          el.currentTime = 0;
          el.muted = false;
        },
        (e) => {
          // playSfx 在同一個手勢裡接手時會 pause()，把這個 play() 中止成 AbortError——
          // 那不是解鎖失敗（已經在手勢內播過就算解鎖），別在 debug 面板謊報。
          if (e.name === 'AbortError') return;
          dbg(`unlock(${name}) FAILED: ${e}`); // 這顆之後很可能整場都放不出聲音
          el.muted = false;
        }
      );
    }
  },
  { once: true, capture: true }
);
// iOS Safari 連續快速點擊仍會叫出文字選取放大鏡，CSS（user-select / touch-action）擋不掉，
// 只能對第二次 touchend preventDefault（設計文件 §4）。跳過互動元素：preventDefault 會吃掉
// 它們的 click/focus/toggle，連點提示鈕會漏拍、勾選框會少切一次；轉盤走 pointer events，不受影響。
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 350 && !e.target.closest('button, input, label, a, summary'))
      e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false }
);

function playSfx(name) {
  dbg(`playSfx(${name}) called, sound=${save.settings.sound}`);
  if (!save.settings.sound) return;
  const el = sfxAudio[name];
  // seek 和 play() 分開量：合在一起量會分不出是倒帶貴還是播放貴（實測全部是 play()）。
  const t0 = performance.now();
  // 先 pause 再倒帶：解鎖的靜音播放可能還在跑（第一個手勢內 pointerdown 解鎖、pointerup 播音效），
  // 直接 muted=false 等於從半途解除靜音，而 currentTime 的 seek 是非同步的、來不及生效——
  // 聽到的是尾巴，症狀就是第一次載入時音效延遲／變小聲／整個沒聲音。暫停後 seek 才會確實歸零。
  el.pause();
  el.currentTime = 0;
  el.muted = false; // 解鎖可能還靜音著（同一個手勢內），真的要播就蓋過去
  const t1 = performance.now();
  el.play().catch((e) => dbg(`playSfx(${name}) play() REJECTED: ${e}`));
  const t2 = performance.now();
  dbg(
    `playSfx(${name}) stop+seek ${(t1 - t0).toFixed(1)}ms play ${(t2 - t1).toFixed(1)}ms ` +
      `paused=${el.paused} ready=${el.readyState} muted=${el.muted} vol=${el.volume}`
  );
}

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
// 這裡本來每選到一個字母就播一次 tick，已拿掉。實機量測（?debug）：<audio> 的 play() 被連續
// 快速呼叫時會同步阻塞主執行緒（閒置 2~6ms，連續呼叫最高 173ms；seek 一直是 0ms、readyState
// 一直是 4，所以不是倒帶也不是重新解碼）。tick 一次手勢響三次把管線塞住，轉盤掉到 30fps，
// 連排在後面的 invalid 也被拖到 134ms。拿掉後穩定 60fps、invalid 回到 0~6ms（設計文件 §7）。
// 手勢結束才響的音效一次只有一顆，不會觸發這個問題，維持原樣。
function showPreview(word) {
  clearTimeout(previewTimer);
  const el = $('preview');
  el.className = 'preview';
  el.textContent = word;
}
function flashPreview(text, cls) {
  const el = $('preview');
  el.textContent = text;
  el.className = `preview ${cls}`;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    el.textContent = '';
    el.className = 'preview';
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
  grid = createGrid($('grid'), level, { onCellTap });
  grid.update(game.getCells(), false);
  wheel = createWheel($('wheel'), level.letters, { onChange: showPreview, onSubmit });
  $('btn-level').textContent = strings.levelTitle(id);
  updateCoins();
  $('overlay-clear').hidden = true;
  $('overlay-tutorial').hidden = !(id === 1 && !save.settings.tutorialDone);
  showScreen('game');
  // 玩這關的期間先把下一關的檔案暖進瀏覽器快取，按「下一關」時 startLevel() 的 fetch 直接命中。
  if (id + 1 <= levelCount) prefetchLevel(id + 1);
}

function onSubmit(word) {
  const result = game.submit(word);
  switch (result.type) {
    case 'target': {
      const t0 = performance.now();
      grid.update(game.getCells());
      dbg(`grid.update sync ${(performance.now() - t0).toFixed(1)}ms`);
      // 答對目標字自動念一次（§6.1）：發音取代命中音效——疊播會聽不清楚人聲；
      // 引擎發音失敗時由 onError 退回命中音效，不會整個靜音
      const t1 = performance.now();
      const spoken = save.settings.sound && speak(word, SFX.target, 'wheel');
      dbg(`speak() sync ${(performance.now() - t1).toFixed(1)}ms`);
      if (!spoken) SFX.target();
      if (!save.settings.tutorialDone) {
        save.settings.tutorialDone = true; // 完成第一個字即收掉教學（UI 文件 §4-F）
        $('overlay-tutorial').hidden = true;
      }
      persistProgress();
      if (result.won) onWin(spoken);
      break;
    }
    // 音效一律排在畫面更新「之後」：play() 在 iOS 上會同步阻塞主執行緒最多百餘毫秒，
    // 先播再畫等於把那段阻塞插在玩家與視覺回饋之間，動畫看起來就慢半拍（§7）。
    case 'bonus': {
      save.coins += result.coins;
      flashPreview(strings.bonusFound(result.coins), 'good');
      persistProgress();
      updateCoins();
      SFX.coin();
      break;
    }
    case 'duplicate':
      flashPreview(strings.alreadyFound, 'dup'); // 不重播動畫、不重複給金幣（§1）
      break;
    case 'invalid':
      flashPreview(word, 'shake');
      SFX.invalid();
      break;
  }
}

function onWin(spoken) {
  // 最後一字有發音時不播過關音效（接在人聲後很突兀），慶祝感交給過關卡片；
  // 無發音的過關（提示鍵直接過關、無英文語音）才播 jingle
  if (!spoken) SFX.clear();
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
  renderClearWords();
  $('overlay-clear').hidden = false;
}

// 過關卡片列出本關全部目標字，點字可彈出查詞卡（不強制關閉，UI 文件 §4）
function renderClearWords() {
  const box = $('clear-words');
  box.innerHTML = '';
  for (const entry of game.level.words) {
    const chip = document.createElement('button');
    chip.className = 'clear-word-chip';
    chip.textContent = entry.word;
    chip.addEventListener('click', () => dictCard.show(entry.word, entry, chip));
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
    const btn = $('btn-hint');
    btn.classList.remove('shake');
    void btn.offsetWidth; // 重新觸發動畫
    btn.classList.add('shake');
    flashPreview(strings.noCoins, 'dup');
    return;
  }
  save.coins -= result.cost;
  grid.update(game.getCells());
  stopSpeech(); // 上一個字可能還在念，先停掉再播音效（§6.1 不疊播）
  SFX.target();
  persistProgress();
  updateCoins();
  if (result.won) onWin(false);
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
  clearTimeout(claimTimer);
  if (ready) {
    btn.textContent = strings.claimReady(ECONOMY.claimCoins);
    btn.setAttribute('aria-label', strings.claimLabel); // 「+25」對螢幕閱讀器太隱晦，補上動作名
    if (claimWasReady === false) {
      // 從倒數翻成可領（守到歸零，或切回分頁時剛好過期）→ 彈跳登場
      btn.classList.remove('pop');
      void btn.offsetWidth;
      btn.classList.add('pop');
    }
  } else if (remainingMs <= CLAIM_FINAL_MS) {
    btn.textContent = strings.claimSeconds(Math.ceil(remainingMs / 1000));
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
    const btn = $('btn-claim');
    btn.classList.remove('shake');
    void btn.offsetWidth;
    btn.classList.add('shake');
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
  SFX.coin();
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
function onCellTap(words, cellEl) {
  const word = words.find((w) => game.isFound(w));
  if (!word) return;
  const entry = game.level.words.find((w) => w.word === word);
  dictCard.show(word, entry, cellEl);
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

// ---- 設定 overlay ----
$('btn-settings').addEventListener('click', () => {
  dictCard.hide(); // 同時只留一個互動 overlay（UI 文件 §4）
  $('opt-sound').checked = save.settings.sound;
  $('redeem-msg').hidden = true; // 上次的兌換結果不留到下次開卡
  $('overlay-settings').hidden = false;
});
$('opt-sound').addEventListener('change', (e) => {
  save.settings.sound = e.target.checked;
  persist(save);
});
$('overlay-settings').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) $('overlay-settings').hidden = true; // 點卡片外關閉
});
// 分享進度：Wordle 式純文字（emoji 格盤 + 關卡數），內容是目前畫面這一關——重玩舊關時誠實
// 過關卡片與設定各掛一顆，文案不同、分享內容相同
function wireShare(btn, label) {
  btn.textContent = label;
  // timer 逐顆各自持有：兩顆雖不會同時顯示，但閃字會活過 overlay 關閉，
  // 共用一個 timer 時後點的那顆會取消前一顆的還原，把它永久卡在提示文案上
  let timer = 0;
  // 分享面板關閉後才開始計時；文案較長，給足閱讀時間
  const flash = (msg) => {
    btn.textContent = msg;
    clearTimeout(timer);
    timer = setTimeout(() => {
      btn.textContent = label;
    }, 2500);
  };
  btn.addEventListener('click', async () => {
    if (!game || !wheel) return; // 關卡資料還在 fetch 中（boot 或換關）
    try {
      const text = strings.shareText(
        currentLevelId,
        wheel.getLetters(),
        snapshotText(game.getCells())
      );
      const mode = await bridge.share(text, location.href);
      if (mode === 'copied') flash(strings.shareCopied);
      else if (mode === 'failed') flash(strings.shareFailed); // 剪貼簿與分享面板都不可用
    } catch {
      // bridge.share 不會 throw（剪貼簿／取消都在裡面吞掉），這裡只兜底文案組裝出錯
    }
  });
}
wireShare($('btn-share'), strings.share);
wireShare($('btn-share-clear'), strings.shareScore);
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

// ---- 兌換碼（.local.feature-evaluation.md §2）：JWT 驗簽在 redeem.js，這裡只套用效果 ----
function showRedeemMsg(text) {
  $('redeem-msg').textContent = text;
  $('redeem-msg').hidden = false;
}
$('btn-redeem').addEventListener('click', async () => {
  const token = $('redeem-input').value.trim();
  if (!token) return;
  const result = await verifyCode(token, { redeemed: save.redeemedCodes }).catch(() => ({
    ok: false,
    reason: 'invalid',
  }));
  if (!result.ok) {
    const msg = { expired: strings.redeemExpired, used: strings.redeemUsed }[result.reason];
    showRedeemMsg(msg ?? strings.redeemInvalid);
    return;
  }
  const { jti, effect } = result;
  if (effect.type === 'level' && effect.id <= save.currentLevel) {
    showRedeemMsg(strings.redeemBehind); // 沒有效果就不消耗碼（評估文件 §3-3）
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
  SFX.coin();
  updateCoins();
  $('redeem-input').value = '';
  if (effect.type === 'level' && levelCount) startLevel(effect.id);
});

// ---- 啟動 ----
// 取不到關卡資料（斷網、部署中 404）→ 顯示重試畫面，不留白屏；boot() 跟換關的 fetch 共用。
function showLoadError() {
  $('error-text').textContent = strings.loadFailed;
  $('btn-reload').textContent = strings.retry;
  showScreen('error');
}
$('btn-reload').addEventListener('click', () => location.reload());

(async function boot() {
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
  // 兌換連結（?code=…）：自動帶入兌換碼並打開設定卡，玩家只要按「兌換」
  const code = new URLSearchParams(location.search).get('code');
  if (code) {
    $('redeem-input').value = code;
    $('btn-settings').click();
  }
})();
