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
  showAd() {
    return Promise.resolve(); // Phase 3 接 AdMob
  },
  buy() {
    return Promise.reject(); // Phase 3 接 IAP
  },
};
