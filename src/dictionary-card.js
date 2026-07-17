// 查詞卡片（設計文件 §6）：釋義 + 喇叭發音。只有已找到的字能查（由呼叫端把關）。

// 無英文語音就隱藏喇叭鈕（§6.2）；getVoices 可能先回空陣列，要等 voiceschanged。
let hasEnglishVoice = false;
function refreshVoices() {
  hasEnglishVoice =
    'speechSynthesis' in window && speechSynthesis.getVoices().some((v) => v.lang.startsWith('en'));
}
if ('speechSynthesis' in window) {
  refreshVoices();
  speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
}

// 有英文語音才念，回傳是否已排入發音；發音失敗（引擎錯誤）時呼叫 onError 讓呼叫端補音效
export function speak(word, onError) {
  if (!hasEnglishVoice) return false;
  speechSynthesis.cancel(); // 連續呼叫時不排隊，直接改念最新的字
  // 全大寫會被部分 TTS 引擎當縮寫逐字母拼讀（CAT → C-A-T），一律轉小寫
  const u = new SpeechSynthesisUtterance(word.toLowerCase());
  u.lang = 'en-US';
  if (onError)
    u.onerror = (e) => {
      // 自己 cancel 掉的不算失敗，補播音效反而蓋到下一個字的人聲
      if (e.error !== 'interrupted' && e.error !== 'canceled') onError();
    };
  // Chrome 的 cancel() 內部是非同步的，同一 tick 接著 speak() 可能連新句子一起丟掉 → 延後一拍；
  // resume() 防引擎卡在 paused（分頁背景化後會發生），等同 playSfx 對 audioCtx 的 resume
  setTimeout(() => {
    speechSynthesis.resume();
    speechSynthesis.speak(u);
  }, 0);
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
      btn.addEventListener('click', () => speak(word));
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
