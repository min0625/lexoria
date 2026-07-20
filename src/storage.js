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
  lastClaimAt: 0, // 上次定時領取金幣的 timestamp，0 = 從未領過、立即可領（§8）
  settings: { sound: true, tutorialDone: false },
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
  const save = normalizeSave(raw);
  // 首次開啟時間：舊存檔或壞值就以現在補上（無法回溯），立即落盤以免玩家沒操作就流失
  if (!Number.isFinite(save.firstOpenAt)) {
    save.firstOpenAt = Date.now();
    persist(save);
  }
  return save;
}

export function persist(save) {
  try {
    bridge.save(save);
  } catch {
    // 寫入失敗（隱私模式/配額）→ 本次改玩記憶體存檔，不讓遊戲掛掉；loadSave 開機就會寫，這裡不接會白屏
  }
}
