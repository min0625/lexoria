// 查詞卡片（設計文件 §6）：釋義 + 喇叭發音。只有已找到的字能查（由呼叫端把關）。
// 模組層級一律用 globalThis 而非 window：瀏覽器裡兩者相同，但沒有 DOM 的執行環境（bun test）
// 讀 window 會 ReferenceError，import 就爆——而 fitVertically 是要被測的純函式（§12）。
import { strings } from './strings.js';

// 無英文語音就隱藏喇叭鈕（§6.2）；getVoices 可能先回空陣列，要等 voiceschanged。
let hasEnglishVoice = false;
function refreshVoices() {
  hasEnglishVoice =
    'speechSynthesis' in globalThis &&
    speechSynthesis.getVoices().some((v) => v.lang.startsWith('en'));
}
// 除錯 log（見 main.js 的 dbg()），非正式功能。掛成模組層級，讓喇叭鈕跟答對自動發音
// 兩條路徑都寫進同一份 log —— 少了「成功那條長什麼樣」的對照組，就無法判讀失敗那條。
// 收的是 thunk 而不是組好的字串，而且沒開 ?debug 時 sink 是 null（main.js 只在 DEBUG 才接上）：
// 下面兩則診斷要讀 getVoices()／speaking／pending／paused，那些在 iOS 上是進 TTS daemon 的
// 同步呼叫，而 speak() 就跑在答對字的熱路徑上。傳字串的話引數會先求值再丟給 noop——每答對
// 一個字都白付兩次，連 main.js 那句量 `speak() sync` 的 dbg 都在量這筆自己造出來的成本。
let sink = null;
export function setSpeechDebug(fn) {
  sink = fn;
}
const log = (make) => sink?.(make());

// 引擎是否已經真的念出過一句（見下方 unlock 的說明）
let unlocked = false;

if ('speechSynthesis' in globalThis) {
  refreshVoices();
  speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
  // iOS Safari 的語音引擎要先真正念出過一句才會醒：在那之前 utterance 會被靜默丟棄——
  // 不出聲，onstart/onerror 都不觸發；醒了之後每條路徑都正常。實機 log 佐證：查詞卡喇叭鈕
  // （click）念過一次後，後續轉盤答對就都念得出來。
  // 實機測過的：拖曳結束的 touchend 叫不醒（連解鎖那句自己都被丟掉），click 可以。解鎖那
  // 句同樣是 volume 0 卻念得出來，所以音量不是變因，只有手勢種類是。
  // pointerdown 也實機測過了：叫不醒。無痕分頁開場連拖兩個字都沒有 onstart，第一次點擊
  // （切關卡按鈕）當下才 onstart，之後拖曳就正常念。曾懷疑是 speak() 開頭的 cancel() 砍掉
  // pointerdown 排入的解鎖句，試著只在 unlocked 後才 cancel——行為完全沒變，且 log 顯示
  // 解鎖句排入後 pending 仍為 false，表示它根本沒進佇列就被丟棄，沒有東西可砍。已還原。
  // 所以只有 click 算數。三個事件都掛著不動：叫不醒的那幾次本來就是無聲丟棄，重試不花成本，
  // 也不必在 code 裡分辨哪種手勢算數。
  // 解鎖是「每次載入頁面」重算的，重新整理／分頁還原都要重來，不是首次遊玩一次就永久有效。
  // 遊戲畫面上沒有任何非點不可的按鈕（一次拖曳從 pointerdown 到 pointerup 不產生 click），
  // 所以由 index.html 的開場閘門（#gate）負責製造這一下 click——閘門曾經還兼著音效解鎖，
  // 音效整層移除後（設計文件 §13）那半沒了，**現在這是它存在的唯一理由**，別把它當裝飾拆掉。
  // 這三個 listener 仍留著：閘門被繞過（例如日後改流程）時還有機會靠玩家隨手點的按鈕解鎖。
  // 這就是這條路的天花板，不要再往下試第四種事件。
  const unlock = () => {
    if (unlocked || speechSynthesis.speaking || speechSynthesis.pending) return;
    const u = new SpeechSynthesisUtterance('a'); // 空字串沒東西可念，會連解鎖自己一起被丟掉
    u.volume = 0;
    u.onstart = () => {
      unlocked = true;
      log(() => 'unlock onstart');
    };
    // onend 也記：診斷音效問題時靠這對時間戳才確認 TTS 唸的期間不會卡住轉盤（設計文件 §13）。
    u.onend = () => log(() => 'unlock onend');
    u.onerror = (e) => log(() => `unlock onerror: ${e.error}`);
    speechSynthesis.speak(u);
  };
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('touchend', unlock, { capture: true });
  document.addEventListener('click', unlock, { capture: true });
}

// 有英文語音才念，回傳是否已排入發音。
// 這裡曾有一個 onError 退路，讓呼叫端在引擎失敗時補播命中音效——音效整層已移除（§13），
// 沒有東西可以補了，所以連同那條退路一起拿掉。發音叫不出來時就是純視覺回饋。
// src 標記是哪條路徑（wheel=答對自動念、btn=喇叭鈕），用來比對兩者 log 差異
export function speak(word, src = '?') {
  log(
    () =>
      `speak(${word}) [${src}] called, hasEnglishVoice=${hasEnglishVoice}, voices=${'speechSynthesis' in globalThis ? speechSynthesis.getVoices().length : 'n/a'}`
  );
  if (!hasEnglishVoice) return false;
  speechSynthesis.cancel(); // 連續呼叫時不排隊，直接改念最新的字
  // 全大寫會被部分 TTS 引擎當縮寫逐字母拼讀（CAT → C-A-T），一律轉小寫
  const u = new SpeechSynthesisUtterance(word.toLowerCase());
  u.lang = 'en-US';
  u.onstart = () => {
    unlocked = true;
    log(() => `speak(${word}) [${src}] onstart`);
  };
  u.onend = () => log(() => `speak(${word}) [${src}] onend`);
  u.onerror = (e) => log(() => `speak(${word}) [${src}] onerror: ${e.error}`);
  // 曾經延後一拍呼叫（setTimeout 0ms）來閃避 Chrome cancel() 非同步造成的丟句問題，
  // 但實測 iOS Safari 需要 speak() 跟觸發手勢同一個 tick 呼叫，延後一拍會讓語音引擎
  // 整個不出聲、不觸發 onstart 也不觸發 onerror（症狀：答對字完全沒有發音）。
  // resume() 防引擎卡在 paused（分頁背景化後會發生）
  log(
    () =>
      `speak(${word}) [${src}] about to speak(), speaking=${speechSynthesis.speaking} pending=${speechSynthesis.pending} paused=${speechSynthesis.paused}`
  );
  speechSynthesis.resume();
  speechSynthesis.speak(u);
  return true;
}

export function stopSpeech() {
  if ('speechSynthesis' in globalThis) speechSynthesis.cancel();
}

// 卡片的垂直定位。抽成純函式的理由跟 wheel.js 的 hitIndex／applyHit 一樣（§12）：這段算式
// 就是「卡片掉出畫面外」那個 bug 的所在，量測與寫樣式沒得測，算式可以。
// a = 錨點的 getBoundingClientRect（前提：錨點在畫面內，它是玩家剛點到的東西），h = 卡片自然高度，
// vh = 視窗高度。回傳保證 top >= 0 且 top + min(h, maxHeight) <= vh，也就是整張卡都在畫面內。
// 下方放不下就翻到錨點上方（同一般 popover）；兩邊都放不下（瀏覽器縮放、大字級）取空間大的那側，
// 由 max-height + .dict-card 的 overflow-y 讓卡片自己捲——.dict-card 因此也列進了 main.js
// touchmove 的放行名單，不然 iOS 上捲不動。
export function fitVertically(a, h, vh) {
  const below = Math.max(0, vh - a.bottom - 16);
  const above = Math.max(0, a.top - 16);
  const useBelow = h <= below || below >= above;
  return {
    top: useBelow ? a.bottom + 8 : a.top - 8 - Math.min(h, above),
    maxHeight: useBelow ? below : above,
  };
}

export function createDictionaryCard(cardEl) {
  function hide() {
    cardEl.hidden = true;
  }

  // 點卡片外任意處關閉
  document.addEventListener('pointerdown', (ev) => {
    if (!cardEl.hidden && !cardEl.contains(ev.target)) hide();
  });

  function show(word, entry, anchorEl) {
    cardEl.innerHTML = '';
    const title = document.createElement('strong');
    title.textContent = word;
    cardEl.appendChild(title);
    if (hasEnglishVoice) {
      const btn = document.createElement('button');
      btn.className = 'speak-btn';
      btn.innerHTML = '<span class="icon icon-speaker"></span>';
      btn.setAttribute('aria-label', strings.speakLabel(word));
      btn.addEventListener('click', () => speak(word, 'btn'));
      cardEl.appendChild(btn);
    }
    if (entry?.zh) {
      const zh = document.createElement('p');
      zh.className = 'def-zh';
      zh.lang = 'zh-Hant';
      zh.textContent = entry.zh;
      cardEl.appendChild(zh);
    }
    const p = document.createElement('p');
    p.className = 'def-en';
    p.lang = 'en';
    p.textContent = entry?.def ?? '';
    cardEl.appendChild(p);

    // 節點要掛進當下那張 aria-modal 的 dialog 裡面，不能留在 body 上：aria-modal="true" 會讓
    // 輔助技術把 dialog 以外的一切藏起來，而過關卡片的單字鈕正是這張卡最主要的入口（UI 文件 §4-C）
    // ——留在外面的話讀螢幕的人點得下去、卻永遠滑不到剛彈出來的釋義與喇叭鈕。
    // position: fixed 不吃 DOM 位置，版面與下面的定位計算都不受影響；沒有 modal 就掛回 body。
    (anchorEl.closest('[aria-modal="true"]') ?? document.body).appendChild(cardEl);
    // 貼著被點的格子彈出（螢幕邊緣往內夾）
    cardEl.hidden = false;
    cardEl.style.maxHeight = ''; // 上次夾的高度會汙染這次的量測，先還原再量
    const a = anchorEl.getBoundingClientRect();
    const w = cardEl.offsetWidth;
    cardEl.style.left = `${Math.min(Math.max(8, a.left + a.width / 2 - w / 2), window.innerWidth - w - 8)}px`;
    // 上下一定要跟左右一樣夾住：釋義最長有 311 字元（WordNet 的 GAS），錨在盤面最後一列往下開
    // 整張卡會掉出畫面底部，而 .dict-card 是 position: fixed，捲不回來也點不到。算式見 fitVertically。
    const fit = fitVertically(a, cardEl.offsetHeight, innerHeight);
    cardEl.style.maxHeight = `${fit.maxHeight}px`;
    cardEl.style.top = `${fit.top}px`;
  }

  return { show, hide };
}
