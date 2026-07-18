// 存檔讀寫（設計文件 §9）：一個 key、一個 JSON。
// normalizeSave 是純函式，node --test 可直接測「壞資料 → 重置」。
import { bridge } from './bridge.js';
import { ECONOMY } from './game.js';

export const defaultSave = () => ({
  version: 1,
  currentLevel: 1,
  coins: ECONOMY.initialCoins,
  foundBonusWords: {}, // { [levelId]: [word, ...] }——按關卡記錄（§1）
  levelState: { foundWords: [], revealedCells: [] }, // 只屬於 currentLevel
  redeemedCodes: [], // 已兌換碼的 jti 清單（.local.feature-evaluation.md §2）
  settings: { sound: true, haptic: true, tutorialDone: false },
});

// 讀到壞掉或無法辨識的資料 → 重置成初始存檔（§9）。
export function normalizeSave(raw) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    raw.version !== 1 ||
    !Number.isInteger(raw.currentLevel) ||
    raw.currentLevel < 1 ||
    !Number.isFinite(raw.coins) ||
    raw.coins < 0 ||
    typeof raw.foundBonusWords !== 'object' ||
    raw.foundBonusWords === null ||
    !Object.values(raw.foundBonusWords).every(Array.isArray) ||
    !raw.levelState ||
    !Array.isArray(raw.levelState.foundWords) ||
    !Array.isArray(raw.levelState.revealedCells) ||
    // 舊存檔沒有 redeemedCodes 是合法的（spread 會補預設值），有但不是陣列才算壞
    (raw.redeemedCodes !== undefined && !Array.isArray(raw.redeemedCodes)) ||
    !raw.settings ||
    typeof raw.settings !== 'object'
  ) {
    return defaultSave();
  }
  return { ...defaultSave(), ...raw, settings: { ...defaultSave().settings, ...raw.settings } };
}

export function loadSave() {
  let raw = null;
  try {
    raw = bridge.load();
  } catch {
    // JSON 壞掉一樣走重置
  }
  return normalizeSave(raw);
}

export function persist(save) {
  bridge.save(save);
}
