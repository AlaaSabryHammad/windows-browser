/* Start menu: rail, most used + alphabetical app list, live tiles, power options, pin/unpin. */
import { APPS, appList, launch, mostUsed } from './apps/registry.js';
import { contextMenu, showFlyout, hideFlyout, getOpenFlyout, onFlyoutChange, esc, msgDialog } from './ui.js';
import { settings, updateSettings, onSettingsChange, tilesConfig, userInitial } from './settings.js';
import { getNode, KNOWN, kindOf, onFSChange } from './fs.js';
import { I } from './icons.js';

let menuEl = null;
let liveTimer = null;
let photoIdx = 0;

const SYSTEM_FOLDER = ['run', 'terminal', 'taskmgr', 'explorer'];

export function initStartMenu() {
  menuEl = document.createElement('div');
  menuEl.id = 'start-menu';
  menuEl.className = 'flyout-start';
  menuEl.innerHTML = `
    <div class="sm-rail">
      <div class="sm-rail-btn" data-r="expand" title="Expand">${I.hamburger}<span>START</span></div>
      <div class="spacer"></div>
      <div class="sm-rail-btn" data-r="user"><span class="sm-av"></span><span class="sm-uname"></span></div>
      <div class="sm-rail-btn" data-r="docs" title="Documents">${I.docStack}<span>Documents</span></div>
      <div class="sm-rail-btn" data-r="pics" title="Pictures">${I.photos}<span>Pictures</span></div>
      <div class="sm-rail-btn" data-r="settings" title="Settings">${I.settings}<span>Settings</span></div>
      <div class="sm-rail-btn" data-r="power" title="Power">${I.power}<span>Power</span></div>
    </div>
    <div class="sm-list"></div>
    <div class="sm-tiles"></div>
    <div class="sm-letters hidden"></div>`;
  document.body.appendChild(menuEl);

  const rail = (r) => menuEl.querySelector(`.sm-rail-btn[data-r="${r}"]`);
  rail('expand').addEventListener('click', () => menuEl.classList.toggle('expanded'));
  rail('settings').addEventListener('click', () => { toggleStart(false); launch('settings'); });
  rail('docs').addEventListener('click', () => { toggleStart(false); launch('explorer', { path: KNOWN.documents }); });
  rail('pics').addEventListener('click', () => { toggleStart(false); launch('explorer', { path: KNOWN.pictures }); });
  rail('user').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.right + 6, r.top - 60, [
      { label: 'Change account settings', icon: I.settings, action: () => { toggleStart(false); launch('settings', { page: 'accounts' }); } },
      { label: 'Lock', icon: I.lock, action: () => { toggleStart(false); window.dispatchEvent(new CustomEvent('webwin:lock')); } },
      { label: 'Sign out', icon: I.signout, action: () => { toggleStart(false); window.dispatchEvent(new CustomEvent('webwin:signout')); } },
    ]);
  });
  rail('power').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.right + 6, r.bottom - 110, [
      { label: 'Sleep', icon: I.sleep, action: () => { toggleStart(false); window.dispatchEvent(new CustomEvent('webwin:sleep')); } },
      { label: 'Shut down', icon: I.power, action: () => { toggleStart(false); window.dispatchEvent(new CustomEvent('webwin:shutdown')); } },
      { label: 'Restart', icon: I.restart, action: () => { toggleStart(false); window.dispatchEvent(new CustomEvent('webwin:restart')); } },
    ]);
  });

  renderUser();
  renderList();
  renderTiles();

  onSettingsChange((s, patch) => {
    if (!patch) return;
    if ('tiles' in patch || 'pinned' in patch) renderTiles();
    if ('userName' in patch) renderUser();
  });
  onFSChange(() => { if (isStartOpen()) updateLiveTiles(); });

  /* refresh "most used" and live tiles each time Start opens */
  onFlyoutChange((opened) => {
    if (opened === menuEl) {
      renderList();
      updateLiveTiles();
      clearInterval(liveTimer);
      liveTimer = setInterval(updateLiveTiles, 4000);
    } else if (!isStartOpen()) {
      clearInterval(liveTimer);
      menuEl.classList.remove('expanded');
      menuEl.querySelector('.sm-letters').classList.add('hidden');
    }
  });
}

function renderUser() {
  menuEl.querySelector('.sm-av').textContent = userInitial();
  menuEl.querySelector('.sm-uname').textContent = settings.userName;
  menuEl.querySelector('.sm-rail-btn[data-r="user"]').title = settings.userName;
}

function appRow(app) {
  const el = document.createElement('div');
  el.className = 'sm-app';
  el.innerHTML = `${app.icon}<span>${esc(app.name)}</span>`;
  el.addEventListener('click', () => { toggleStart(false); launch(app.id); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); contextMenu(e.clientX, e.clientY, appMenu(app.id)); });
  return el;
}

function isOnStart(id) { return tilesConfig().some(g => g.tiles.some(t => t.id === id)); }

function appMenu(id) {
  const onStart = isOnStart(id);
  const onBar = settings.pinned.includes(id);
  return [
    onStart
      ? { label: 'Unpin from Start', icon: I.pin, action: () => unpinStart(id) }
      : { label: 'Pin to Start', icon: I.pin, action: () => pinStart(id) },
    { label: 'More', submenu: [
      onBar
        ? { label: 'Unpin from taskbar', icon: I.pin, action: () => updateSettings({ pinned: settings.pinned.filter(x => x !== id) }) }
        : { label: 'Pin to taskbar', icon: I.pin, action: () => updateSettings({ pinned: [...settings.pinned, id] }) },
      { label: 'Run as administrator', icon: I.shield, action: () => { toggleStart(false); msgDialog('User Account Control', `You're already the administrator of this PC, ${esc(settings.userName)}. 😉`, 'info').then(() => launch(id)); } },
      { label: 'App settings', icon: I.settings, action: () => { toggleStart(false); launch('settings', { page: 'apps' }); } },
    ] },
  ];
}

export function pinStart(id) {
  const tiles = tilesConfig();
  if (tiles.some(g => g.tiles.some(t => t.id === id))) return;
  let g = tiles.find(x => x.name === 'Pinned');
  if (!g) { g = { name: 'Pinned', tiles: [] }; tiles.push(g); }
  g.tiles.push({ id, size: 'md' });
  updateSettings({ tiles });
}
export function unpinStart(id) {
  const tiles = tilesConfig().map(g => ({ ...g, tiles: g.tiles.filter(t => t.id !== id) })).filter(g => g.tiles.length);
  updateSettings({ tiles });
}
function resizeTile(id, size) {
  const tiles = tilesConfig();
  tiles.forEach(g => g.tiles.forEach(t => { if (t.id === id) t.size = size; }));
  updateSettings({ tiles });
}

function renderList() {
  const list = menuEl.querySelector('.sm-list');
  list.innerHTML = '';
  const used = mostUsed(4);
  if (used.length) {
    const h = document.createElement('div');
    h.className = 'sm-section';
    h.textContent = 'Most used';
    list.appendChild(h);
    used.forEach(a => list.appendChild(appRow(a)));
  }
  let currentLetter = '';
  const letters = new Set();
  for (const app of appList()) {
    if (app.hidden) continue;
    const letter = app.name[0].toUpperCase();
    if (letter !== currentLetter) {
      currentLetter = letter;
      letters.add(letter);
      const h = document.createElement('div');
      h.className = 'sm-letter';
      h.dataset.letter = letter;
      h.textContent = letter;
      h.addEventListener('click', () => showLetters(letters));
      list.appendChild(h);
    }
    list.appendChild(appRow(app));
  }
  /* Windows System folder (sorts last, under W) */
  if (!letters.has('W')) {
    const h = document.createElement('div');
    h.className = 'sm-letter'; h.dataset.letter = 'W'; h.textContent = 'W';
    h.addEventListener('click', () => showLetters(letters));
    list.appendChild(h);
    letters.add('W');
  }
  const folder = document.createElement('div');
  folder.className = 'sm-app sm-folder';
  folder.innerHTML = `${I.folder}<span>Windows System</span><span class="sm-chev">${I.chevDown}</span>`;
  const sub = document.createElement('div');
  sub.className = 'sm-sub hidden';
  SYSTEM_FOLDER.forEach(id => { const r = appRow(APPS[id]); r.classList.add('indent'); sub.appendChild(r); });
  folder.addEventListener('click', () => { sub.classList.toggle('hidden'); folder.classList.toggle('open'); });
  list.appendChild(folder);
  list.appendChild(sub);
}

function showLetters(present) {
  const box = menuEl.querySelector('.sm-letters');
  box.innerHTML = '';
  for (const L of '&#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')) {
    const b = document.createElement('button');
    b.textContent = L;
    b.disabled = !present.has(L);
    b.addEventListener('click', () => {
      box.classList.add('hidden');
      menuEl.querySelector(`.sm-letter[data-letter="${L}"]`)?.scrollIntoView({ block: 'start' });
    });
    box.appendChild(b);
  }
  box.classList.remove('hidden');
}

function renderTiles() {
  const tilesEl = menuEl.querySelector('.sm-tiles');
  tilesEl.innerHTML = '';
  for (const group of tilesConfig()) {
    const g = document.createElement('div');
    g.className = 'tile-group';
    g.innerHTML = `<div class="tile-group-name">${esc(group.name)}</div>`;
    const grid = document.createElement('div');
    grid.className = 'tile-grid';
    for (const t of group.tiles) {
      const app = APPS[t.id];
      if (!app) continue;
      const el = document.createElement('button');
      el.className = `tile t-${t.size}`;
      el.dataset.id = t.id;
      el.style.background = app.color;
      el.innerHTML = `<span class="tile-live"></span><span class="tile-face">${app.icon}</span><span class="tile-label">${esc(app.name)}</span>`;
      el.addEventListener('click', () => { toggleStart(false); launch(app.id); });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        const onBar = settings.pinned.includes(t.id);
        const sz = (label, size) => ({ label, checked: t.size === size, action: () => resizeTile(t.id, size) });
        contextMenu(e.clientX, e.clientY, [
          { label: 'Unpin from Start', icon: I.pin, action: () => unpinStart(t.id) },
          { label: 'Resize', submenu: [sz('Small', 'sm'), sz('Medium', 'md'), sz('Wide', 'wd'), sz('Large', 'lg')] },
          { label: 'More', submenu: [
            onBar
              ? { label: 'Unpin from taskbar', icon: I.pin, action: () => updateSettings({ pinned: settings.pinned.filter(x => x !== t.id) }) }
              : { label: 'Pin to taskbar', icon: I.pin, action: () => updateSettings({ pinned: [...settings.pinned, t.id] }) },
          ] },
        ]);
      });
      grid.appendChild(el);
    }
    g.appendChild(grid);
    tilesEl.appendChild(g);
  }
  updateLiveTiles();
}

/* ---------------- live tiles ---------------- */
function liveContent(id, size) {
  if (size === 'sm') return null;
  if (id === 'clock') {
    const d = new Date();
    return `<div class="lt-clock"><div class="lt-big">${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: !settings.clock24 })}</div><div class="lt-small">${d.toLocaleDateString('en-US', { weekday: 'long' })}<br>${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</div></div>`;
  }
  if (id === 'weather') {
    try {
      const w = JSON.parse(localStorage.getItem('webwin-weather-v1') || 'null');
      if (w && w.temp != null) return `<div class="lt-weather"><div class="lt-big">${Math.round(w.temp)}°</div><div class="lt-small">${esc(w.desc || '')}<br>${esc(w.city || '')}</div></div>`;
    } catch { /* ignore */ }
    return `<div class="lt-weather"><div class="lt-small">Weather<br>Click to see your forecast</div></div>`;
  }
  if (id === 'photos') {
    const pics = (getNode(KNOWN.pictures)?.children || []).filter(c => kindOf(c) === 'img' && c.content);
    if (!pics.length) return null;
    const p = pics[photoIdx % pics.length];
    return `<div class="lt-photo" style="background-image:url('${p.content.replace(/'/g, '%27')}')"></div>`;
  }
  if (id === 'stickynotes') {
    try {
      const notes = JSON.parse(localStorage.getItem('webwin-notes-v1') || '[]');
      const txt = notes.find(n => n.text && n.text.trim());
      if (txt) return `<div class="lt-note">${esc(txt.text.slice(0, 120))}</div>`;
    } catch { /* ignore */ }
  }
  if (id === 'mediaplayer') {
    const np = window.__nowPlaying;
    if (np) return `<div class="lt-weather"><div class="lt-small">Now playing<br><b>${esc(np)}</b></div></div>`;
  }
  return null;
}

function updateLiveTiles() {
  if (!menuEl) return;
  photoIdx++;
  menuEl.querySelectorAll('.tile').forEach(el => {
    const size = [...el.classList].find(c => c.startsWith('t-')).slice(2);
    const html = liveContent(el.dataset.id, size);
    const live = el.querySelector('.tile-live');
    el.classList.toggle('is-live', !!html);
    if (html && live.innerHTML !== html) {
      live.innerHTML = html;
      live.classList.remove('flip'); void live.offsetWidth; live.classList.add('flip');
    } else if (!html) live.innerHTML = '';
  });
}

export function toggleStart(force = null, anchor = null) {
  anchor = anchor || document.querySelector('.tb-start');
  if (force === false) {
    if (getOpenFlyout() === menuEl) hideFlyout();
    return false;
  }
  if (force === true) {
    if (getOpenFlyout() === menuEl) return true;
    hideFlyout();
    showFlyout(menuEl, anchor);
    return true;
  }
  /* toggle (showFlyout returns false when it closed the menu) */
  return showFlyout(menuEl, anchor);
}

export function isStartOpen() { return !!menuEl && getOpenFlyout() === menuEl; }
