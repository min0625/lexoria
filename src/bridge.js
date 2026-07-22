// 平台抽象層（設計文件 §13）——第一階段全是 web 實作，第二階段逐個換成 native。
// 遊戲程式碼只准 import bridge，不准直接碰 localStorage 或 native API。
const SAVE_KEY = 'lexoria-save';

// 非 secure context 下 navigator.clipboard 為 undefined，?. 短路整串 → 回 undefined，
// ?? 收成 false，呼叫端一律拿到「成功/失敗」的 boolean promise。
// try 不能省：writeText 被權限政策擋下時有機會同步丟例外，漏出去會讓沒包 try 的呼叫端
// （btn-uid）整顆按鈕沒反應——正是這裡回 false 想避免的情況。
const writeClipboard = (text) => {
  try {
    return (
      navigator.clipboard?.writeText(text).then(
        () => true,
        () => false
      ) ?? Promise.resolve(false)
    );
  } catch {
    return Promise.resolve(false);
  }
};

export const bridge = {
  save(data) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  },
  load() {
    return JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
  },
  // 複製到剪貼簿 → true/false。遊戲程式碼不准直接碰 navigator.clipboard（Phase 2 換 native
  // 就只改這裡）；不 await 也可以，回傳的是 promise。
  copy: writeClipboard,
  // 分享進度：先寫剪貼簿當保險，再開系統分享面板——兩者都做。
  // 部分分享目標（桌面 Windows 面板、Facebook）只收 url 丟掉 text，文案會不見；
  // 剪貼簿裡永遠有完整版，使用者可自行貼上。
  // 有系統分享面板時一律回 'shared'，即使剪貼簿也寫成功——呼叫端不該在分享送出後再提示
  // 「已複製」，那句話在剛按完分享的人眼裡像是失敗。代價是遇到會丟 text 的目標時，
  // 使用者不知道剪貼簿裡有完整版；為了少數例外對所有人顯示疑似錯誤的提示更虧。
  // 沒有面板才回 'copied'（提示「可直接貼上」），兩條路都不可用回 'failed'——
  // 否則按鈕按下去毫無反應，使用者不知道發生什麼事。
  // 剪貼簿只發動不 await：navigator.share 需要 transient user activation，
  // 先 await 一個非 microtask 的 promise 會吃掉手勢，Safari 會直接 NotAllowedError（面板不開）。
  async share(text, url) {
    const copying = writeClipboard(`${text}\n${url}`);
    if (navigator.share) {
      await navigator.share({ text, url }).catch(() => {}); // 使用者取消不算失敗
      return 'shared';
    }
    return (await copying) ? 'copied' : 'failed';
  },
  showAd() {
    return Promise.resolve(); // Phase 3 接 AdMob
  },
  buy() {
    return Promise.reject(); // Phase 3 接 IAP
  },
};
