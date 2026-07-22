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

// 玩家編號（.local.feature-evaluation.md §2）：Crockford Base32（無 I/L/O/U），
// 10 碼亂數 + 2 碼加鹽校驗 = 12 碼。用途是讓開發者能簽發只給某個人的兌換碼。
// UID_SALT 必然隨前端出貨——校驗碼擋的是「亂打的字串」與「玩家回報時打錯字」，
// 不是安全機制；讀得懂 JS 的人照樣量產合法 UID（沿用既有的「不防技術玩家」取捨）。
const UID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const UID_SALT = 'lexoria-uid-v1';

function uidCheck(body) {
  let h = 0x811c9dc5; // FNV-1a
  for (const ch of UID_SALT + body) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return UID_ALPHABET[h & 31] + UID_ALPHABET[(h >>> 5) & 31];
}

// getRandomValues 而非 randomUUID：後者要 secure context，LAN IP 真機測試會是 undefined（§3-4）。
// 256 是 32 的整數倍，b & 31 在字母表上仍是均勻分布。
export function newUid() {
  const body = Array.from(
    crypto.getRandomValues(new Uint8Array(10)),
    (b) => UID_ALPHABET[b & 31]
  ).join('');
  return body + uidCheck(body);
}

// 玩家回報的碼可能帶連字號、小寫、或 Crockford 的易混字，先正規化再驗
export const normalizeUid = (s) =>
  String(s)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');

const UID_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/; // 字母表本身（無 I/L/O/U）也是第一道格式檢查
// typeof 這關不能省：RegExp.test 會先字串化，數字 123456789012 過得了 UID_RE，
// 接著 s.slice 就 TypeError——存檔被手改成數字 uid 會在 loadSave 炸成白屏（§17「塞壞資料不白屏」那條）。
export const isUid = (s) =>
  typeof s === 'string' && UID_RE.test(s) && uidCheck(s.slice(0, 10)) === s.slice(10);

export const formatUid = (uid) => uid.replace(/(.{4})(?=.)/g, '$1-'); // 顯示用 XXXX-XXXX-XXXX

// 讀到壞掉或無法辨識的資料 → 重置成初始存檔（§9）。
// uid 不在檢查清單裡：缺欄位不該讓整份存檔重置，交給 loadSave 補記。
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
  // 缺漏就補記，立即落盤以免玩家沒操作就流失
  let dirty = false;
  // 首次開啟時間：舊存檔或壞值就以現在補上（無法回溯）
  if (!Number.isFinite(save.firstOpenAt)) {
    save.firstOpenAt = Date.now();
    dirty = true;
  }
  // 玩家編號：舊存檔沒有、或被手改成壞值 → 補一組新的
  if (!isUid(save.uid)) {
    save.uid = newUid();
    dirty = true;
  }
  if (dirty) persist(save);
  return save;
}

export function persist(save) {
  try {
    bridge.save(save);
  } catch {
    // 寫入失敗（隱私模式/配額）→ 本次改玩記憶體存檔，不讓遊戲掛掉；loadSave 開機就會寫，這裡不接會白屏
  }
}
