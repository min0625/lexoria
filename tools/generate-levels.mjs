// 關卡產生器（設計文件 §5）——建置期離線產生，執行期不算關卡。
// 輸入：tools/data/enable1.txt（bonus 判定字典）+ tools/data/wordinfo.json（字頻+釋義，見 fetch-data.mjs）
// 輸出：data/levels/<id>.json（每關一份，前端按需 fetch，首次載入不用整批下載）+
// data/levels/index.json（僅 { "count" }，前端用來畫關卡選單、判斷最後一關）。
// 最後一步驗證器：任何一關不合法 → 整批建置失敗。
// 亂數種子固定為關卡 id：重跑輸出完全相同，關卡才能進版控、diff 才有意義。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const N_LEVELS = 500;
const ATTEMPTS = 20; // 同一組字跑 20 版挑最好看的（§5）
const MIX_FROM = 301; // 這關起不再單調變難，改為混合難度（§5 步驟 5）

// 難度曲線（§5 步驟 5）：前期字母少、字都很常見；後期字母多、字頻門檻放寬。
// zipf：目標字最低字頻；baseZipf：基底字（轉盤字母來源）最低字頻；targets：目標字數範圍。
const BANDS = [
  // 3 字母的目標字只能是基底字的異位構詞，常見字裡可出題的組合僅 20 出頭 → 上限 15 關
  { upTo: 15, len: 3, targets: [2, 3], zipf: 4.0, baseZipf: 4.5 },
  { upTo: 100, len: 4, targets: [3, 4], zipf: 3.6, baseZipf: 4.0 },
  { upTo: 200, len: 5, targets: [4, 5], zipf: 3.4, baseZipf: 3.8 },
  { upTo: 300, len: 6, targets: [5, 6], zipf: 3.2, baseZipf: 3.5 },
  { upTo: Infinity, len: 7, targets: [6, 8], zipf: 3.0, baseZipf: 3.3 },
];

// 前段照 upTo 遞增爬坡；MIX_FROM 起改擲骰（種子仍是關卡 id，輸出照樣確定性）：
// 約 30% 抽到 4–5 字母的喘息關，其餘在 6–7 字母之間交替。
function bandFor(id, rng) {
  if (id < MIX_FROM) return BANDS.findIndex((b) => id <= b.upTo);
  const r = rng();
  if (r < 0.1) return 1;
  if (r < 0.3) return 2;
  if (r < 0.65) return 3;
  return 4;
}

// ---- 資料載入與 alphagram 索引（§5 步驟 2：不要枚舉排列）----

const VALID_WORD = /^[a-z]{3,7}$/;
const enable = readFileSync(new URL('./data/enable1.txt', import.meta.url), 'utf8')
  .split('\n')
  .map((w) => w.trim())
  .filter((w) => VALID_WORD.test(w));
const wordinfo = JSON.parse(readFileSync(new URL('./data/wordinfo.json', import.meta.url), 'utf8'));

const alphagram = (w) => [...w].sort().join('');
const index = new Map(); // 排序後字母 → [單字]
for (const w of enable) {
  const key = alphagram(w);
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(w);
}

// 基底字的 multiset 子集最多 2^7 = 128 個，每個排序後查一次索引
function subwords(base) {
  const uniq = [...new Set(base)].sort();
  const counts = uniq.map((u) => [...base].filter((ch) => ch === u).length);
  const found = new Set();
  const rec = (i, cur) => {
    if (i === uniq.length) {
      if (cur.length >= 3) for (const w of index.get(cur) ?? []) found.add(w);
      return;
    }
    for (let k = 0; k <= counts[i]; k++) rec(i + 1, cur + uniq[i].repeat(k));
  };
  rec(0, '');
  return [...found];
}

// ---- 確定性亂數 ----

const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- 回溯擺放（§5 步驟 4）----

function tryLayout(words, rng) {
  // 依長度遞減；同長度之間靠洗牌換順序，多版挑最好
  const order = shuffle([...words], rng).sort((a, b) => b.length - a.length);
  const grid = new Map(); // 'r,c' → 字母
  const placements = [];
  let crossings = 0;

  const cellsOf = (word, row, col, dir) =>
    [...word].map((letter, i) =>
      dir === 'across' ? { r: row, c: col + i, letter } : { r: row + i, c: col, letter }
    );

  // 合法 = 每格空白或字母相同，且頭尾外側一格是空的，
  // 且每個非交叉格的垂直向鄰格是空的（漏了會拼出不在題目裡的相鄰字串）
  function canPlace(word, row, col, dir) {
    let cross = 0;
    for (const { r, c, letter } of cellsOf(word, row, col, dir)) {
      const cur = grid.get(`${r},${c}`);
      if (cur !== undefined) {
        if (cur !== letter) return -1;
        cross++;
      } else {
        const sides =
          dir === 'across'
            ? [`${r - 1},${c}`, `${r + 1},${c}`]
            : [`${r},${c - 1}`, `${r},${c + 1}`];
        if (sides.some((k) => grid.has(k))) return -1;
      }
    }
    const before = dir === 'across' ? `${row},${col - 1}` : `${row - 1},${col}`;
    const after = dir === 'across' ? `${row},${col + word.length}` : `${row + word.length},${col}`;
    if (grid.has(before) || grid.has(after)) return -1;
    return cross;
  }

  function put(word, row, col, dir) {
    const added = [];
    for (const { r, c, letter } of cellsOf(word, row, col, dir)) {
      const key = `${r},${c}`;
      if (!grid.has(key)) {
        grid.set(key, letter);
        added.push(key);
      }
    }
    placements.push({ word, row, col, dir });
    return added;
  }

  function rec(k) {
    if (k === order.length) return true;
    const w = order[k];
    const cands = [];
    for (const p of placements) {
      const dir = p.dir === 'across' ? 'down' : 'across';
      for (let i = 0; i < w.length; i++) {
        for (let j = 0; j < p.word.length; j++) {
          if (w[i] !== p.word[j]) continue;
          cands.push(
            dir === 'down'
              ? { row: p.row - i, col: p.col + j, dir }
              : { row: p.row + j, col: p.col - i, dir }
          );
        }
      }
    }
    shuffle(cands, rng);
    for (const { row, col, dir } of cands) {
      const cross = canPlace(w, row, col, dir);
      if (cross < 0) continue;
      const added = put(w, row, col, dir);
      crossings += cross;
      if (rec(k + 1)) return true;
      crossings -= cross;
      for (const key of added) grid.delete(key);
      placements.pop();
    }
    return false;
  }

  put(order[0], 0, 0, 'across');
  if (!rec(1)) return null;

  // 平移到 (0,0) 起點的 bounding box
  const rs = placements.flatMap((p) => cellsOf(p.word, p.row, p.col, p.dir).map((c) => c.r));
  const cs = placements.flatMap((p) => cellsOf(p.word, p.row, p.col, p.dir).map((c) => c.c));
  const minR = Math.min(...rs);
  const minC = Math.min(...cs);
  return {
    placements: placements.map((p) => ({ ...p, row: p.row - minR, col: p.col - minC })),
    crossings,
    rows: Math.max(...rs) - minR + 1,
    cols: Math.max(...cs) - minC + 1,
  };
}

// 同一組字跑 ATTEMPTS 版：交叉點多、bounding box 小、長寬比接近直式螢幕者勝
function bestLayout(words, levelId) {
  let best = null;
  for (let a = 0; a < ATTEMPTS; a++) {
    const layout = tryLayout(words, mulberry32(levelId * 100 + a));
    if (!layout) continue;
    const score =
      layout.crossings * 10 -
      layout.rows * layout.cols -
      Math.abs(layout.rows / layout.cols - 1.4) * 8;
    if (!best || score > best.score) best = { ...layout, score };
  }
  return best;
}

// ---- 單關組裝（§5 步驟 3–4）----

function buildLevel(id, base, band, rng) {
  const subs = subwords(base);
  const cands = subs
    .filter((w) => w !== base && wordinfo[w] && wordinfo[w].z >= band.zipf)
    .sort((a, b) => wordinfo[b].z - wordinfo[a].z); // 常見優先
  const nTargets = band.targets[0] + Math.floor(rng() * (band.targets[1] - band.targets[0] + 1));
  if (1 + cands.length < nTargets) return null; // 候選不夠 → 換基底字

  const pool = [base, ...cands]; // 基底字（最長）永遠是目標
  let chosen = pool.slice(0, nTargets);
  let next = nTargets;
  while (true) {
    const layout = bestLayout(chosen, id);
    if (layout) {
      const targets = new Set(chosen);
      return {
        id,
        letters: shuffle([...base.toUpperCase()], rng), // 打亂，別讓初始轉盤直接排出基底字
        words: layout.placements.map((p) => ({
          word: p.word.toUpperCase(),
          row: p.row,
          col: p.col,
          dir: p.dir,
          def: wordinfo[p.word].def,
          zh: wordinfo[p.word].zh,
        })),
        bonus: subs
          .filter((w) => !targets.has(w))
          .sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
          .map((w) => w.toUpperCase()),
      };
    }
    // 徹底擺不進去（罕見）：最不常見的目標丟回 bonus，從候選遞補（§5）
    if (next < pool.length) chosen = [...chosen.slice(0, -1), pool[next++]];
    else if (chosen.length > band.targets[0]) chosen = chosen.slice(0, -1);
    else return null;
  }
}

// ---- 驗證器（§5 步驟 6，與 tests/game.test.mjs 的關卡驗證同一套規則）----

function validate(level) {
  const ctx = `level ${level.id}`;
  const fail = (msg) => {
    throw new Error(`${ctx}: ${msg}`);
  };

  const targets = level.words.map((w) => w.word);
  if (new Set(targets).size !== targets.length) fail('目標字重複');
  if (new Set(level.bonus).size !== level.bonus.length) fail('bonus 重複');
  for (const b of level.bonus) if (targets.includes(b)) fail(`${b} 同時是目標與 bonus`);

  const count = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const pool = count(level.letters);
  for (const word of [...targets, ...level.bonus]) {
    if (word.length < 3) fail(`${word} 太短`);
    for (const [ch, n] of count([...word])) {
      if ((pool.get(ch) ?? 0) < n) fail(`${word} 無法由字母 ${level.letters} 組成`);
    }
  }

  const grid = new Map();
  for (const w of level.words) {
    for (let i = 0; i < w.word.length; i++) {
      const r = w.dir === 'down' ? w.row + i : w.row;
      const c = w.dir === 'across' ? w.col + i : w.col;
      if (r < 0 || c < 0) fail(`${w.word} 超出格盤`);
      const key = `${r},${c}`;
      const prev = grid.get(key) ?? { letter: w.word[i], words: [] };
      if (prev.letter !== w.word[i]) fail(`(${key}) 交叉字母衝突`);
      prev.words.push(w.word);
      grid.set(key, prev);
    }
  }

  for (const key of grid.keys()) {
    const [r, c] = key.split(',').map(Number);
    for (const nk of [`${r},${c + 1}`, `${r + 1},${c}`]) {
      if (!grid.has(nk)) continue;
      if (!grid.get(key).words.some((w) => grid.get(nk).words.includes(w))) {
        fail(`(${key})-(${nk}) 相鄰但不同字，會產生意外字串`);
      }
    }
  }

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
  if (reached.size !== targets.length) fail('格局不連通');

  for (const w of level.words) if (!w.def) fail(`${w.word} 缺釋義`);
  for (const w of level.words) if (!w.zh) fail(`${w.word} 缺中文釋義`);
}

// ---- 主流程 ----

// 每個 band 的基底字候選（固定種子洗牌一次 → 整批輸出確定性）
const bandCands = BANDS.map((band, bi) =>
  shuffle(
    Object.keys(wordinfo).filter((w) => w.length === band.len && wordinfo[w].z >= band.baseZipf),
    mulberry32(1000 + bi)
  )
);
const bandCursor = BANDS.map(() => 0);
const usedAlpha = new Set(); // 同一組字母不出兩關

const levels = [];
for (let id = 1; id <= N_LEVELS; id++) {
  const rng = mulberry32(id);
  const bi = bandFor(id, rng);
  let level = null;
  while (!level) {
    if (bandCursor[bi] >= bandCands[bi].length) throw new Error(`level ${id}: 基底字候選用罄`);
    const base = bandCands[bi][bandCursor[bi]++];
    if (usedAlpha.has(alphagram(base))) continue;
    level = buildLevel(id, base, BANDS[bi], rng);
    if (level) usedAlpha.add(alphagram(base));
  }
  validate(level); // 任何一關失敗 → 整批失敗
  levels.push(level);
}

// 每關一個檔案，前端 startLevel() 按需 fetch——首次載入只需 index.json + 當前那一關。
const levelsDir = new URL('../data/levels/', import.meta.url);
rmSync(levelsDir, { recursive: true, force: true }); // 關卡數可能變動，先清空舊檔避免殘留
mkdirSync(levelsDir, { recursive: true });
for (const l of levels)
  writeFileSync(new URL(`${l.id}.json`, levelsDir), `${JSON.stringify(l, null, 2)}\n`);
writeFileSync(new URL('index.json', levelsDir), `${JSON.stringify({ count: levels.length })}\n`);

const stat = (f) => {
  const v = levels.map(f);
  return `${Math.min(...v)}–${Math.max(...v)}`;
};
console.log(`data/levels/：${levels.length} 關`);
console.log(
  `目標字數 ${stat((l) => l.words.length)}、bonus 數 ${stat((l) => l.bonus.length)}、格盤 ${stat((l) => Math.max(...l.words.map((w) => (w.dir === 'down' ? w.row + w.word.length : w.row + 1))))}×${stat((l) => Math.max(...l.words.map((w) => (w.dir === 'across' ? w.col + w.word.length : w.col + 1))))}`
);
