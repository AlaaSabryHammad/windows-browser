/* Start menu: rail, alphabetical app list, live tiles, power options. */
import { appList } from './apps/registry.js';
import { launch } from './apps/registry.js';
import { contextMenu, showFlyout, hideFlyout, flyoutJustClosed, getOpenFlyout } from './ui.js';
import { I } from './icons.js';

let menuEl = null;

const TILE_GROUPS = [
  { name: 'Life at a glance', tiles: [
    { id: 'edge', size: 'md' },
    { id: 'explorer', size: 'md' },
    { id: 'photos', size: 'sm' },
    { id: 'store', size: 'sm' },
    { id: 'settings', size: 'sm' },
    { id: 'taskmgr', size: 'sm' },
  ] },
  { name: 'Play and explore', tiles: [
    { id: 'minesweeper', size: 'md' },
    { id: 'paint', size: 'sm' },
    { id: 'calculator', size: 'sm' },
    { id: 'notepad', size: 'sm' },
    { id: 'terminal', size: 'sm' },
  ] },
];

export function initStartMenu() {
  menuEl = document.createElement('div');
  menuEl.id = 'start-menu';
  menuEl.innerHTML = `
    <div class="sm-rail">
      <div class="sm-rail-btn" title="Start">${I.hamburger}</div>
      <div class="sm-rail-btn" title="User">${I.user}</div>
      <div class="sm-rail-btn" title="Documents">${I.docStack}</div>
      <div class="sm-rail-btn" title="Pictures">${I.photos}</div>
      <div class="sm-rail-btn" title="Settings">${I.settings}</div>
      <div class="spacer"></div>
      <div class="sm-rail-btn" title="Power">${I.power}</div>
    </div>
    <div class="sm-list"></div>
    <div class="sm-tiles"></div>`;
  document.body.appendChild(menuEl);

  /* rail actions */
  menuEl.querySelector('.sm-rail-btn[title="Settings"]').addEventListener('click', () => { toggleStart(false); launch('settings'); });
  menuEl.querySelector('.sm-rail-btn[title="User"]').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.right + 6, r.bottom - 100, [
      { label: 'Change account settings', icon: I.settings, action: () => launch('settings', { page: 'about' }) },
      { label: 'Lock', icon: I.power, action: () => window.dispatchEvent(new CustomEvent('webwin:lock')) },
      { label: 'Sign out', icon: I.power, action: () => window.dispatchEvent(new CustomEvent('webwin:lock')) },
    ]);
  });
  menuEl.querySelector('.sm-rail-btn[title="Documents"]').addEventListener('click', () => { toggleStart(false); launch('explorer', { path: null }); });
  menuEl.querySelector('.sm-rail-btn[title="Pictures"]').addEventListener('click', () => { toggleStart(false); launch('photos'); });
  menuEl.querySelector('.sm-rail-btn[title="Power"]').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.right + 6, r.bottom - 110, [
      { label: 'Sleep', action: () => window.dispatchEvent(new CustomEvent('webwin:lock')) },
      { label: 'Shut down', action: () => window.dispatchEvent(new CustomEvent('webwin:shutdown')) },
      { label: 'Restart', action: () => window.dispatchEvent(new CustomEvent('webwin:restart')) },
    ]);
  });
  menuEl.querySelector('.sm-rail-btn[title="Start"]').addEventListener('click', () => {
    menuEl.classList.toggle('expanded');
  });

  renderList();
  renderTiles();
}

function renderList() {
  const list = menuEl.querySelector('.sm-list');
  list.innerHTML = '';
  let currentLetter = '';
  for (const app of appList()) {
    const letter = app.name[0].toUpperCase();
    if (letter !== currentLetter) {
      currentLetter = letter;
      const h = document.createElement('div');
      h.className = 'sm-letter';
      h.textContent = letter;
      list.appendChild(h);
    }
    const el = document.createElement('div');
    el.className = 'sm-app';
    el.innerHTML = `${app.icon}<span>${app.name}</span>`;
    el.addEventListener('click', () => { toggleStart(false); launch(app.id); });
    list.appendChild(el);
  }
}

function renderTiles() {
  const tiles = menuEl.querySelector('.sm-tiles');
  tiles.innerHTML = '';
  for (const group of TILE_GROUPS) {
    const g = document.createElement('div');
    g.innerHTML = `<div class="tile-group-name">${group.name}</div>`;
    const grid = document.createElement('div');
    grid.className = 'tile-grid';
    for (const t of group.tiles) {
      const app = appList().find(a => a.id === t.id);
      if (!app) continue;
      const el = document.createElement('button');
      el.className = `tile t-${t.size}`;
      el.style.background = app.color;
      el.innerHTML = `${app.icon}<span class="tile-label">${app.name}</span>`;
      el.addEventListener('click', () => { toggleStart(false); launch(app.id); });
      grid.appendChild(el);
    }
    g.appendChild(grid);
    tiles.appendChild(g);
  }
}

export function toggleStart(force = null, anchor = null) {
  if (force === false) {
    if (getOpenFlyout() === menuEl) hideFlyout();
    return false;
  }
  if (force === true) {
    hideFlyout();
    showFlyout(menuEl, anchor);
    return true;
  }
  /* toggle (showFlyout returns false when it closed the menu) */
  return showFlyout(menuEl, anchor);
}

export function isStartOpen() { return menuEl && menuEl.classList.contains('open'); }
