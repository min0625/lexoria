// 字母轉盤 + 手勢（設計文件 §4）。
// 命中與選取邏輯是純函式（hitIndex / applyHit），與 DOM 分離以便單元測試（§12）。

const LETTER_KEY = /^[a-zA-Z]$/;

// 命中判斷：手指座標與每個字母圓心的距離 < 命中半徑（不用 elementFromPoint）。
// 命中半徑 = 視覺半徑 × factor，但夾在「最近字母圓心間距 × 0.35」以下：
// 3–4 顆的大間距輪盤維持寬鬆手感，6–7 顆的擁擠輪盤命中圓自動縮小，
// 任兩顆字母之間永遠留 ≥ 30% 間距的死區，手指掃過中間不會誤觸隔壁；
// 範圍內仍取最近的圓心保險。
export function hitIndex(x, y, spots, factor = 1.2) {
  let gap = Infinity;
  for (const a of spots)
    for (const b of spots) if (a !== b) gap = Math.min(gap, Math.hypot(a.x - b.x, a.y - b.y));
  let best = -1;
  let bestD = Infinity;
  for (const s of spots) {
    const d = Math.hypot(x - s.x, y - s.y);
    if (d < Math.min(s.r * factor, gap * 0.35) && d < bestD) {
      bestD = d;
      best = s.i;
    }
  }
  return best;
}

// 選取更新：選取狀態綁「按鈕實例」而非字母值（重複字母各算一顆，§1）。
// 滑回倒數第二顆 = 取消最後一顆；其他已選過的按鈕不再生效。
export function applyHit(selected, i) {
  if (i < 0) return selected;
  const pos = selected.indexOf(i);
  if (pos === -1) return [...selected, i];
  if (pos === selected.length - 2) return selected.slice(0, -1);
  return selected;
}

// 洗牌不是隨機:把 0..n!-1 的第 k 個排列用階乘進位制(Lehmer code)解碼出來。
// 每按一次 k 前進一個與 n! 互質的步距,保證 n! 次內每種排列恰好出現一次、
// 之後回到 k=0 的初始盤面,且相鄰兩次盤面必不同(§1)。
// 步距取最接近 0.618·n! 的互質數(黃金比例跳距):固定小步距在小輪會退化成
// 排名逐格走,一次只換尾端兩顆字母,看起來像沒洗。例外:n=3 與 6 互質只有 ±1
// 無法避免退化,但 3 顆中任何重排必動 2 顆,體感仍明顯(§1)。
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export function shuffleStep(nFact) {
  let s = Math.round(nFact * 0.618) || 1;
  while (gcd(s, nFact) > 1) s++; // 最遠爬到 n!-1(必與 n! 互質)
  return s;
}

export function permutationAt(k, n) {
  const avail = Array.from({ length: n }, (_, i) => i);
  let f = 1;
  for (let i = 2; i < n; i++) f *= i; // f = (n-1)!
  const out = [];
  for (let i = n - 1; i >= 1; f /= i, i--) {
    out.push(avail.splice(Math.floor(k / f), 1)[0]);
    k %= f;
  }
  if (n > 0) out.push(avail[0]);
  return out;
}

export function createWheel(container, letters, { onChange, onSubmit }) {
  container.innerHTML = '';
  // 監聽器都掛在 container / window 上，換關重建時必須全部收掉：
  // 殘留的舊 pointerdown 會 setPointerCapture，把新洗牌鈕的 click 吃掉。
  const ac = new AbortController();
  const opts = { signal: ac.signal };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('wheel-lines');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  svg.appendChild(line);
  container.appendChild(svg);

  const buttons = letters.map((letter, i) => {
    const b = document.createElement('button');
    b.className = 'wheel-letter';
    b.textContent = letter;
    b.dataset.index = i;
    container.appendChild(b);
    return b;
  });

  const shuffleBtn = document.createElement('button');
  shuffleBtn.className = 'wheel-shuffle';
  shuffleBtn.innerHTML = '<span class="icon icon-shuffle"></span>';
  shuffleBtn.setAttribute('aria-label', 'shuffle');
  container.appendChild(shuffleBtn);

  // 盤面唯一的洗牌狀態:排列編號 k。按鈕 i 的圓周位置 = permutationAt(k)[i],
  // k=0 是恆等排列;換關重建 wheel 自然歸零回初始盤面。
  let shuffleK = 0;
  const nFact = letters.reduce((f, _, i) => f * (i + 1), 1);
  const step = shuffleStep(nFact);

  let selected = [];
  let dragging = false;
  let spots = []; // 手勢開始時快照各按鈕圓心（container 座標）
  let base = null; // 同一份快照裡的 container 位置，換算指標座標用

  function layout() {
    spots = []; // 按鈕移位了，舊快照作廢
    const slots = permutationAt(shuffleK, buttons.length);
    const rect = container.getBoundingClientRect();
    const R = rect.width / 2;
    const r = Math.max(26, R * 0.26);
    buttons.forEach((b, i) => {
      const angle = (Math.PI * 2 * slots[i]) / buttons.length - Math.PI / 2;
      const x = R + Math.cos(angle) * (R - r);
      const y = R + Math.sin(angle) * (R - r);
      b.style.width = b.style.height = `${r * 2}px`;
      b.style.left = `${x - r}px`;
      b.style.top = `${y - r}px`;
    });
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  }
  layout();
  const ro = new ResizeObserver(layout);
  ro.observe(container);

  const word = () => selected.map((i) => letters[i]).join('');

  function render() {
    buttons.forEach((b, i) => {
      b.classList.toggle('selected', selected.includes(i));
    });
    // 圓心用 spots 的快照，不要在這裡讀 offsetLeft/offsetWidth：上一行剛改完 class，
    // 緊接著讀版面屬性會強制同步 reflow，每次選到新字母都付一次。
    if (selected.length && !spots.length) snapshotSpots(); // 鍵盤輸入沒有 pointerdown 快照
    const pts = selected.map((i) => `${spots[i].x},${spots[i].y}`);
    line.setAttribute('points', pts.join(' '));
    onChange(word());
  }

  function snapshotSpots() {
    base = container.getBoundingClientRect();
    spots = buttons.map((b, i) => {
      const r = b.getBoundingClientRect();
      return {
        i,
        x: r.left - base.left + r.width / 2,
        y: r.top - base.top + r.height / 2,
        r: r.width / 2,
      };
    });
  }

  // 沿用手勢開始時的 base：每個 pointermove 都呼叫 getBoundingClientRect() 會強制同步
  // reflow，那是拖曳過程中唯一逐事件付出的成本。轉盤是 touch-action: none，手勢進行中
  // 頁面不會捲動，快照不會過期。
  function toLocal(ev) {
    return { x: ev.clientX - base.left, y: ev.clientY - base.top };
  }

  container.addEventListener(
    'pointerdown',
    (ev) => {
      if (shuffleBtn.contains(ev.target)) return; // 點到的常是鈕內的 icon span，=== 比對會漏
      dragging = true;
      selected = [];
      // 手指滑出轉盤、畫面外放開，pointerup 仍會送回來（§4）。
      container.setPointerCapture(ev.pointerId);
      snapshotSpots();
      const { x, y } = toLocal(ev);
      selected = applyHit(selected, hitIndex(x, y, spots));
      render();
    },
    opts
  );

  container.addEventListener(
    'pointermove',
    (ev) => {
      if (!dragging) return;
      const { x, y } = toLocal(ev);
      const next = applyHit(selected, hitIndex(x, y, spots));
      if (next !== selected) {
        selected = next;
        render();
      }
    },
    opts
  );

  function finish() {
    if (!dragging) return;
    dragging = false;
    const w = word();
    selected = [];
    render();
    // 長度 < 3 直接吞掉，不進判定（§1、§10）。
    if (w.length >= 3) onSubmit(w);
  }
  container.addEventListener('pointerup', finish, opts);
  container.addEventListener('pointercancel', finish, opts);

  shuffleBtn.addEventListener(
    'click',
    () => {
      if (dragging) return; // 手勢進行中洗牌不生效（§1）
      shuffleK = (shuffleK + step) % nFact;
      layout();
    },
    opts
  );

  // 開發期鍵盤輸入（§12）：字母鍵選字、Backspace 取消最後一個、Enter 送出。非玩家功能。
  function onKey(ev) {
    if (ev.target.matches?.('input, textarea')) return; // 打字目標是表單欄位（如兌換碼框）就不搶
    if (ev.key === 'Enter') {
      const w = word();
      selected = [];
      render();
      if (w.length >= 3) onSubmit(w);
    } else if (ev.key === 'Backspace') {
      selected = selected.slice(0, -1);
      render();
    } else if (LETTER_KEY.test(ev.key)) {
      const L = ev.key.toUpperCase();
      const i = letters.findIndex((l, idx) => l === L && !selected.includes(idx));
      if (i !== -1) {
        selected = [...selected, i];
        render();
      }
    }
  }
  window.addEventListener('keydown', onKey, opts);

  return {
    destroy() {
      ac.abort();
      ro.disconnect();
      container.innerHTML = '';
    },
    // 目前畫面上的字母排列（依洗牌後的視覺位置），供分享快照使用，避免快照跟畫面對不上。
    getLetters() {
      const slots = permutationAt(shuffleK, buttons.length);
      const order = [];
      slots.forEach((pos, i) => {
        order[pos] = letters[i];
      });
      return order;
    },
  };
}
