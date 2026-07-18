// 純邏輯單元測試（設計文件 §12）：node --test tests/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { bridge } from '../src/bridge.js';
import { cellsOf, createGame, ECONOMY } from '../src/game.js';
import { defaultSave, normalizeSave, persist } from '../src/storage.js';
import { applyHit, hitIndex, permutationAt, shuffleStep } from '../src/wheel.js';

const levels = JSON.parse(await readFile(new URL('../data/levels.json', import.meta.url)));

// 邏輯測試用固定 fixture（原手刻第 1、2 關）——levels.json 已由產生器輸出，內容會變動，
// 單元測試不能依賴它；末尾的關卡驗證器才是針對 levels.json 的測試。
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
  assert.equal(n.settings.sound, false);
  assert.equal(n.settings.haptic, true); // 缺漏欄位補預設
  // firstOpenAt 這類額外欄位要原樣保留（loadSave 靠這點沿用舊值而非重寫成現在）
  assert.equal(normalizeSave({ ...defaultSave(), firstOpenAt: 123 }).firstOpenAt, 123);
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

// ---- 關卡資料驗證器（設計文件 §5 步驟 6）：任何一關不合法就讓測試失敗 ----

test('levels.json：每關通過完整驗證', () => {
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
