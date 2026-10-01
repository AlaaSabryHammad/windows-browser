/* Minesweeper — 9×9, 10 mines, first click safe */
import { createWindow } from '../wm.js';
import { I } from '../icons.js';
import { notify } from '../ui.js';

const SIZE = 9, MINES = 10;

export function open() {
  const win = createWindow({ title: 'Minesweeper', icon: I.mine, appId: 'minesweeper', w: 340, h: 460, minW: 320, minH: 440 });
  win.body.innerHTML = `
    <div class="mines">
      <div class="ms-head">
        <div class="ms-counter mines-left">🚩 010</div>
        <button class="ms-face" title="New game">🙂</button>
        <div class="ms-counter ms-time">⏱ 000</div>
      </div>
      <div class="ms-board"></div>
      <div class="ms-msg"></div>
      <div class="ms-legend">Left click: reveal · Right click: flag</div>
    </div>`;

  const root = win.body.querySelector('.mines');
  const boardEl = root.querySelector('.ms-board');
  const face = root.querySelector('.ms-face');
  const minesEl = root.querySelector('.mines-left');
  const timeEl = root.querySelector('.ms-time');
  const msgEl = root.querySelector('.ms-msg');

  let cells, revealed, flags, over, started, timer, seconds, firstClick;

  function reset() {
    cells = Array.from({ length: SIZE * SIZE }, (_, i) => ({
      i, mine: false, open: false, flag: false, n: 0,
      x: i % SIZE, y: Math.floor(i / SIZE),
    }));
    revealed = 0; flags = 0; over = false; started = false; firstClick = true; seconds = 0;
    clearInterval(timer);
    face.textContent = '🙂';
    msgEl.textContent = '';
    timeEl.textContent = '⏱ 000';
    updMines();
    render();
  }

  function updMines() { minesEl.textContent = '🚩 ' + String(Math.max(0, MINES - flags)).padStart(3, '0'); }

  const neighbors = (c) => {
    const res = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = c.x + dx, y = c.y + dy;
      if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) res.push(cells[y * SIZE + x]);
    }
    return res;
  };

  function placeMines(safe) {
    const forbidden = new Set([safe.i, ...neighbors(safe).map(n => n.i)]);
    let placed = 0;
    while (placed < MINES) {
      const i = Math.floor(Math.random() * SIZE * SIZE);
      if (forbidden.has(i) || cells[i].mine) continue;
      cells[i].mine = true;
      placed++;
    }
    for (const c of cells) c.n = neighbors(c).filter(n => n.mine).length;
  }

  function startTimer() {
    started = true;
    timer = setInterval(() => {
      seconds++;
      timeEl.textContent = '⏱ ' + String(Math.min(999, seconds)).padStart(3, '0');
    }, 1000);
  }

  function openCell(c) {
    if (c.open || c.flag || over) return;
    c.open = true;
    revealed++;
    if (c.mine) { lose(c); return; }
    if (c.n === 0) neighbors(c).forEach(n => { if (!n.open) openCell(n); });
    if (revealed === SIZE * SIZE - MINES) winGame();
  }

  function lose(hit) {
    over = true;
    clearInterval(timer);
    face.textContent = '😵';
    cells.forEach(c => { if (c.mine) c.open = true; });
    hit.boom = true;
    msgEl.textContent = 'Boom! You hit a mine.';
    render();
  }

  function winGame() {
    over = true;
    clearInterval(timer);
    face.textContent = '😎';
    msgEl.textContent = `You cleared it in ${seconds}s! 🎉`;
    cells.forEach(c => { if (c.mine && !c.flag) { c.flag = true; flags++; } });
    updMines();
    render();
    notify('Minesweeper', `Board cleared in ${seconds} seconds. Not bad!`, I.mine);
  }

  function render() {
    boardEl.style.gridTemplateColumns = `repeat(${SIZE}, 26px)`;
    boardEl.innerHTML = '';
    for (const c of cells) {
      const el = document.createElement('div');
      let cls = 'ms-cell';
      if (c.open) {
        cls += ' open';
        if (c.mine) { cls += ' mine'; el.textContent = '💣'; }
        else if (c.n) { cls += ` n${c.n}`; el.textContent = c.n; }
      } else if (c.flag) {
        el.textContent = '🚩';
      }
      if (c.boom) cls += ' mine';
      el.className = cls;
      el.addEventListener('click', () => {
        if (over) return;
        if (firstClick) { placeMines(c); firstClick = false; startTimer(); }
        openCell(c);
        if (!over) render();
      });
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

  face.addEventListener('click', reset);
  reset();
  return win;
}
