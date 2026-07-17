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
  // 分享進度：系統分享面板優先，無則複製到剪貼簿（僅文字，剪貼簿帶不動圖+文）。
  // url 獨立傳而不併進 text——部分分享目標帶檔時會丟掉 text，url 欄位的存活率較高。
  // async 讓非 secure context 下 navigator.clipboard 為 undefined 的同步 throw 變成 rejection，呼叫端一個 catch 全接。
  async share(text, url, files) {
    if (navigator.share) {
      if (files && navigator.canShare?.({ files })) {
        await navigator.share({ text, url, files });
      } else {
        await navigator.share({ text, url }); // 支援分享但不支援帶檔的瀏覽器 → 退回文字+連結
      }
      return 'shared';
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return 'copied';
  },
  showAd() {
    return Promise.resolve(); // Phase 3 接 AdMob
  },
  buy() {
    return Promise.reject(); // Phase 3 接 IAP
  },
};
