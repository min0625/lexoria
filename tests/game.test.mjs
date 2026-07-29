// 純邏輯單元測試（設計文件 §12）：node --test tests/

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { bridge } from '../src/bridge.js';
import { fitVertically } from '../src/dictionary-card.js';
import { cellsOf, claimStatus, createGame, ECONOMY } from '../src/game.js';
import { snapshotText } from '../src/grid.js';
import {
  defaultSave,
  formatUid,
  isUid,
  newUid,
  normalizeSave,
  normalizeUid,
  persist,
} from '../src/storage.js';
import { applyHit, hitIndex, permutationAt, shuffleStep } from '../src/wheel.js';

// 每關一個檔案（前端按需 fetch，見 src/main.js startLevel），測試把整批讀回來驗證。
const levelsDir = new URL('../data/levels/', import.meta.url);
const { count: levelCount } = JSON.parse(await readFile(new URL('index.json', levelsDir)));
const levels = await Promise.all(
  Array.from({ length: levelCount }, (_, i) =>
    readFile(new URL(`${i + 1}.json`, levelsDir)).then(JSON.parse)
  )
);

// 邏輯測試用固定 fixture（原手刻第 1、2 關）——data/levels/ 已由產生器輸出，內容會變動，
// 單元測試不能依賴它；末尾的關卡驗證器才是針對 data/levels/ 的測試。
const fixtures = {
  1: {
    id: 1,
    letters: ['C', 'A', 'T'],
    words: [
      { word: 'CAT', row: 0, col: 0, dir: 'across', def: 'a small domesticated feline animal' },
      {
        word: 'ACT',
        row: 0,
        col: 1,
        dir: 'down',
        def: 'something that a person does; to take action',
      },
    ],
    bonus: [],
  },
  2: {
    id: 2,
    letters: ['N', 'E', 'A', 'R'],
    words: [
      { word: 'NEAR', row: 0, col: 0, dir: 'across', def: 'close to; not far away' },
      { word: 'EARN', row: 0, col: 1, dir: 'down', def: 'to receive money in return for work' },
      {
        word: 'RAN',
        row: 2,
        col: 1,
        dir: 'across',
        def: 'moved quickly on foot (past tense of run)',
      },
    ],
    bonus: ['EAR', 'ERA', 'ARE'],
  },
};
const lvl = (id) => fixtures[id];

// ---- game.js ----

test('cellsOf 展開 across 與 down 座標', () => {
  assert.deepEqual(cellsOf({ word: 'AB', row: 1, col: 2, dir: 'across' }), [
    { r: 1, c: 2, letter: 'A' },
    { r: 1, c: 3, letter: 'B' },
  ]);
  assert.deepEqual(cellsOf({ word: 'AB', row: 1, col: 2, dir: 'down' }), [
    { r: 1, c: 2, letter: 'A' },
    { r: 2, c: 2, letter: 'B' },
  ]);
});

test('submit：目標字 → target 並填格；找齊全部 → won', () => {
  const g = createGame(lvl(1));
  const r1 = g.submit('CAT');
  assert.equal(r1.type, 'target');
  assert.equal(r1.won, false);
  assert.equal(g.getCells().filter((c) => c.state === 'filled').length, 3);
  const r2 = g.submit('act'); // 大小寫不敏感
  assert.equal(r2.type, 'target');
  assert.equal(r2.won, true);
});

test('submit：已找到的目標字 → duplicate，不重複計', () => {
  const g = createGame(lvl(1));
  g.submit('CAT');
  assert.equal(g.submit('CAT').type, 'duplicate');
});

test('submit：bonus 字給金幣、重拼不再給', () => {
  const g = createGame(lvl(2));
  const r = g.submit('EAR');
  assert.equal(r.type, 'bonus');
  assert.equal(r.coins, ECONOMY.bonusCoins);
  assert.equal(g.submit('EAR').type, 'duplicate');
});

test('submit：不在任何字典 → invalid；長度 < 3 → invalid', () => {
  const g = createGame(lvl(2));
  assert.equal(g.submit('RNA').type, 'invalid');
  assert.equal(g.submit('AN').type, 'invalid');
});

test('進行中進度可還原：foundWords / revealedCells / foundBonusWords', () => {
  const g1 = createGame(lvl(2));
  g1.submit('NEAR');
  g1.submit('EAR');
  const g2 = createGame(lvl(2), g1.getState());
  assert.equal(g2.submit('NEAR').type, 'duplicate');
  assert.equal(g2.submit('EAR').type, 'duplicate');
  assert.equal(g2.isFound('NEAR'), true);
});

test('useHint：金幣不足 → no-coins；足夠 → 揭示一格', () => {
  const g = createGame(lvl(1), {}, () => 0);
  assert.deepEqual(g.useHint(ECONOMY.hintCost - 1), { ok: false, reason: 'no-coins' });
  const r = g.useHint(100);
  assert.equal(r.ok, true);
  assert.equal(r.cost, ECONOMY.hintCost);
  assert.equal(g.getCells().filter((c) => c.state === 'revealed').length, 1);
  assert.equal(g.getState().revealedCells.length, 1);
});

test('一個字的格子全部由提示補滿 → 即算找到、計入勝利判定（§8 邊界）', () => {
  const g = createGame(lvl(1), {}, () => 0); // rng=0：每次揭示第一個未填格
  let won = false;
  for (let i = 0; i < 5; i++) {
    const r = g.useHint(1000);
    assert.equal(r.ok, true);
    won = r.won;
  }
  assert.equal(won, true); // 5 格全揭示 → CAT、ACT 都算找到
  assert.equal(g.submit('CAT').type, 'duplicate'); // 轉盤再拼 → 已找到
});

test('拼字填入交叉格後，被提示補到只剩交叉格的字也算找到', () => {
  // ACT 的非交叉格 (1,1)(2,1) 已被提示揭示，拼出 CAT 補上交叉格 (0,1) → ACT 一併完成
  const g = createGame(lvl(1), { revealedCells: ['1,1', '2,1'] });
  const r = g.submit('CAT');
  assert.equal(r.type, 'target');
  assert.deepEqual(
    r.completedWords.map((w) => w.word),
    ['ACT']
  );
  assert.equal(r.won, true);
});

test('claimStatus：冷卻計時、不可累積、時鐘倒轉不鎖死', () => {
  const H = 60 * 60 * 1000;
  const t = 10 * H;
  // 從未領過（0）或壞值 → 立即可領
  assert.deepEqual(claimStatus(0, t), { ready: true, remainingMs: 0 });
  assert.deepEqual(claimStatus(Number.NaN, t), { ready: true, remainingMs: 0 });
  // 冷卻中：剩餘時間正確
  assert.deepEqual(claimStatus(t, t + 1 * H), { ready: false, remainingMs: 3 * H });
  // 剛好滿 4 小時 → 可領
  assert.equal(claimStatus(t, t + 4 * H).ready, true);
  // 離線多天 → 一樣只是 ready（領取即重設起點，天然不能累積）
  assert.equal(claimStatus(t, t + 72 * H).ready, true);
  // lastClaimAt 在未來（時鐘倒轉）→ 視同可領，冷卻不會永不結束
  assert.equal(claimStatus(t + 5 * H, t).ready, true);
});

// ---- wheel.js 純函式 ----

test('hitIndex：距離 < 半徑×1.2 才命中', () => {
  const spots = [{ i: 0, x: 0, y: 0, r: 10 }];
  assert.equal(hitIndex(0, 11, spots), 0); // 11 < 12
  assert.equal(hitIndex(0, 13, spots), -1);
});

test('hitIndex：字母擁擠時命中半徑縮到間距×0.35，中間留死區', () => {
  // 圓心距 20 → 命中半徑被夾成 7（而非 10×1.2=12），7~13 的中間帶不命中
  const spots = [
    { i: 0, x: 0, y: 0, r: 10 },
    { i: 1, x: 20, y: 0, r: 10 },
  ];
  assert.equal(hitIndex(6, 0, spots), 0);
  assert.equal(hitIndex(14, 0, spots), 1);
  assert.equal(hitIndex(10, 0, spots), -1); // 兩顆正中間 = 死區
  assert.equal(hitIndex(8, 0, spots), -1);
});

test('applyHit：重複字母綁按鈕實例，各選一次', () => {
  // APPLE：index 1、2 都是 P，兩顆各可選一次
  let sel = [];
  sel = applyHit(sel, 1);
  sel = applyHit(sel, 2);
  assert.deepEqual(sel, [1, 2]);
  assert.deepEqual(applyHit(sel, 2), [1, 2]); // 停在最後一顆 → 不變
});

test('applyHit：滑回上一顆 = 取消最後一顆；滑到更早的已選字母不生效', () => {
  assert.deepEqual(applyHit([0, 1, 2], 1), [0, 1]); // 滑回倒數第二顆
  assert.deepEqual(applyHit([0, 1, 2], 0), [0, 1, 2]); // 更早的已選 → 不變
  assert.deepEqual(applyHit([0, 1], -1), [0, 1]); // 沒命中 → 不變
});

test('permutationAt：k=0 是恆等排列，0..n!-1 是 bijection', () => {
  const n = 4;
  assert.deepEqual(permutationAt(0, n), [0, 1, 2, 3]);
  const seen = new Set();
  for (let k = 0; k < 24; k++) seen.add(permutationAt(k, n).join());
  assert.equal(seen.size, 24); // 每個 k 對到不同排列
});

test('shuffleStep：走 n! 步遍歷全部並回到初始，且不退化成排名 ±1 逐格走', () => {
  for (const n of [3, 4, 7]) {
    const nFact = Array.from({ length: n }, (_, i) => i + 1).reduce((a, b) => a * b);
    const step = shuffleStep(nFact);
    const seen = new Set();
    let k = 0;
    for (let i = 0; i < nFact; i++) {
      k = (k + step) % nFact;
      seen.add(permutationAt(k, n).join());
    }
    assert.equal(seen.size, nFact); // 全部排列各出現一次（step 與 n! 互質）⇒ 週期恰為 n!，之後回到初始盤面
    // 排名 ±1 逐格走一次只換尾端兩顆字母，看起來像沒洗；n=3 與 6 互質只有 ±1，豁免（§1）
    if (n >= 4) assert.ok(step > 1 && step < nFact - 1);
  }
});

// ---- storage.js ----

test('normalizeSave：壞資料一律重置成初始存檔', () => {
  for (const bad of [
    null,
    'junk',
    42,
    {},
    { version: 2 },
    { ...defaultSave(), coins: -5 },
    { ...defaultSave(), levelState: { foundWords: 'x', revealedCells: [] } },
    { ...defaultSave(), foundBonusWords: { 1: 42 } }, // 值不是陣列 → createGame 的 new Set() 會炸
  ]) {
    assert.deepEqual(normalizeSave(bad), defaultSave());
  }
});

test('normalizeSave：合法存檔保留內容並補齊缺漏 settings', () => {
  const s = { ...defaultSave(), coins: 77, currentLevel: 3, settings: { sound: false } };
  const n = normalizeSave(s);
  assert.equal(n.coins, 77);
  assert.equal(n.currentLevel, 3);
  // 缺漏欄位補預設，且不殘留已移除的舊欄位（settings 全部欄位都是 falsy 預設，逐一比對抓不到 undefined）
  assert.deepEqual(n.settings, { sound: false, tutorialDone: false, dictHintDone: false });
  // firstOpenAt 這類額外欄位要原樣保留（loadSave 靠這點沿用舊值而非重寫成現在）
  assert.equal(normalizeSave({ ...defaultSave(), firstOpenAt: 123 }).firstOpenAt, 123);
});

// ---- 玩家編號（設計文件 §9）----
// 純邏輯，但唯一會用力驗它的是**另一支程式**：tools/make-code.mjs 用 isUid/normalizeUid 擋玩家
// 回報的錯字，簽發當下不擋就會發出一張沒人兌得了的碼。校驗式或字母表改壞了，最快的發現方式
// 是「玩家說兌不了」——所以釘在這裡。固定 fixture 而非每次 newUid()：校驗碼只有 2 碼（10 bits），
// 隨機取樣的打錯測試理論上有 1/1024 機率碰巧撞對，測試不能帶著這種機率跑。
const UID = '4JGDS5XB1M9N';
const UID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{12}$/; // Crockford Base32：無 I/L/O/U

test('uid：合法編號驗得過，打錯一碼被校驗碼擋下', () => {
  assert.ok(isUid(UID));
  assert.equal(isUid(`0${UID.slice(1)}`), false); // 首碼 4 → 0
});

test('uid：newUid 產出的編號自我驗證通過，且每次都不同', () => {
  const a = newUid();
  assert.match(a, UID_SHAPE);
  assert.ok(isUid(a));
  assert.notEqual(a, newUid());
});

test('uid：isUid 擋掉壞值，非字串也不能炸（存檔被手改成數字會白屏，§17）', () => {
  for (const bad of [
    123456789012, // RegExp.test 會先字串化而過關，接著 s.slice 就 TypeError——typeof 那關就是為它寫的
    null,
    undefined,
    {},
    '',
    UID.slice(0, 11), // 太短
    `${UID}0`, // 太長
    `I${UID.slice(1)}`, // 字母表外的易混字
  ]) {
    assert.equal(isUid(bad), false);
  }
});

test('uid：玩家貼回來的樣子正規化後仍驗得過（複製鈕 → make-code.mjs 的閉環）', () => {
  // 設定卡的複製鈕給出去的就是這串（main.js 用 formatUid），make-code.mjs --uid 必須收得下
  const shown = formatUid(UID);
  assert.equal(shown, '4JGD-S5XB-1M9N');
  assert.equal(normalizeUid(shown), UID);
  assert.ok(isUid(normalizeUid(shown)));
  // 手抄常見的走樣：小寫、前後空白、把 0/1 抄成 Crockford 排除掉的 O/I/L
  assert.equal(normalizeUid(` ${shown.toLowerCase()} `), UID);
  assert.equal(normalizeUid('Ol23456789AB'), '0123456789AB');
});

test('persist：寫入失敗不往外丟（loadSave 開機就寫，丟出去會白屏）', () => {
  const original = bridge.save;
  bridge.save = () => {
    throw new Error('QuotaExceededError');
  };
  try {
    assert.doesNotThrow(() => persist(defaultSave()));
  } finally {
    bridge.save = original;
  }
});

// ---- bridge.share 的回傳決策表（UI 文件 §4-D）----
// 這張表（剪貼簿成功與否 × 有無面板 × AbortError × Windows）改壞了只有真機看得出來：分享明明
// 送出去卻閃「分享失敗」，或按了完全沒反應。§17 那幾條是手動驗收，所以純分支部分釘在這裡。
const swap = (name, value) => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  return () => (saved ? Object.defineProperty(globalThis, name, saved) : delete globalThis[name]);
};

// writes：第 n 次 writeText 成功與否（沒列到的次數一律失敗）；share：undefined = 沒有分享面板
async function shareWith({ writes = [], share, platform }) {
  const payloads = [];
  let n = 0;
  const restore = [
    swap('navigator', {
      clipboard: {
        writeText: () =>
          writes[n++] ? Promise.resolve() : Promise.reject(new Error('Document is not focused')),
      },
      share:
        share &&
        ((p) => {
          payloads.push(p);
          return share();
        }),
      userAgentData: platform ? { platform } : undefined,
    }),
    swap('document', { hasFocus: () => true }),
  ];
  try {
    const mode = await bridge.share('文案', 'https://lexoria.example/');
    return { mode, payloads, writes: n };
  } finally {
    for (const r of restore) r();
  }
}

test('bridge.share：三態回傳與 Windows 單欄位 payload（UI 文件 §4-D）', async () => {
  const ok = () => Promise.resolve();
  const abort = () => Promise.reject(Object.assign(new Error('cancel'), { name: 'AbortError' }));
  const denied = () => Promise.reject(new Error('permissions policy')); // 面板叫不起來

  // 剪貼簿真的寫進去了 → 一律 'copied'（提示「可直接貼上」），面板有沒有開、有沒有取消都一樣
  assert.equal((await shareWith({ writes: [true], share: ok })).mode, 'copied');
  assert.equal((await shareWith({ writes: [true], share: abort })).mode, 'copied');
  assert.equal((await shareWith({ writes: [true] })).mode, 'copied');
  // 面板開了但剪貼簿兩次都寫不進去 → 'shared'（不提示），而且第二次補寫真的有發生
  const both = await shareWith({ writes: [false, false], share: ok });
  assert.equal(both.mode, 'shared');
  assert.equal(both.writes, 2);
  // 第一次被「Document is not focused」擋掉、面板收掉後補寫成功 → 'copied'
  assert.equal((await shareWith({ writes: [false, true], share: abort })).mode, 'copied');
  // 面板本身失敗（非 AbortError）→ 不能當成送出成功，否則按鈕按了毫無反應
  assert.equal((await shareWith({ writes: [false, false], share: denied })).mode, 'failed');
  assert.equal((await shareWith({ writes: [false] })).mode, 'failed'); // 連面板都沒有
  // Windows 面板只讀得到單一 text 欄位 → 網址要併進去；其他平台維持分開傳（iOS 的預覽卡片）
  assert.deepEqual((await shareWith({ writes: [true], share: ok, platform: 'Windows' })).payloads, [
    { text: '文案\nhttps://lexoria.example/' },
  ]);
  assert.deepEqual((await shareWith({ writes: [true], share: ok, platform: 'macOS' })).payloads, [
    { text: '文案', url: 'https://lexoria.example/' },
  ]);
});

// ---- 查詞卡定位（dictionary-card.js fitVertically）----
// 這張卡是 position: fixed：一旦定位算式把它推出畫面，玩家既捲不到也點不到，只能重開一關。
// 曾經只夾左右不夾上下，盤面最後一列配上長釋義（WordNet 最長 311 字元）就整段掉出底部。
test('fitVertically：整張卡永遠留在畫面內（上下都夾）', () => {
  const vh = 667; // 直式手機最矮的常見值（iPhone SE）；橫式由 .rotate-mask 擋掉，不必考慮
  for (const top of [0, 8, 40, 200, 400, 520, 600, 660]) {
    for (const h of [60, 120, 280, 700]) {
      // h=700 比視窗還高：靠 max-height 夾住 + .dict-card 自己捲
      const a = { top, bottom: top + 40 };
      const { top: y, maxHeight } = fitVertically(a, h, vh);
      assert.ok(y >= 0, `錨點 ${top} 高 ${h}：top=${y} 跑到畫面上緣外`);
      assert.ok(y + Math.min(h, maxHeight) <= vh, `錨點 ${top} 高 ${h}：底部超出畫面`);
    }
  }
});

test('fitVertically：放得下就開在錨點下方，放不下才翻上去', () => {
  const a = { top: 100, bottom: 140 };
  assert.equal(fitVertically(a, 120, 667).top, 148); // 下方 511px 綽綽有餘 → 貼著錨點下緣
  const low = { top: 560, bottom: 600 };
  assert.equal(fitVertically(low, 200, 667).top, 352); // 下方只剩 51px → 翻到上方，底部貼齊 552
});

// ---- 關卡資料驗證器（設計文件 §5 步驟 6）：任何一關不合法就讓測試失敗 ----

test('data/levels/：每關通過完整驗證', () => {
  for (const level of levels) {
    const ctx = `level ${level.id}`;

    // 目標字與 bonus 不重複、彼此不重疊
    const targets = level.words.map((w) => w.word);
    assert.equal(new Set(targets).size, targets.length, `${ctx}: 目標字重複`);
    assert.equal(new Set(level.bonus).size, level.bonus.length, `${ctx}: bonus 重複`);
    for (const b of level.bonus) assert.ok(!targets.includes(b), `${ctx}: ${b} 同時是目標與 bonus`);

    // 每個字都能由轉盤字母組成（含重複字母數量）
    const count = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
    const pool = count(level.letters);
    for (const word of [...targets, ...level.bonus]) {
      assert.ok(word.length >= 3, `${ctx}: ${word} 太短`);
      for (const [ch, n] of count([...word])) {
        assert.ok((pool.get(ch) ?? 0) >= n, `${ctx}: ${word} 無法由字母 ${level.letters} 組成`);
      }
    }

    // 交叉格字母一致
    const grid = new Map();
    for (const w of level.words) {
      for (const cell of cellsOf(w)) {
        const key = `${cell.r},${cell.c}`;
        assert.ok(cell.r >= 0 && cell.c >= 0, `${ctx}: ${w.word} 超出格盤`);
        let prev = grid.get(key);
        assert.ok(!prev || prev.letter === cell.letter, `${ctx}: (${key}) 交叉字母衝突`);
        if (!prev) {
          prev = { letter: cell.letter, words: [] };
          grid.set(key, prev);
        }
        prev.words.push(w.word);
      }
    }

    // 相鄰規則：任兩個正交相鄰的格子必須同屬某個目標字，否則會拼出不在題目裡的字串
    for (const key of grid.keys()) {
      const [r, c] = key.split(',').map(Number);
      for (const nk of [`${r},${c + 1}`, `${r + 1},${c}`]) {
        if (!grid.has(nk)) continue;
        const shared = grid.get(key).words.some((w) => grid.get(nk).words.includes(w));
        assert.ok(shared, `${ctx}: (${key})-(${nk}) 相鄰但不同字，會產生意外字串`);
      }
    }

    // 格局連通：從第一個字出發，經共用格能走到所有字
    const reached = new Set([level.words[0].word]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const { words } of grid.values()) {
        if (words.some((w) => reached.has(w))) {
          for (const w of words)
            if (!reached.has(w)) {
              reached.add(w);
              grew = true;
            }
        }
      }
    }
    assert.equal(reached.size, targets.length, `${ctx}: 格局不連通`);

    // 每個目標字都有 def 與 zh（查詞功能，§6.3）
    for (const w of level.words) assert.ok(w.def, `${ctx}: ${w.word} 缺釋義`);
    for (const w of level.words) assert.ok(w.zh, `${ctx}: ${w.word} 缺中文釋義`);
  }
});

test('snapshotText：emoji 格盤——可填的格 ⬜、非格 ⬛', () => {
  const cells = [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
    { r: 1, c: 1 },
  ];
  assert.equal(snapshotText(cells), '⬜⬜\n⬛⬜');
});

// 只畫形狀不畫進度：同一關無論填到哪，分享出去的格盤都必須一模一樣
test('snapshotText：不洩漏進度——state 不影響輸出', () => {
  const shape = [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
    { r: 1, c: 1 },
  ];
  const blank = snapshotText(shape.map((c) => ({ ...c, state: 'empty' })));
  const solved = snapshotText(shape.map((c) => ({ ...c, state: 'filled' })));
  assert.equal(blank, solved);
});

// 每列對齊全靠「兩個字元同屬一個 Unicode 區塊」，混入 U+1F7Ex 色塊族就會壞（見 snapshotText 註解）
test('snapshotText：兩個字元都落在 U+2B1x 區塊', () => {
  const out = snapshotText([
    { r: 0, c: 0 },
    { r: 1, c: 1 },
  ]);
  for (const ch of [...out].filter((c) => c !== '\n')) {
    const cp = ch.codePointAt(0);
    assert.ok(
      cp >= 0x2b1b && cp <= 0x2b1c,
      `${ch} (U+${cp.toString(16).toUpperCase()}) 不在 U+2B1x 區塊，與另一色寬度會不一致`
    );
  }
});

// --- PWA shell 清單 ---
// 三份清單（main.js 的 import、index.html 的 modulepreload、sw.js 的 SHELL）純靠人工同步，
// 但漏掉的代價不對稱：sw.js 的 cache.addAll 是全有全無，一條指不到檔案的路徑會讓整個
// install 失敗，結果不是「那支模組沒離線」而是「完全沒有離線」，而且錯誤只出現在 SW console。
const SHELL_RE = /const SHELL = \[[^\]]*\]/;
const QUOTED_RE = /'([^']+)'/g;
const PRELOAD_RE = /modulepreload" href="([^"]+)"/g;
const CP_RE = /cp -r (.+) _site\//;

// SHELL 裡不是 src/*.js、但少了就會壞掉的：沒 CSS 離線是裸樣式，沒 index.json 連關卡都開不了，
// 授權條文則是設計文件 §14 的義務——條文必須跟著每一份副本走，離線也得打得開。
const SHELL_REQUIRED = [
  './',
  'manifest.webmanifest',
  'src/style.css',
  'assets/licenses.txt',
  'data/levels/index.json',
];

const ROOT = new URL('../', import.meta.url);
const readRoot = (p) => readFile(new URL(p, ROOT), 'utf8');

// 兩份清單都是拿正規表示式從原始檔刮出來的，版面一改就抓不到——沒接住的話會變成
// 「null 上取 [0]」的 TypeError，看不出真正該修的是這裡的 regex。
function extract(re, text, what) {
  const m = text.match(re);
  assert.ok(m, `${what} 的格式對不上測試的正規表示式，改了版面要一併改這裡`);
  return m;
}

const shellPaths = async () =>
  [...extract(SHELL_RE, await readRoot('sw.js'), 'sw.js 的 SHELL')[0].matchAll(QUOTED_RE)].map(
    (m) => m[1]
  );

test('sw.js SHELL 與 index.html modulepreload 涵蓋所有 src 模組，且路徑都指到真檔案', async () => {
  const shell = await shellPaths();
  const html = await readRoot('index.html');
  const preload = [...html.matchAll(PRELOAD_RE)].map((m) => m[1]);
  const modules = (await readdir(new URL('src/', ROOT)))
    .filter((f) => f.endsWith('.js'))
    .map((f) => `src/${f}`);

  for (const m of [...modules, ...SHELL_REQUIRED]) {
    assert.ok(shell.includes(m), `sw.js 的 SHELL 少了 ${m}——它不會進離線快取`);
  }
  for (const m of modules) {
    assert.ok(preload.includes(m), `index.html 的 modulepreload 少了 ${m}——模組瀑布會退回多一趟`);
  }
  for (const p of new Set([...shell, ...preload])) {
    if (p === './') continue;
    assert.ok(existsSync(new URL(p, ROOT)), `清單指到不存在的檔案：${p}`);
  }
  // addAll 是單一 batch，同一個 URL 出現兩次直接 InvalidStateError——失敗方式跟壞路徑一樣是
  // 「完全沒有離線」。比對解析後的網址，'./src/x.js' 跟 'src/x.js' 這種寫法差異也算重複。
  const urls = shell.map((p) => new URL(p, ROOT).href);
  assert.equal(
    new Set(urls).size,
    urls.length,
    'sw.js 的 SHELL 有重複路徑——addAll 會整批失敗，等於完全沒有離線'
  );
});

// deploy.yml 是逐項 cp 的白名單，漏掉的失敗完全無聲：本機 bun run serve 一切正常、
// bun run check 全綠，正式站卻是 sw.js 404 而 register() 的 .catch() 把它吞掉（設計文件 §15）。
test('deploy.yml 的 cp 清單涵蓋 sw.js 與 SHELL 用到的每個根目錄項目', async () => {
  const shell = await shellPaths();
  const deploy = await readRoot('.github/workflows/deploy.yml');
  const staged = new Set(extract(CP_RE, deploy, 'deploy.yml 的 cp 清單')[1].split(' '));

  for (const p of [...shell, 'sw.js']) {
    const top = p === './' ? 'index.html' : p.split('/')[0];
    assert.ok(staged.has(top), `deploy.yml 的 cp 清單少了 ${top}——正式站直接沒有這個檔案`);
  }
});

// --- .local.* 引用 ---
// `.gitignore` 吃掉整個 `*.local.*`，所以引用它的註解／文件在別人的 clone 裡就是斷鏈：
// 句子照樣讀得通、只是指向不存在的檔案，跟 SHELL 少一條路徑一樣完全無聲（CLAUDE.md 有這條規則）。
// 用 git ls-files 而不是自己走目錄：判準本來就是「有沒有進版控」。
const TEXT_FILE_RE = /\.(js|mjs|md|html|css|json|toml|ya?ml)$/;
// CLAUDE.md 那條規則本身寫的就是 `.local.*`，是規則不是引用——後面接萬用字元的就跳過
const LOCAL_CITE_RE = /\.local\.[\w-]/;

test('版控裡的原始碼與文件都沒有引用 .local.* 檔案', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((p) => TEXT_FILE_RE.test(p) && !p.startsWith('data/levels/'));
  for (const p of tracked) {
    const hits = readFileSync(new URL(p, ROOT), 'utf8')
      .split('\n')
      .filter((line) => LOCAL_CITE_RE.test(line));
    assert.equal(
      hits.length,
      0,
      `${p} 引用了 .local.* 檔案（別人 clone 後只會拿到斷鏈）：\n${hits.join('\n')}`
    );
  }
});
