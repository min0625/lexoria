// 查詞卡片（設計文件 §6）：釋義 + 喇叭發音。只有已找到的字能查（由呼叫端把關）。

// 無英文語音就隱藏喇叭鈕（§6.2）；getVoices 可能先回空陣列，要等 voiceschanged。
let hasEnglishVoice = false;
function refreshVoices() {
  hasEnglishVoice =
    'speechSynthesis' in window && speechSynthesis.getVoices().some((v) => v.lang.startsWith('en'));
}
// 除錯 log（見 main.js 的 dbg()），非正式功能。掛成模組層級，讓喇叭鈕跟答對自動發音
// 兩條路徑都寫進同一份 log —— 少了「成功那條長什麼樣」的對照組，就無法判讀失敗那條。
let log = () => {};
export function setSpeechDebug(fn) {
  log = fn;
}

// 引擎是否已經真的念出過一句（見下方 unlock 的說明）
let unlocked = false;

if ('speechSynthesis' in window) {
  refreshVoices();
  speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
  // iOS Safari 的語音引擎要先真正念出過一句才會醒：在那之前 utterance 會被靜默丟棄——
  // 不出聲，onstart/onerror 都不觸發；醒了之後每條路徑都正常。實機 log 佐證：查詞卡喇叭鈕
  // （click）念過一次後，後續轉盤答對就都念得出來。
  // 但「哪種手勢才叫得醒」試不出來——拖曳結束的 touchend 連解鎖那句自己都會被丟掉，click 才
  // 行；是手勢種類還是 volume 0 的差別無從分辨。與其繼續猜，不如每個手勢都試著解鎖一次，
  // 直到真的有一句 onstart 為止：叫不醒的那幾次本來就是無聲丟棄，重試不花成本。
  const unlock = () => {
    if (unlocked || speechSynthesis.speaking || speechSynthesis.pending) return;
    const u = new SpeechSynthesisUtterance('a'); // 空字串沒東西可念，會連解鎖自己一起被丟掉
    u.volume = 0;
    u.onstart = () => {
      unlocked = true;
      log('unlock onstart');
    };
    u.onerror = (e) => log(`unlock onerror: ${e.error}`);
    speechSynthesis.speak(u);
  };
  document.addEventListener('touchend', unlock, { capture: true });
  document.addEventListener('click', unlock, { capture: true });
}

// 有英文語音才念，回傳是否已排入發音；發音失敗（引擎錯誤）時呼叫 onError 讓呼叫端補音效
// src 標記是哪條路徑（wheel=答對自動念、btn=喇叭鈕），用來比對兩者 log 差異
export function speak(word, onError, src = '?') {
  log(
    `speak(${word}) [${src}] called, hasEnglishVoice=${hasEnglishVoice}, voices=${'speechSynthesis' in window ? speechSynthesis.getVoices().length : 'n/a'}`
  );
  if (!hasEnglishVoice) return false;
  speechSynthesis.cancel(); // 連續呼叫時不排隊，直接改念最新的字
  // 全大寫會被部分 TTS 引擎當縮寫逐字母拼讀（CAT → C-A-T），一律轉小寫
  const u = new SpeechSynthesisUtterance(word.toLowerCase());
  u.lang = 'en-US';
  let started = false;
  u.onstart = () => {
    started = true;
    unlocked = true;
    log(`speak(${word}) [${src}] onstart`);
  };
  u.onend = () => log(`speak(${word}) [${src}] onend`);
  u.onerror = (e) => {
    log(`speak(${word}) [${src}] onerror: ${e.error}`);
    // 自己 cancel 掉的不算失敗，補播音效反而蓋到下一個字的人聲
    if (onError && e.error !== 'interrupted' && e.error !== 'canceled') onError();
  };
  // 曾經延後一拍呼叫（setTimeout 0ms）來閃避 Chrome cancel() 非同步造成的丟句問題，
  // 但實測 iOS Safari 需要 speak() 跟觸發手勢同一個 tick 呼叫，延後一拍會讓語音引擎
  // 整個不出聲、不觸發 onstart 也不觸發 onerror（症狀：答對字完全沒有發音）。
  // resume() 防引擎卡在 paused（分頁背景化後會發生），等同 playSfx 對 audioCtx 的 resume
  log(
    `speak(${word}) [${src}] about to speak(), speaking=${speechSynthesis.speaking} pending=${speechSynthesis.pending} paused=${speechSynthesis.paused}`
  );
  speechSynthesis.resume();
  speechSynthesis.speak(u);
  // 被丟棄的 utterance 不出聲也不觸發 onerror，呼叫端的 onError 補救因此不會被叫到，
  // 玩家答對了卻完全沒有回饋（連命中音效都沒有，因為 speak 回報「已排入」）。
  // 沒有事件可以等，只能定時檢查：這段時間內沒 onstart 就當作被丟掉，補播音效。
  setTimeout(() => {
    log(
      `speak(${word}) [${src}] +300ms, speaking=${speechSynthesis.speaking} pending=${speechSynthesis.pending}`
    );
    if (!started && !speechSynthesis.speaking && !speechSynthesis.pending) onError?.();
  }, 300);
  return true;
}

export function stopSpeech() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
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
      btn.setAttribute('aria-label', `pronounce ${word}`);
      btn.addEventListener('click', () => speak(word, null, 'btn'));
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

    // 貼著被點的格子彈出（螢幕邊緣往內夾）
    cardEl.hidden = false;
    const a = anchorEl.getBoundingClientRect();
    const w = cardEl.offsetWidth;
    cardEl.style.left = `${Math.min(Math.max(8, a.left + a.width / 2 - w / 2), window.innerWidth - w - 8)}px`;
    cardEl.style.top = `${a.bottom + 8}px`;
  }

  return { show, hide };
}
