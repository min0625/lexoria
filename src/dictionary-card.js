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

if ('speechSynthesis' in window) {
  refreshVoices();
  speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
  // iOS Safari 疑似只在「它認得的手勢」handler 裡才真的送出 utterance，而轉盤結束手勢用的
  // pointerup 可能不算數。跟 main.js 解鎖 <audio> 同一招：第一次 touchend 先念一句無聲的
  // 把引擎解鎖。尚未證實有效——留著並記 log，等對照組資料再決定去留。
  document.addEventListener(
    'touchend',
    () => {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      u.onstart = () => log('unlock onstart');
      u.onend = () => log('unlock onend');
      u.onerror = (e) => log(`unlock onerror: ${e.error}`);
      speechSynthesis.speak(u);
      log(
        `unlock speak() done, speaking=${speechSynthesis.speaking} pending=${speechSynthesis.pending}`
      );
    },
    { once: true, capture: true }
  );
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
  u.onstart = () => log(`speak(${word}) [${src}] onstart`);
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
  // 同步讀到的 speaking/pending 在 iOS 上可能還沒更新，隔一拍再讀一次才知道有沒有真的排進去
  setTimeout(
    () =>
      log(
        `speak(${word}) [${src}] +300ms, speaking=${speechSynthesis.speaking} pending=${speechSynthesis.pending}`
      ),
    300
  );
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
