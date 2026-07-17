// 進入點與接線（設計文件 §10）：模組之間不互相溝通，資料流一條——
// wheel → game.submit(word) → 結果物件 → 這裡分派給 grid / HUD / 特效。

import { bridge } from './bridge.js';
import { createDictionaryCard, speak, stopSpeech } from './dictionary-card.js';
import { createGame, ECONOMY } from './game.js';
import { createGrid, snapshotBlob } from './grid.js';
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
$('label-haptic').textContent = strings.haptic;
$('label-about').textContent = strings.about;
$('btn-share').textContent = strings.share;
$('hint-cost').textContent = `−${ECONOMY.hintCost}`; // 價格唯一來源是 ECONOMY（設計文件 §8）

// ---- 狀態 ----
const save = loadSave();
let levels = [];
let game = null;
let grid = null;
let wheel = null;
let currentLevelId = save.currentLevel;
let replay = false; // 重玩已完成關卡：不存 levelState、過關不給金幣（UI 文件 §3）

const dictCard = createDictionaryCard($('dict-card'));

// ---- 音效：Kenney Interface Sounds（CC0），本地 wav（§7、§14）----
// 原本走 Web Audio API（AudioContext + decodeAudioData），但實機診斷（?debug 面板）
// 量到 AudioContext.resume() 在部分 iOS 裝置上要拖到 10~15 秒才真正轉成 running，
// 期間所有音效都被吞掉；相同裝置上 <audio> 元素的 play() 卻是手勢當下就立刻 resolve。
// 這款遊戲的音效都是獨立短音、不需要 Web Audio 的混音圖，所以直接改用 <audio>
// 元素——不必自己管 AudioContext 狀態機，也不受這個 resume() 延遲影響。
const sfxAudio = {};
const SFX = {};
for (const name of ['tick', 'target', 'invalid', 'coin', 'clear']) {
  const el = new Audio(`assets/sfx/${name}.wav`);
  el.preload = 'auto';
  sfxAudio[name] = el;
  SFX[name] = () => playSfx(name);
}
// iOS 對「手勢內播放才允許自動播放」的解鎖是分別針對每個 <audio> 元素算的，不是整頁一次
// 就全解鎖——只有最常播的 tick 因為第一次觸發本身就在手勢內而順利解鎖，其餘幾顆較少
// 觸發的音效第一次要等到之後才被叫到，那時已經不在手勢當下，會被 NotAllowedError 擋掉
// （症狀：tick 一直有聲，invalid/target/coin/clear 偶爾被吃掉）。所以第一個手勢裡把每
// 顆音效都靜音播一次再馬上暫停歸零，一次把全部解鎖。
document.addEventListener(
  'pointerdown',
  () => {
    for (const el of Object.values(sfxAudio)) {
      el.muted = true;
      el.play().then(
        () => {
          el.pause();
          el.currentTime = 0;
          el.muted = false;
        },
        () => {
          el.muted = false;
        }
      );
    }
  },
  { once: true, capture: true }
);
function playSfx(name) {
  dbg(`playSfx(${name}) called, sound=${save.settings.sound}`);
  if (!save.settings.sound) return;
  const el = sfxAudio[name];
  el.currentTime = 0;
  el.play().catch((e) => dbg(`playSfx(${name}) play() REJECTED: ${e}`));
}

// ---- 畫面切換：顯示/隱藏 section，不做路由（UI 文件 §5）----
function showScreen(name) {
  $('screen-game').hidden = name !== 'game';
  $('screen-levels').hidden = name !== 'levels';
  $('screen-allclear').hidden = name !== 'allclear';
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
  if (word.length > el.textContent.length) SFX.tick();
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
function startLevel(id) {
  const level = levels.find((l) => l.id === id);
  if (!level) {
    showScreen('allclear'); // 最後一關破完 → 全破畫面（§7）
    return;
  }
  currentLevelId = id;
  replay = id !== save.currentLevel;
  const state = replay
    ? { foundBonusWords: save.foundBonusWords[id] ?? [] }
    : { ...save.levelState, foundBonusWords: save.foundBonusWords[id] ?? [] };
  game = createGame(level, state);
  grid = createGrid($('grid'), level, { onCellTap });
  grid.update(game.getCells(), false);
  wheel?.destroy();
  wheel = createWheel($('wheel'), level.letters, { onChange: showPreview, onSubmit });
  $('btn-level').textContent = strings.levelTitle(id);
  updateCoins();
  $('overlay-clear').hidden = true;
  $('overlay-tutorial').hidden = !(id === 1 && !save.settings.tutorialDone);
  showScreen('game');
}

function onSubmit(word) {
  const result = game.submit(word);
  switch (result.type) {
    case 'target': {
      grid.update(game.getCells());
      if (save.settings.haptic) bridge.haptic();
      // 答對目標字自動念一次（§6.1）：發音取代命中音效——疊播會聽不清楚人聲；
      // 引擎發音失敗時由 onError 退回命中音效，不會整個靜音
      const spoken = save.settings.sound && speak(word, SFX.target, dbg);
      if (!spoken) SFX.target();
      if (!save.settings.tutorialDone) {
        save.settings.tutorialDone = true; // 完成第一個字即收掉教學（UI 文件 §4-F）
        $('overlay-tutorial').hidden = true;
      }
      persistProgress();
      if (result.won) onWin(spoken);
      break;
    }
    case 'bonus': {
      save.coins += result.coins;
      SFX.coin();
      flashPreview(strings.bonusFound(result.coins), 'good');
      persistProgress();
      updateCoins();
      break;
    }
    case 'duplicate':
      flashPreview(strings.alreadyFound, 'dup'); // 不重播動畫、不重複給金幣（§1）
      break;
    case 'invalid':
      SFX.invalid();
      flashPreview(word, 'shake');
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
  startLevel(replay ? save.currentLevel : currentLevelId + 1);
});

// ---- 提示（§8）----
$('btn-hint').addEventListener('click', () => {
  if (!game) return; // boot() 尚未完成（fetch levels.json 中），同 btn-share 的守衛
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
  for (const level of levels) {
    const b = document.createElement('button');
    b.className = 'level-btn';
    if (level.id < save.currentLevel)
      b.innerHTML = `<span class="icon icon-check"></span>${level.id}`;
    else if (level.id === save.currentLevel) {
      b.innerHTML = `<span class="icon icon-play"></span>${level.id}`;
      b.classList.add('current');
    } else {
      b.innerHTML = `<span class="icon icon-lock"></span>${level.id}`;
      b.disabled = true;
    }
    b.addEventListener('click', () => startLevel(level.id));
    list.appendChild(b);
  }
}

$('btn-level').addEventListener('click', () => {
  renderLevelList();
  updateCoins();
  showScreen('levels');
});
$('btn-back').addEventListener('click', () => startLevel(currentLevelId));
$('btn-allclear-back').addEventListener('click', () => {
  renderLevelList();
  showScreen('levels');
});

// ---- 設定 overlay ----
$('btn-settings').addEventListener('click', () => {
  dictCard.hide(); // 同時只留一個互動 overlay（UI 文件 §4）
  $('opt-sound').checked = save.settings.sound;
  $('opt-haptic').checked = save.settings.haptic;
  $('overlay-settings').hidden = false;
});
$('opt-sound').addEventListener('change', (e) => {
  save.settings.sound = e.target.checked;
  persist(save);
});
$('opt-haptic').addEventListener('change', (e) => {
  save.settings.haptic = e.target.checked;
  persist(save);
});
$('overlay-settings').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) $('overlay-settings').hidden = true; // 點卡片外關閉
});
// 分享進度：文字寫整體進度（save.currentLevel）、快照畫目前畫面這一關（wheel 目前排列，含洗牌）——重玩舊關時各自誠實
let shareTimer = 0;
$('btn-share').addEventListener('click', async () => {
  if (!game || !wheel) return; // boot() 尚未完成（fetch levels.json 中）
  try {
    const blob = await snapshotBlob(
      game.getCells(),
      wheel.getLetters(),
      strings.shareImageTitle(currentLevelId)
    );
    const files = [new File([blob], 'lexoria.png', { type: 'image/png' })];
    const mode = await bridge.share(strings.shareText(save.currentLevel), location.href, files);
    if (mode === 'copied') {
      $('btn-share').textContent = strings.shareCopied;
      clearTimeout(shareTimer);
      shareTimer = setTimeout(() => {
        $('btn-share').textContent = strings.share;
      }, 1500);
    }
  } catch {
    // 使用者取消分享，或非 secure context 下剪貼簿不可用——靜默即可
  }
});

// ---- 啟動 ----
(async function boot() {
  levels = await (await fetch('data/levels.json')).json();
  startLevel(save.currentLevel);
})();
