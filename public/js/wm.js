/* Window manager: create/focus/drag/resize/snap/minimize/maximize/close. */
import { clamp } from './ui.js';

const layer = () => document.getElementById('windows-layer');
const snapEl = () => document.getElementById('snap-preview');

const windows = new Set();
let zCounter = 100;
let idCounter = 1;
let cascade = 0;
let focusedWin = null;

const events = { open: [], close: [], focus: [], minimize: [], restore: [], maximize: [], unmaximize: [] };
export function on(evt, cb) { if (events[evt]) events[evt].push(cb); }
function emit(evt, win) { events[evt].forEach(cb => cb(win)); }

export function getFocused() { return focusedWin; }
export function windowList() { return [...windows]; }
export function appWindows(appId) { return [...windows].filter(w => w.opts.appId === appId); }

const TASKBAR_H = 40;

export function createWindow(opts) {
  const w = opts.w || 760, h = opts.h || 520;
  const vw = innerWidth, vh = innerHeight - TASKBAR_H;
  const x = opts.x ?? clamp(70 + (cascade % 7) * 32, 0, Math.max(0, vw - w));
  const y = opts.y ?? clamp(50 + (cascade % 7) * 26, 0, Math.max(0, vh - h));
  cascade++;

  const el = document.createElement('div');
  el.className = 'window opening';
  el.style.cssText = `left:${x}px; top:${y}px; width:${w}px; height:${h}px; z-index:${++zCounter};`;
  el.innerHTML = `
    <div class="titlebar">
      <span class="tb-icon">${opts.icon || ''}</span>
      <span class="tb-text">${opts.title || 'Window'}</span>
      <div class="caption-btns">
        <button class="capbtn min" title="Minimize"><svg viewBox="0 0 24 24"><path d="M4 12 H20" stroke="currentColor" stroke-width="1.6"/></svg></button>
        <button class="capbtn max" title="Maximize">${opts.resizable === false ? '' : '<svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'}</button>
        <button class="capbtn close" title="Close"><svg viewBox="0 0 24 24"><path d="M5.5 5.5 L18.5 18.5 M18.5 5.5 L5.5 18.5" stroke="currentColor" stroke-width="1.6"/></svg></button>
      </div>
    </div>
    <div class="win-body"></div>
    ${opts.resizable === false ? '' : ['n','s','w','e','nw','ne','sw','se'].map(d => `<div class="rs rs-${d}" data-dir="${d}"></div>`).join(' ')}`;

  layer().appendChild(el);
  setTimeout(() => el.classList.remove('opening'), 200);

  const win = {
    id: 'w' + idCounter++,
    el,
    body: el.querySelector('.win-body'),
    opts,
    minimized: false,
    maximized: false,
    _prev: null,
    _closeCbs: [],
    setTitle(t) { el.querySelector('.tb-text').textContent = t; },
    onclose(cb) { this._closeCbs.push(cb); },
    focus() { focusWindow(win); },
    minimize() { minimizeWindow(win); },
    close() { closeWindow(win); },
    toggleMax() {
      if (opts.resizable === false) return;
      if (win.maximized) unmaximizeWindow(win); else maximizeWindow(win);
    }
  };
  windows.add(win);

  /* titlebar interactions */
  const titlebar = el.querySelector('.titlebar');
  el.querySelector('.capbtn.min').addEventListener('click', (e) => { e.stopPropagation(); minimizeWindow(win); });
  const maxBtn = el.querySelector('.capbtn.max');
  if (maxBtn) maxBtn.addEventListener('click', (e) => { e.stopPropagation(); win.toggleMax(); });
  el.querySelector('.capbtn.close').addEventListener('click', (e) => { e.stopPropagation(); closeWindow(win); });
  titlebar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.capbtn')) return;
    win.toggleMax();
  });

  /* activate on any pointer press inside */
  el.addEventListener('pointerdown', () => focusWindow(win), true);

  makeDraggable(win, titlebar);
  el.querySelectorAll('.rs').forEach(h => makeResizable(win, h));

  focusWindow(win);
  emit('open', win);
  return win;
}

function focusWindow(win) {
  if (focusedWin === win && !win.minimized) return;
  if (win.minimized) restoreWindow(win);
  focusedWin = win;
  win.el.style.zIndex = ++zCounter;
  windows.forEach(w => w.el.classList.toggle('active', w === win));
  emit('focus', win);
}

function minimizeWindow(win) {
  if (win.minimized) return;
  win.minimized = true;
  win.el.classList.add('minimizing');
  setTimeout(() => {
    win.el.style.display = 'none';
    win.el.classList.remove('minimizing');
  }, 170);
  if (focusedWin === win) {
    focusedWin = null;
    const others = [...windows].filter(w => !w.minimized);
    if (others.length) focusWindow(others[others.length - 1]);
    else windows.forEach(w => w.el.classList.remove('active'));
  }
  emit('minimize', win);
}

function restoreWindow(win) {
  win.minimized = false;
  win.el.style.display = '';
  win.el.classList.add('minimizing');
  requestAnimationFrame(() => requestAnimationFrame(() => win.el.classList.remove('minimizing')));
  emit('restore', win);
}

function workArea() { return { w: innerWidth, h: innerHeight - TASKBAR_H }; }

function maximizeWindow(win) {
  win._prev = { x: win.el.offsetLeft, y: win.el.offsetTop, w: win.el.offsetWidth, h: win.el.offsetHeight };
  const wa = workArea();
  Object.assign(win.el.style, { left: '0px', top: '0px', width: wa.w + 'px', height: wa.h + 'px' });
  win.maximized = true;
  win.el.classList.add('maximized');
  const btn = win.el.querySelector('.capbtn.max');
  if (btn) btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="4" y="7.5" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 7.5 V4.5 H20 V16.5 H16" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  emit('maximize', win);
}

function unmaximizeWindow(win) {
  const p = win._prev || { x: 60, y: 40, w: 760, h: 520 };
  Object.assign(win.el.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px' });
  win.maximized = false;
  win.el.classList.remove('maximized');
  const btn = win.el.querySelector('.capbtn.max');
  if (btn) btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  emit('unmaximize', win);
}

function closeWindow(win) {
  win._closeCbs.forEach(cb => { try { cb(); } catch {} });
  windows.delete(win);
  win.el.remove();
  if (focusedWin === win) {
    focusedWin = null;
    const others = [...windows].filter(w => !w.minimized);
    if (others.length) focusWindow(others[others.length - 1]);
  }
  emit('close', win);
}

/* ---------- dragging + snap ---------- */
function makeDraggable(win, handle) {
  let startX = 0, startY = 0, origX = 0, origY = 0, dragging = false;
  let snapZone = null;
  const wa = () => workArea();

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.capbtn')) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    origX = win.el.offsetLeft; origY = win.el.offsetTop;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging-window');
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;

    /* dragging a maximized window restores it under the cursor */
    if (win.maximized && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      const ratio = clamp(e.clientX / win.el.offsetWidth, 0.1, 0.9);
      unmaximizeWindow(win);
      const w = win.el.offsetWidth;
      origX = e.clientX - w * ratio;
      origY = 4;
      startX = e.clientX; startY = e.clientY;
      win.el.style.left = origX + 'px';
      win.el.style.top = origY + 'px';
      return;
    }
    if (win.maximized) return;

    const maxX = wa().w - 90;
    const maxY = wa().h - 34;
    win.el.style.left = clamp(origX + dx, -win.el.offsetWidth + 90, maxX) + 'px';
    win.el.style.top = clamp(origY + dy, 0, maxY) + 'px';

    /* snap zones */
    const zone = e.clientY <= 4 ? 'top' : e.clientX <= 4 ? 'left' : e.clientX >= innerWidth - 4 ? 'right' : null;
    if (zone !== snapZone) {
      snapZone = zone;
      const sp = snapEl();
      if (!zone) sp.classList.add('hidden');
      else {
        sp.classList.remove('hidden');
        if (zone === 'top') Object.assign(sp.style, { left: '0px', top: '0px', width: wa().w + 'px', height: wa().h + 'px' });
        if (zone === 'left') Object.assign(sp.style, { left: '0px', top: '0px', width: Math.floor(wa().w / 2) + 'px', height: wa().h + 'px' });
        if (zone === 'right') Object.assign(sp.style, { left: Math.floor(wa().w / 2) + 'px', top: '0px', width: Math.floor(wa().w / 2) + 'px', height: wa().h + 'px' });
      }
    }
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging-window');
    snapEl().classList.add('hidden');
    if (snapZone === 'top') maximizeWindow(win);
    else if (snapZone === 'left' || snapZone === 'right') {
      win._prev = { x: win.el.offsetLeft, y: win.el.offsetTop, w: win.el.offsetWidth, h: win.el.offsetHeight };
      const w2 = Math.floor(wa().w / 2);
      win.el.style.left = (snapZone === 'left' ? 0 : w2) + 'px';
      win.el.style.top = '0px';
      win.el.style.width = w2 + 'px';
      win.el.style.height = wa().h + 'px';
    }
    snapZone = null;
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

/* ---------- resizing ---------- */
function makeResizable(win, hEl) {
  const dir = hEl.dataset.dir;
  let startX, startY, orig, resizing = false;

  hEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || win.maximized) return;
    resizing = true;
    startX = e.clientX; startY = e.clientY;
    orig = { x: win.el.offsetLeft, y: win.el.offsetTop, w: win.el.offsetWidth, h: win.el.offsetHeight };
    hEl.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-window');
  });

  hEl.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const minW = win.opts.minW || 320, minH = win.opts.minH || 200;
    let { x, y, w, h } = orig;
    if (dir.includes('e')) w = Math.max(minW, orig.w + dx);
    if (dir.includes('s')) h = Math.max(minH, orig.h + dy);
    if (dir.includes('w')) { w = Math.max(minW, orig.w - dx); x = orig.x + (orig.w - w); }
    if (dir.includes('n')) { h = Math.max(minH, orig.h - dy); y = orig.y + (orig.h - h); }
    Object.assign(win.el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  });

  const end = () => { resizing = false; document.body.classList.remove('resizing-window'); };
  hEl.addEventListener('pointerup', end);
  hEl.addEventListener('pointercancel', end);
}

/* minimize all (show desktop) */
export function minimizeAll() { windows.forEach(w => { if (!w.minimized) minimizeWindow(w); }); }

/* window tiles for Task View thumbnails */
export function thumbnailFor(win, maxW, maxH) {
  const clone = win.el.cloneNode(true);
  clone.classList.remove('active', 'maximized', 'minimizing');
  clone.style.cssText = `position:absolute; top:0; left:0; margin:0; width:${win.el.offsetWidth}px; height:${win.el.offsetHeight}px; display:flex;`;
  clone.querySelectorAll('iframe').forEach(f => f.removeAttribute('src'));
  /* copy canvas contents into the cloned canvases */
  const srcCanvases = win.el.querySelectorAll('canvas');
  const dstCanvases = clone.querySelectorAll('canvas');
  srcCanvases.forEach((src, i) => {
    const dst = dstCanvases[i];
    if (dst) { dst.width = src.width; dst.height = src.height; try { dst.getContext('2d').drawImage(src, 0, 0); } catch {} }
  });
  const inner = document.createElement('div');
  inner.className = 'tv-thumb-inner';
  inner.style.width = win.el.offsetWidth + 'px';
  inner.style.height = win.el.offsetHeight + 'px';
  inner.appendChild(clone);
  const scale = Math.min(maxW / win.el.offsetWidth, maxH / win.el.offsetHeight) * 0.94;
  inner.style.transform = `scale(${scale})`;
  return inner;
}
