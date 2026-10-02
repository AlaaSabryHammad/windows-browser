/* Window manager: create/focus/drag/resize/snap/minimize/maximize/close, close guards, MRU order. */
import { clamp, contextMenu, esc } from './ui.js';

const layer = () => document.getElementById('windows-layer');
const snapEl = () => document.getElementById('snap-preview');

const windows = new Set();
let mru = [];               /* most recently used first */
let zCounter = 100;
let idCounter = 1;
let cascade = 0;
let focusedWin = null;

const events = { open: [], close: [], focus: [], minimize: [], restore: [], maximize: [], unmaximize: [], title: [], flash: [] };
export function on(evt, cb) { if (events[evt]) events[evt].push(cb); }
function emit(evt, win) { events[evt].forEach(cb => { try { cb(win); } catch (e) { console.error(e); } }); }

export function getFocused() { return focusedWin; }
export function windowList() { return [...windows]; }
export function mruList() { return mru.filter(w => windows.has(w)); }
export function appWindows(appId) { return [...windows].filter(w => w.opts.appId === appId); }

export const TASKBAR_H = 40;
export function workArea() { return { w: innerWidth, h: innerHeight - TASKBAR_H }; }

/* ---------- remembered bounds per app ---------- */
const BOUNDS_KEY = 'webwin-bounds-v1';
let bounds = {};
try { bounds = JSON.parse(localStorage.getItem(BOUNDS_KEY) || '{}'); } catch { bounds = {}; }
function rememberBounds(win) {
  if (!win.opts.appId || win.opts.noRemember) return;
  const r = win.maximized || win.snap ? win._prev : rect(win);
  if (!r) return;
  bounds[win.opts.appId] = { ...r, max: win.maximized };
  try { localStorage.setItem(BOUNDS_KEY, JSON.stringify(bounds)); } catch { /* ignore */ }
}
const rect = (win) => ({ x: win.el.offsetLeft, y: win.el.offsetTop, w: win.el.offsetWidth, h: win.el.offsetHeight });
function setRect(win, r) {
  Object.assign(win.el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
}

const ICON_MAX = '<svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const ICON_RESTORE = '<svg viewBox="0 0 24 24"><rect x="4" y="7.5" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 7.5 V4.5 H20 V16.5 H16" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

export function createWindow(opts) {
  const wa = workArea();
  const saved = opts.appId && !opts.noRemember ? bounds[opts.appId] : null;
  const othersOfApp = opts.appId ? appWindows(opts.appId).length : 0;
  let w = Math.min(opts.w || 760, wa.w), h = Math.min(opts.h || 520, wa.h);
  let x, y;
  if (saved && opts.resizable !== false) { w = clamp(saved.w, opts.minW || 280, wa.w); h = clamp(saved.h, opts.minH || 180, wa.h); }
  if (opts.x != null) { x = opts.x; y = opts.y; }
  else if (saved && !othersOfApp) { x = saved.x; y = saved.y; }
  else {
    x = 70 + (cascade % 7) * 32; y = 50 + (cascade % 7) * 26;
    cascade++;
  }
  x = clamp(x, 0, Math.max(0, wa.w - w)); y = clamp(y, 0, Math.max(0, wa.h - h));

  const el = document.createElement('div');
  el.className = 'window opening' + (opts.className ? ' ' + opts.className : '');
  el.style.cssText = `left:${x}px; top:${y}px; width:${w}px; height:${h}px; z-index:${++zCounter};`;
  el.innerHTML = `
    <div class="titlebar">
      <span class="tb-icon">${opts.icon || ''}</span>
      <span class="tb-text">${esc(opts.title || 'Window')}</span>
      <div class="caption-btns">
        <button class="capbtn min" title="Minimize"><svg viewBox="0 0 24 24"><path d="M4 12 H20" stroke="currentColor" stroke-width="1.6"/></svg></button>
        ${opts.resizable === false ? '' : `<button class="capbtn max" title="Maximize">${ICON_MAX}</button>`}
        <button class="capbtn close" title="Close"><svg viewBox="0 0 24 24"><path d="M5.5 5.5 L18.5 18.5 M18.5 5.5 L5.5 18.5" stroke="currentColor" stroke-width="1.6"/></svg></button>
      </div>
    </div>
    <div class="win-body"></div>
    ${opts.resizable === false ? '' : ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'].map(d => `<div class="rs rs-${d}" data-dir="${d}"></div>`).join(' ')}`;

  layer().appendChild(el);
  setTimeout(() => el.classList.remove('opening'), 200);

  const win = {
    id: 'w' + idCounter++,
    el,
    body: el.querySelector('.win-body'),
    opts,
    title: opts.title || 'Window',
    minimized: false,
    maximized: false,
    snap: null,
    created: Date.now(),
    _prev: null,
    _closeCbs: [],
    _guards: [],
    setTitle(t) {
      win.title = t;
      el.querySelector('.tb-text').textContent = t;
      emit('title', win);
    },
    onclose(cb) { win._closeCbs.push(cb); },
    /* guard returns false (or Promise<false>) to cancel closing */
    beforeClose(fn) { win._guards.push(fn); },
    focus() { focusWindow(win); },
    minimize() { minimizeWindow(win); },
    restore() { if (win.maximized) unmaximizeWindow(win); else if (win.snap) unsnap(win); },
    close() { return requestClose(win); },
    forceClose() { closeWindow(win); },
    toggleMax() {
      if (opts.resizable === false) return;
      if (win.maximized) unmaximizeWindow(win); else maximizeWindow(win);
    },
    flash() { if (focusedWin !== win) { el.classList.add('flashing'); emit('flash', win); } },
    get isOpen() { return windows.has(win); },
  };
  windows.add(win);

  /* titlebar interactions */
  const titlebar = el.querySelector('.titlebar');
  el.querySelector('.capbtn.min').addEventListener('click', (e) => { e.stopPropagation(); minimizeWindow(win); });
  const maxBtn = el.querySelector('.capbtn.max');
  if (maxBtn) maxBtn.addEventListener('click', (e) => { e.stopPropagation(); win.toggleMax(); });
  el.querySelector('.capbtn.close').addEventListener('click', (e) => { e.stopPropagation(); requestClose(win); });
  titlebar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.capbtn')) return;
    if (e.target.closest('.tb-icon')) { requestClose(win); return; }
    win.toggleMax();
  });
  titlebar.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.capbtn')) return;
    e.preventDefault();
    systemMenu(win, e.clientX, e.clientY);
  });
  el.querySelector('.tb-icon').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    systemMenu(win, r.left, r.bottom + 6);
  });

  /* activate on any pointer press inside */
  el.addEventListener('pointerdown', () => focusWindow(win), true);

  makeDraggable(win, titlebar);
  el.querySelectorAll('.rs').forEach(hd => makeResizable(win, hd));

  if (saved && saved.max && !othersOfApp && opts.resizable !== false) {
    win._prev = { x, y, w, h };
    maximizeWindow(win, true);
  }

  focusWindow(win);
  emit('open', win);
  return win;
}

function systemMenu(win, x, y) {
  const resizable = win.opts.resizable !== false;
  contextMenu(x, y, [
    { label: 'Restore', disabled: !(win.maximized || win.snap), action: () => win.restore() },
    { label: 'Minimize', action: () => minimizeWindow(win) },
    { label: 'Maximize', disabled: win.maximized || !resizable, action: () => maximizeWindow(win) },
    '-',
    { label: 'Close', bold: true, hint: 'Alt+F4', action: () => requestClose(win) },
  ]);
}

function focusWindow(win) {
  if (!windows.has(win)) return;
  if (win.minimized) restoreWindow(win);
  win.el.classList.remove('flashing');
  mru = [win, ...mru.filter(w => w !== win)];
  if (focusedWin === win) return;
  focusedWin = win;
  win.el.style.zIndex = ++zCounter;
  windows.forEach(w => w.el.classList.toggle('active', w === win));
  emit('focus', win);
}

function focusNext() {
  focusedWin = null;
  const next = mruList().find(w => !w.minimized);
  if (next) focusWindow(next);
  else { windows.forEach(w => w.el.classList.remove('active')); emit('focus', null); }
}

function minimizeWindow(win) {
  if (win.minimized) return;
  win.minimized = true;
  win.el.classList.add('minimizing');
  setTimeout(() => {
    if (!win.minimized) return;
    win.el.style.display = 'none';
    win.el.classList.remove('minimizing');
  }, 170);
  if (focusedWin === win) focusNext();
  emit('minimize', win);
}

function restoreWindow(win) {
  win.minimized = false;
  win.el.style.display = '';
  win.el.classList.add('minimizing');
  requestAnimationFrame(() => requestAnimationFrame(() => win.el.classList.remove('minimizing')));
  emit('restore', win);
}

function setMaxButton(win, max) {
  const btn = win.el.querySelector('.capbtn.max');
  if (btn) { btn.innerHTML = max ? ICON_RESTORE : ICON_MAX; btn.title = max ? 'Restore Down' : 'Maximize'; }
}

function maximizeWindow(win, keepPrev = false) {
  if (win.opts.resizable === false) return;
  if (!keepPrev && !win.snap) win._prev = rect(win);
  win.snap = null;
  const wa = workArea();
  setRect(win, { x: 0, y: 0, w: wa.w, h: wa.h });
  win.maximized = true;
  win.el.classList.add('maximized');
  setMaxButton(win, true);
  emit('maximize', win);
}

function unmaximizeWindow(win) {
  const p = win._prev || { x: 60, y: 40, w: 760, h: 520 };
  setRect(win, fitInView(p));
  win.maximized = false;
  win.snap = null;
  win.el.classList.remove('maximized');
  setMaxButton(win, false);
  emit('unmaximize', win);
}

function unsnap(win) {
  if (!win.snap) return;
  win.snap = null;
  setRect(win, fitInView(win._prev || rect(win)));
  emit('unmaximize', win);
}

function fitInView(r) {
  const wa = workArea();
  const w = Math.min(r.w, wa.w), h = Math.min(r.h, wa.h);
  return { w, h, x: clamp(r.x, -w + 120, wa.w - 120), y: clamp(r.y, 0, wa.h - 34) };
}

/* ---------- snapping ---------- */
function zoneRect(zone) {
  const wa = workArea();
  const hw = Math.floor(wa.w / 2), hh = Math.floor(wa.h / 2);
  switch (zone) {
    case 'max': return { x: 0, y: 0, w: wa.w, h: wa.h };
    case 'left': return { x: 0, y: 0, w: hw, h: wa.h };
    case 'right': return { x: hw, y: 0, w: wa.w - hw, h: wa.h };
    case 'tl': return { x: 0, y: 0, w: hw, h: hh };
    case 'tr': return { x: hw, y: 0, w: wa.w - hw, h: hh };
    case 'bl': return { x: 0, y: hh, w: hw, h: wa.h - hh };
    case 'br': return { x: hw, y: hh, w: wa.w - hw, h: wa.h - hh };
  }
  return null;
}

export function snapWindow(win, zone) {
  if (win.opts.resizable === false) return;
  if (zone === 'max') { maximizeWindow(win); return; }
  if (!win.snap && !win.maximized) win._prev = rect(win);
  if (win.maximized) { win.maximized = false; win.el.classList.remove('maximized'); setMaxButton(win, false); }
  win.snap = zone;
  setRect(win, zoneRect(zone));
  emit('unmaximize', win);
}

/* Win + arrow keys, Windows 10 rules */
export function keySnap(win, dir) {
  if (!win) return;
  const s = win.snap;
  if (dir === 'up') {
    if (s === 'left' || s === 'bl') snapWindow(win, 'tl');
    else if (s === 'right' || s === 'br') snapWindow(win, 'tr');
    else if (!win.maximized) maximizeWindow(win);
  } else if (dir === 'down') {
    if (win.maximized) unmaximizeWindow(win);
    else if (s === 'left' || s === 'tl') snapWindow(win, 'bl');
    else if (s === 'right' || s === 'tr') snapWindow(win, 'br');
    else if (s) unsnap(win);
    else minimizeWindow(win);
  } else if (dir === 'left') {
    if (s === 'right' || s === 'tr' || s === 'br') unsnap(win);
    else snapWindow(win, 'left');
  } else if (dir === 'right') {
    if (s === 'left' || s === 'tl' || s === 'bl') unsnap(win);
    else snapWindow(win, 'right');
  }
}

/* ---------- closing ---------- */
async function requestClose(win) {
  if (!windows.has(win) || win._closing) return false;
  win._closing = true;
  try {
    for (const g of win._guards) {
      if (win.minimized) focusWindow(win);
      const ok = await g();
      if (ok === false) return false;
    }
  } finally { win._closing = false; }
  closeWindow(win);
  return true;
}

function closeWindow(win) {
  if (!windows.has(win)) return;
  rememberBounds(win);
  win._closeCbs.forEach(cb => { try { cb(); } catch { /* ignore */ } });
  windows.delete(win);
  mru = mru.filter(w => w !== win);
  win.el.classList.add('closing');
  setTimeout(() => win.el.remove(), 120);
  if (focusedWin === win) focusNext();
  emit('close', win);
}

/* Close everything (sign out / shut down). Resolves false if a window refused (unsaved work). */
export async function closeAll() {
  for (const w of [...windows]) {
    const ok = await requestClose(w);
    if (!ok) return false;
  }
  return true;
}

/* ---------- dragging + snap ---------- */
function makeDraggable(win, handle) {
  let startX = 0, startY = 0, origX = 0, origY = 0, dragging = false, moved = false;
  let snapZone = null;

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.capbtn') || e.target.closest('.tb-icon')) return;
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    origX = win.el.offsetLeft; origY = win.el.offsetTop;
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (!moved) { moved = true; document.body.classList.add('dragging-window'); }

    /* dragging a maximized/snapped window restores it under the cursor */
    if ((win.maximized || win.snap) && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      const ratio = clamp((e.clientX - win.el.offsetLeft) / win.el.offsetWidth, 0.1, 0.9);
      if (win.maximized) unmaximizeWindow(win); else unsnap(win);
      const w = win.el.offsetWidth;
      origX = e.clientX - w * ratio;
      origY = Math.max(0, e.clientY - 14);
      startX = e.clientX; startY = e.clientY;
      win.el.style.left = origX + 'px';
      win.el.style.top = origY + 'px';
      return;
    }
    if (win.maximized) return;

    const wa = workArea();
    win.el.style.left = clamp(origX + dx, -win.el.offsetWidth + 90, wa.w - 90) + 'px';
    win.el.style.top = clamp(origY + dy, 0, wa.h - 34) + 'px';

    /* snap zones (edges + corners) */
    if (win.opts.resizable === false) return;
    const cx = e.clientX, cy = e.clientY, C = 24;
    let zone = null;
    if (cy <= 4) zone = cx <= C ? 'tl' : cx >= innerWidth - C ? 'tr' : 'max';
    else if (cx <= 4) zone = cy >= wa.h - C ? 'bl' : cy <= C ? 'tl' : 'left';
    else if (cx >= innerWidth - 4) zone = cy >= wa.h - C ? 'br' : cy <= C ? 'tr' : 'right';
    if (zone !== snapZone) {
      snapZone = zone;
      const sp = snapEl();
      if (!zone) sp.classList.add('hidden');
      else {
        sp.classList.remove('hidden');
        const r = zoneRect(zone);
        Object.assign(sp.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      }
    }
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging-window');
    snapEl().classList.add('hidden');
    if (snapZone) snapWindow(win, snapZone);
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
    orig = rect(win);
    hEl.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-window');
  });

  hEl.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    win.snap = null;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const minW = win.opts.minW || 320, minH = win.opts.minH || 200;
    let { x, y, w, h } = orig;
    if (dir.includes('e')) w = Math.max(minW, orig.w + dx);
    if (dir.includes('s')) h = Math.max(minH, orig.h + dy);
    if (dir.includes('w')) { w = Math.max(minW, orig.w - dx); x = orig.x + (orig.w - w); }
    if (dir.includes('n')) { h = Math.max(minH, orig.h - dy); y = Math.max(0, orig.y + (orig.h - h)); }
    setRect(win, { x, y, w, h });
  });

  const end = () => { resizing = false; document.body.classList.remove('resizing-window'); };
  hEl.addEventListener('pointerup', end);
  hEl.addEventListener('pointercancel', end);
}

/* keep windows usable when the browser window is resized */
window.addEventListener('resize', () => {
  for (const win of windows) {
    if (win.maximized) setRect(win, zoneRect('max'));
    else if (win.snap) setRect(win, zoneRect(win.snap));
    else setRect(win, fitInView(rect(win)));
  }
});

/* clicking into an iframe doesn't bubble a pointerdown — detect focus moving into it */
window.addEventListener('blur', () => {
  setTimeout(() => {
    const a = document.activeElement;
    if (a && a.tagName === 'IFRAME') {
      const w = [...windows].find(x => x.el.contains(a));
      if (w) focusWindow(w);
    }
  }, 0);
});

/* minimize all (show desktop); calling again restores them */
let shownDesktop = null;
export function minimizeAll() {
  const visible = [...windows].filter(w => !w.minimized);
  if (!visible.length && shownDesktop) {
    shownDesktop.filter(w => windows.has(w)).reverse().forEach(w => focusWindow(w));
    shownDesktop = null;
    return;
  }
  shownDesktop = mruList().filter(w => !w.minimized);
  visible.forEach(w => minimizeWindow(w));
}

/* window tiles for Task View / taskbar thumbnails */
export function thumbnailFor(win, maxW, maxH) {
  const clone = win.el.cloneNode(true);
  clone.classList.remove('active', 'maximized', 'minimizing', 'opening', 'flashing');
  const w = win.el.offsetWidth || parseInt(win.el.style.width, 10) || 600;
  const h = win.el.offsetHeight || parseInt(win.el.style.height, 10) || 400;
  clone.style.cssText = `position:absolute; top:0; left:0; margin:0; width:${w}px; height:${h}px; display:flex;`;
  clone.querySelectorAll('iframe, video, audio').forEach(f => { f.removeAttribute('src'); f.removeAttribute('srcdoc'); });
  const srcCanvases = win.el.querySelectorAll('canvas');
  const dstCanvases = clone.querySelectorAll('canvas');
  srcCanvases.forEach((src, i) => {
    const dst = dstCanvases[i];
    if (dst) { dst.width = src.width; dst.height = src.height; try { dst.getContext('2d').drawImage(src, 0, 0); } catch { /* tainted */ } }
  });
  /* a live video frame (camera / media player) */
  const srcVideos = win.el.querySelectorAll('video');
  const dstVideos = clone.querySelectorAll('video');
  srcVideos.forEach((v, i) => {
    if (!dstVideos[i] || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    try { c.getContext('2d').drawImage(v, 0, 0); } catch { return; }
    c.style.cssText = v.style.cssText; c.className = v.className;
    c.style.width = v.offsetWidth + 'px'; c.style.height = v.offsetHeight + 'px';
    dstVideos[i].replaceWith(c);
  });
  const inner = document.createElement('div');
  inner.className = 'tv-thumb-inner';
  inner.style.width = w + 'px';
  inner.style.height = h + 'px';
  inner.appendChild(clone);
  const scale = Math.min(maxW / w, maxH / h) * 0.94;
  inner.style.transform = `scale(${scale})`;
  inner.dataset.w = w * scale; inner.dataset.h = h * scale;
  return inner;
}
