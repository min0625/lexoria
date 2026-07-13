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
