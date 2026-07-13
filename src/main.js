// 進入點與接線（設計文件 §10）：模組之間不互相溝通，資料流一條——
// wheel → game.submit(word) → 結果物件 → 這裡分派給 grid / HUD / 特效。
import { strings } from './strings.js';
import { ECONOMY, createGame } from './game.js';
import { createGrid } from './grid.js';
import { createWheel } from './wheel.js';
import { createDictionaryCard } from './dictionary-card.js';
import { loadSave, persist } from './storage.js';
import { bridge } from './bridge.js';

const $ = (id) => document.getElementById(id);

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

// ---- 狀態 ----
let save = loadSave();
let levels = [];
let game = null;
let grid = null;
let wheel = null;
let currentLevelId = save.currentLevel;
let replay = false; // 重玩已完成關卡：不存 levelState、過關不給金幣（UI 文件 §3）

const dictCard = createDictionaryCard($('dict-card'));

// ---- 音效：Kenney Interface Sounds（CC0），本地 wav + Web Audio（§7、§14）----
// AudioContext 建立在載入時（suspended 狀態也能 decode），播放時才 resume——
// 行動瀏覽器要求首次手勢後才能出聲（§13），而播放全都發生在手勢事件內。
const audioCtx = 'AudioContext' in window ? new AudioContext() : null;
const sfxBuffers = {};
const SFX = {};
for (const name of ['tick', 'target', 'invalid', 'coin', 'clear']) {
  SFX[name] = () => playSfx(name);
  if (audioCtx) {
    fetch(`assets/sfx/${name}.wav`)
      .then((r) => r.arrayBuffer())
      .then((buf) => audioCtx.decodeAudioData(buf))
      .then((audio) => { sfxBuffers[name] = audio; })
      .catch(() => {}); // 音檔載入失敗 → 靜音即可，不影響遊戲
  }
}
function playSfx(name) {
  if (!save.settings.sound || !sfxBuffers[name]) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const src = audioCtx.createBufferSource();
  src.buffer = sfxBuffers[name];
  src.connect(audioCtx.destination);
  src.start();
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
      SFX.target();
      if (!save.settings.tutorialDone) {
        save.settings.tutorialDone = true; // 完成第一個字即收掉教學（UI 文件 §4-F）
        $('overlay-tutorial').hidden = true;
      }
      persistProgress();
      if (result.won) onWin();
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

function onWin() {
  SFX.clear();
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
  $('clear-bonus').textContent = replay
    ? strings.replayNote
    : strings.bonusFound(bonusCount);
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
  SFX.target();
  persistProgress();
  updateCoins();
  if (result.won) onWin();
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
    if (level.id < save.currentLevel) b.innerHTML = `<span class="icon icon-check"></span>${level.id}`;
    else if (level.id === save.currentLevel) { b.innerHTML = `<span class="icon icon-play"></span>${level.id}`; b.classList.add('current'); }
    else { b.innerHTML = `<span class="icon icon-lock"></span>${level.id}`; b.disabled = true; }
    b.addEventListener('click', () => startLevel(level.id));
    list.appendChild(b);
  }
}

$('btn-level').addEventListener('click', () => { renderLevelList(); updateCoins(); showScreen('levels'); });
$('btn-back').addEventListener('click', () => startLevel(currentLevelId));
$('btn-allclear-back').addEventListener('click', () => { renderLevelList(); showScreen('levels'); });

// ---- 設定 overlay ----
$('btn-settings').addEventListener('click', () => {
  dictCard.hide(); // 同時只留一個互動 overlay（UI 文件 §4）
  $('opt-sound').checked = save.settings.sound;
  $('opt-haptic').checked = save.settings.haptic;
  $('overlay-settings').hidden = false;
});
$('opt-sound').addEventListener('change', (e) => { save.settings.sound = e.target.checked; persist(save); });
$('opt-haptic').addEventListener('change', (e) => { save.settings.haptic = e.target.checked; persist(save); });
$('overlay-settings').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) $('overlay-settings').hidden = true; // 點卡片外關閉
});

// ---- 啟動 ----
(async function boot() {
  levels = await (await fetch('data/levels.json')).json();
  startLevel(save.currentLevel);
})();
