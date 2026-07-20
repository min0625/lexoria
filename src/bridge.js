// 平台抽象層（設計文件 §13）——第一階段全是 web 實作，第二階段逐個換成 native。
// 遊戲程式碼只准 import bridge，不准直接碰 localStorage 或 native API。
const SAVE_KEY = 'lexoria-save';

export const bridge = {
  save(data) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  },
  load() {
    return JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
  },
  haptic() {
    navigator.vibrate?.(10);
  },
  // 分享進度：先寫剪貼簿當保險，再開系統分享面板——兩者都做。
  // 部分分享目標（桌面 Windows 面板、Facebook）只收 url 丟掉 text，文案會不見；
  // 剪貼簿裡永遠有完整版，使用者可自行貼上。回傳 'copied' 讓呼叫端提示「可直接貼上」。
  // 非 secure context 下 navigator.clipboard 為 undefined，?. 短路整串 → copied 為 undefined（falsy）。
  // 兩條路都不可用時回傳 'failed'——否則按鈕按下去毫無反應，使用者不知道發生什麼事。
  // 剪貼簿只發動不 await：navigator.share 需要 transient user activation，
  // 先 await 一個非 microtask 的 promise 會吃掉手勢，Safari 會直接 NotAllowedError（面板不開）。
  async share(text, url) {
    const copying = navigator.clipboard?.writeText(`${text}\n${url}`).then(
      () => true,
      () => false
    );
    const shared = Boolean(navigator.share);
    if (shared) await navigator.share({ text, url }).catch(() => {}); // 使用者取消不算失敗
    if (await copying) return 'copied';
    return shared ? 'shared' : 'failed';
  },
  showAd() {
    return Promise.resolve(); // Phase 3 接 AdMob
  },
  buy() {
    return Promise.reject(); // Phase 3 接 IAP
  },
};
