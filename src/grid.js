// 填字格渲染：CSS Grid + DOM（設計文件 §3）。狀態變化只加/減 class，動畫交給 CSS。
import { cellsOf } from './game.js';

export function createGrid(container, level, { onCellTap }) {
  container.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'grid';

  // 由關卡資料算出格盤範圍
  const all = level.words.flatMap(cellsOf);
  const rows = Math.max(...all.map((c) => c.r)) + 1;
  const cols = Math.max(...all.map((c) => c.c)) + 1;
  el.style.setProperty('--rows', rows);
  el.style.setProperty('--cols', cols);

  // 每格記錄它屬於哪些目標字（交叉格屬於兩個）
  const cellEls = new Map();
  for (const entry of level.words) {
    for (const cell of cellsOf(entry)) {
      const key = `${cell.r},${cell.c}`;
      let d = cellEls.get(key);
      if (!d) {
        d = document.createElement('div');
        d.className = 'cell';
        d.style.gridArea = `${cell.r + 1} / ${cell.c + 1}`;
        d.dataset.key = key;
        d.dataset.words = entry.word;
        el.appendChild(d);
        cellEls.set(key, d);
      } else {
        d.dataset.words += ` ${entry.word}`;
      }
    }
  }

  el.addEventListener('click', (ev) => {
    const d = ev.target.closest('.cell');
    if (d) onCellTap(d.dataset.words.split(' '), d);
  });
  container.appendChild(el);

  return {
    // 依 game.getCells() 同步畫面；animate=true 時新填的格子播飛入動畫
    update(cells, animate = true) {
      for (const cell of cells) {
        const d = cellEls.get(`${cell.r},${cell.c}`);
        const show = cell.state !== 'empty';
        if (show && !d.classList.contains('on')) {
          d.textContent = cell.letter;
          d.classList.add('on');
          if (animate) {
            d.classList.add('pop');
            d.addEventListener('animationend', () => d.classList.remove('pop'), { once: true });
          }
        }
      }
    },
  };
}

// 分享用快照：canvas 重繪格盤色塊（不畫字母——防雷）+ 字母盤（字母本來就公開），回傳 PNG Blob。
// 顏色讀既有 CSS 變數，自動跟淺／深主題，不維護第二份色票。
export function snapshotBlob(cells, letters, title) {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  const CELL = 48;
  const GAP = 6;
  const PAD = 24;
  const HEAD = 56; // 頂部標題列高度
  const WHEEL_R = 80; // 字母盤半徑
  const rows = Math.max(...cells.map((c) => c.r)) + 1;
  const cols = Math.max(...cells.map((c) => c.c)) + 1;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `800 24px ${v('--font-display')}`;
  ctx.font = font;
  const gridW = cols * (CELL + GAP) - GAP;
  const gridH = rows * (CELL + GAP) - GAP;
  // 小格盤（3 字母關）比標題／字母盤窄，取最寬者；置寬後 canvas 狀態重設，字型要重新設
  canvas.width = PAD * 2 + Math.max(gridW, ctx.measureText(title).width, WHEEL_R * 2);
  canvas.height = HEAD + gridH + PAD + WHEEL_R * 2 + PAD;
  const offX = (canvas.width - gridW) / 2; // 格盤水平置中

  ctx.fillStyle = v('--bg');
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = v('--text');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillText(title, PAD, HEAD / 2 + PAD / 4);

  for (const cell of cells) {
    ctx.fillStyle = cell.state === 'empty' ? v('--grid-empty') : v('--grid-filled');
    ctx.beginPath();
    ctx.roundRect(offX + cell.c * (CELL + GAP), HEAD + cell.r * (CELL + GAP), CELL, CELL, 8);
    ctx.fill();
  }

  // 字母盤：照 wheel.js 的初始排列（k=0），角度 = 2πi/n − π/2
  const cx = canvas.width / 2;
  const cy = HEAD + gridH + PAD + WHEEL_R;
  const r = Math.max(20, WHEEL_R * 0.26); // 字母鈕半徑，同 wheel.js 比例
  ctx.fillStyle = v('--surface');
  ctx.beginPath();
  ctx.arc(cx, cy, WHEEL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'center';
  for (let i = 0; i < letters.length; i++) {
    const angle = (Math.PI * 2 * i) / letters.length - Math.PI / 2;
    const x = cx + Math.cos(angle) * (WHEEL_R - r);
    const y = cy + Math.sin(angle) * (WHEEL_R - r);
    ctx.fillStyle = v('--surface-hi');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = v('--text');
    ctx.fillText(letters[i].toUpperCase(), x, y);
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  );
}
