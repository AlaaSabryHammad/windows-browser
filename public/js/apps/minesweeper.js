/* Minesweeper — Beginner / Intermediate / Expert, first click safe, chording, best times. */
import { createWindow } from '../wm.js';
import { I } from '../icons.js';
import { notify, contextMenu, msgDialog } from '../ui.js';

const LEVELS = {
  beginner: { w: 9, h: 9, mines: 10, label: 'Beginner' },
  intermediate: { w: 16, h: 16, mines: 40, label: 'Intermediate' },
  expert: { w: 30, h: 16, mines: 99, label: 'Expert' },
};
const KEY = 'webwin-mines-v1';
const loadStore = () => { try { return { level: 'beginner', best: {}, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { level: 'beginner', best: {} }; } };

export function open() {
  const store = loadStore();
  const saveStore = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* ignore */ } };
  const win = createWindow({ title: 'Minesweeper', icon: I.mine, appId: 'minesweeper', w: 340, h: 470, minW: 300, minH: 380, noRemember: true });
  win.body.innerHTML = `
    <div class="mines">
      <div class="np-menu ms-menu"><div class="np-m" data-m="game">Game</div><div class="np-m" data-m="help">Help</div></div>
      <div class="ms-wrap">
        <div class="ms-head">
          <div class="ms-counter mines-left">010</div>
          <button class="ms-face" title="New game (F2)">🙂</button>
          <div class="ms-counter ms-time">000</div>
        </div>
        <div class="ms-board"></div>
      </div>
      <div class="ms-msg"></div>
    </div>`;

  const root = win.body.querySelector('.mines');
  const boardEl = root.querySelector('.ms-board');
  const face = root.querySelector('.ms-face');
  const minesEl = root.querySelector('.mines-left');
  const timeEl = root.querySelector('.ms-time');
  const msgEl = root.querySelector('.ms-msg');

  let L, cells, revealed, flags, over, timer, seconds, firstClick;

  function fitWindow() {
    const w = Math.max(300, L.w * 24 + 60), h = L.h * 24 + 190;
    win.el.style.width = Math.min(innerWidth, w) + 'px';
    win.el.style.height = Math.min(innerHeight - 40, h) + 'px';
  }

  function reset(level = store.level) {
    store.level = level; saveStore();
    L = LEVELS[level];
    cells = Array.from({ length: L.w * L.h }, (_, i) => ({ i, mine: false, open: false, flag: false, n: 0, x: i % L.w, y: Math.floor(i / L.w) }));
    revealed = 0; flags = 0; over = false; firstClick = true; seconds = 0;
    clearInterval(timer);
    face.textContent = '🙂';
    msgEl.textContent = `${L.label} · Best: ${store.best[level] != null ? store.best[level] + 's' : '—'}`;
    timeEl.textContent = '000';
    updMines();
    fitWindow();
    render();
  }

  function updMines() { minesEl.textContent = String(Math.max(-99, L.mines - flags)).padStart(3, '0'); }

  const neighbors = (c) => {
    const res = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = c.x + dx, y = c.y + dy;
      if (x >= 0 && x < L.w && y >= 0 && y < L.h) res.push(cells[y * L.w + x]);
    }
    return res;
  };

  function placeMines(safe) {
    const forbidden = new Set([safe.i, ...neighbors(safe).map(n => n.i)]);
    let placed = 0;
    while (placed < L.mines) {
      const i = Math.floor(Math.random() * cells.length);
      if (forbidden.has(i) || cells[i].mine) continue;
      cells[i].mine = true;
      placed++;
    }
    for (const c of cells) c.n = neighbors(c).filter(n => n.mine).length;
  }

  function startTimer() {
    timer = setInterval(() => { seconds++; timeEl.textContent = String(Math.min(999, seconds)).padStart(3, '0'); }, 1000);
  }

  function openCell(c) {
    const stack = [c];
    while (stack.length) {
      const cur = stack.pop();
      if (cur.open || cur.flag || over) continue;
      cur.open = true;
      revealed++;
      if (cur.mine) { lose(cur); return; }
      if (cur.n === 0) neighbors(cur).forEach(n => { if (!n.open && !n.flag) stack.push(n); });
    }
    if (revealed === cells.length - L.mines) winGame();
  }

  function chord(c) {
    if (!c.open || !c.n) return;
    const ns = neighbors(c);
    if (ns.filter(n => n.flag).length !== c.n) return;
    ns.forEach(n => { if (!n.open && !n.flag) openCell(n); });
  }

  function lose(hit) {
    over = true;
    clearInterval(timer);
    face.textContent = '😵';
    cells.forEach(c => { if (c.mine && !c.flag) c.open = true; if (c.flag && !c.mine) c.wrong = true; });
    hit.boom = true;
    msgEl.textContent = 'Boom! You hit a mine. Click 🙂 to try again.';
    render();
  }

  function winGame() {
    over = true;
    clearInterval(timer);
    face.textContent = '😎';
    cells.forEach(c => { if (c.mine && !c.flag) { c.flag = true; flags++; } });
    updMines();
    const best = store.best[store.level];
    const record = best == null || seconds < best;
    if (record) { store.best[store.level] = seconds; saveStore(); }
    msgEl.textContent = `You cleared it in ${seconds}s! ${record ? '🏆 New best time!' : `Best: ${best}s`}`;
    render();
    notify('Minesweeper', `${L.label} board cleared in ${seconds} seconds.${record ? ' New record!' : ''}`, I.mine);
  }

  function render() {
    boardEl.style.gridTemplateColumns = `repeat(${L.w}, 24px)`;
    boardEl.innerHTML = '';
    for (const c of cells) {
      const el = document.createElement('div');
      let cls = 'ms-cell';
      if (c.open) {
        cls += ' open';
        if (c.mine) { cls += ' mine'; el.textContent = '💣'; }
        else if (c.n) { cls += ` n${c.n}`; el.textContent = c.n; }
      } else if (c.flag) el.textContent = c.wrong ? '❌' : '🚩';
      if (c.boom) cls += ' boom';
      el.className = cls;
      el.addEventListener('pointerdown', (e) => { if (!over && e.button === 0) face.textContent = '😮'; });
      el.addEventListener('pointerup', () => { if (!over) face.textContent = '🙂'; });
      el.addEventListener('click', () => {
        if (over) return;
        if (c.open) { chord(c); if (!over) render(); return; }
        if (c.flag) return;
        if (firstClick) { placeMines(c); firstClick = false; startTimer(); }
        openCell(c);
        if (!over) render();
      });
      el.addEventListener('auxclick', (e) => { if (e.button === 1 && !over) { chord(c); if (!over) render(); } });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (over || c.open) return;
        c.flag = !c.flag;
        flags += c.flag ? 1 : -1;
        updMines();
        render();
      });
      boardEl.appendChild(el);
    }
  }

  root.querySelectorAll('.np-m').forEach(m => m.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = m.getBoundingClientRect();
    if (m.dataset.m === 'game') {
      contextMenu(r.left, r.bottom + 2, [
        { label: 'New game', hint: 'F2', action: () => reset() },
        '-',
        ...Object.entries(LEVELS).map(([k, v]) => ({ label: `${v.label} (${v.w}×${v.h}, ${v.mines} mines)`, checked: store.level === k, action: () => reset(k) })),
        '-',
        { label: 'Best times', action: () => msgDialog('Best times', Object.entries(LEVELS).map(([k, v]) => `${v.label}: <b>${store.best[k] != null ? store.best[k] + ' seconds' : '—'}</b>`).join('<br>'), 'info') },
        { label: 'Exit', action: () => win.close() },
      ]);
    } else {
      contextMenu(r.left, r.bottom + 2, [{ label: 'How to play', action: () => msgDialog('How to play', 'Left click reveals a square. Right click flags a mine.<br>Click a number whose mines are all flagged to open its neighbors.<br>The first click is always safe.', 'info') }]);
    }
  }));

  face.addEventListener('click', () => reset());
  const onKey = (e) => { if (document.querySelector('.window.active') === win.el && e.key === 'F2') { e.preventDefault(); reset(); } };
  document.addEventListener('keydown', onKey);
  win.onclose(() => { clearInterval(timer); document.removeEventListener('keydown', onKey); });
  reset();
  return win;
}
