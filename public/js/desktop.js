/* Desktop: icons (system + Desktop folder), selection rubber band, context menus. */
import { getNode, deleteNode, renameNode, addNode, HOME, makeFolder, makeFile, saveFS, getBin } from './fs.js';
import { contextMenu, promptDialog, notify } from './ui.js';
import { I } from './icons.js';
import { launch } from './apps/registry.js';

const DESKTOP_PATH = [...HOME, 'Desktop'];
let refreshCb = null;
export function emitDesktopRefresh() { if (refreshCb) refreshCb(); }

const SYSTEM_ICONS = [
  { id: 'sys:pc', name: 'This PC', icon: () => I.thispc, open: () => launch('explorer') },
  { id: 'sys:bin', name: 'Recycle Bin', icon: () => (getBin().length ? I.recycleFull : I.recycle), open: () => launch('recycle') },
];

export function initDesktop() {
  const iconsEl = document.getElementById('desktop-icons');
  const root = document.getElementById('desktop-root');
  const selBox = document.getElementById('selection-box');
  let selectedIds = new Set();

  refreshCb = renderIcons;

  function renderIcons() {
    iconsEl.innerHTML = '';
    selectedIds.clear();
    const items = [];

    for (const sys of SYSTEM_ICONS) {
      items.push({
        key: sys.id, name: sys.name, iconSvg: sys.icon(), type: 'sys',
        open: () => sys.open(),
      });
    }
    const dir = getNode(DESKTOP_PATH);
    for (const child of (dir?.children || []).slice().sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1)) {
      items.push({
        key: 'fs:' + child.id, name: child.name, node: child, type: child.type,
        iconSvg: child.type === 'folder' ? I.folder : child.kind === 'img' ? I.imgfile : I.txt,
        open: () => {
          if (child.type === 'folder') launch('explorer', { path: [...DESKTOP_PATH, child.name] });
          else if (child.kind === 'txt') launch('notepad', { path: [...DESKTOP_PATH, child.name] });
          else if (child.kind === 'img') launch('photos', { path: [...DESKTOP_PATH, child.name] });
        },
      });
    }

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'dicon';
      el.dataset.key = item.key;
      el.innerHTML = `<span class="di-img">${item.iconSvg}</span><span class="di-label">${item.name}</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); selectOnly(el); });
      el.addEventListener('dblclick', (e) => { e.stopPropagation(); item.open(); });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        selectOnly(el);
        const menu = [];
        menu.push({ label: 'Open', icon: I.open, action: item.open });
        if (item.type !== 'sys') {
          menu.push('-',
            { label: 'Rename', icon: I.rename, action: async () => {
              const name = await promptDialog('Rename', 'New name:', item.name);
              if (name && renameNode(DESKTOP_PATH, item.name, name)) { saveFS(); renderIcons(); }
            } },
            { label: 'Delete', icon: I.trash, action: async () => {
              if (await (await import('./ui.js')).confirmDialog('Delete', `Move "${item.name}" to the Recycle Bin?`, 'Delete', 'Cancel')) {
                deleteNode(DESKTOP_PATH, item.name);
                notify('Recycle Bin', `"${item.name}" was moved to the Recycle Bin`, I.recycle);
                renderIcons();
              }
            } });
        } else if (item.key === 'sys:bin') {
          menu.push('-', { label: 'Empty Recycle Bin', icon: I.trash, action: () => launch('recycle') });
        }
        menu.push('-', { label: 'Properties', icon: I.info, action: () => {
          import('./ui.js').then(ui => ui.msgDialog(`${item.name} Properties`,
            `Type: ${item.type === 'sys' ? 'System shortcut' : item.type === 'folder' ? 'File folder' : 'File'}<br>Location: Desktop`));
        } });
        contextMenu(e.clientX, e.clientY, menu);
      });
      iconsEl.appendChild(el);
    }
  }

  function selectOnly(el) {
    iconsEl.querySelectorAll('.dicon.selected').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
  }

  /* rubber band selection */
  let band = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target !== iconsEl && e.target !== root) return;
    iconsEl.querySelectorAll('.dicon.selected').forEach(x => x.classList.remove('selected'));
    band = { x: e.clientX, y: e.clientY };
    selBox.classList.remove('hidden');
    const move = (ev) => {
      if (!band) return;
      const x = Math.min(band.x, ev.clientX), y = Math.min(band.y, ev.clientY);
      const w = Math.abs(ev.clientX - band.x), h = Math.abs(ev.clientY - band.y);
      Object.assign(selBox.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      iconsEl.querySelectorAll('.dicon').forEach(ic => {
        const r = ic.getBoundingClientRect();
        const hit = r.left < x + w && r.right > x && r.top < y + h && r.bottom > y;
        ic.classList.toggle('selected', hit);
      });
    };
    const up = () => {
      band = null;
      selBox.classList.add('hidden');
      selBox.style.width = selBox.style.height = '0px';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  /* desktop context menu */
  root.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.window') || e.target.closest('.dicon')) return;
    e.preventDefault();
    contextMenu(e.clientX, e.clientY, [
      { label: 'View', submenu: [
        { label: 'Large icons', action: () => { iconsEl.style.setProperty('--isz', 'large'); } },
        { label: 'Medium icons', action: () => {} },
        { label: 'Small icons', action: () => {} },
      ] },
      { label: 'Sort by', submenu: [
        { label: 'Name', action: renderIcons },
        { label: 'Item type', action: renderIcons },
        { label: 'Date modified', action: renderIcons },
      ] },
      { label: 'Refresh', icon: I.refresh, action: renderIcons },
      '-',
      { label: 'New', submenu: [
        { label: 'Folder', icon: I.folder, action: async () => {
          const name = await promptDialog('New folder', 'Folder name:', 'New folder');
          if (name) { addNode(DESKTOP_PATH, makeFolder(name)); renderIcons(); }
        } },
        { label: 'Text Document', icon: I.txt, action: async () => {
          const name = await promptDialog('New text document', 'File name:', 'New Text Document.txt');
          if (name) { addNode(DESKTOP_PATH, makeFile(name.endsWith('.txt') ? name : name + '.txt', 'txt', '')); renderIcons(); }
        } },
      ] },
      '-',
      { label: 'Display settings', icon: I.monitor, action: () => launch('settings', { page: 'system' }) },
      { label: 'Personalize', icon: I.paint, action: () => launch('settings', { page: 'personalization' }) },
    ]);
  });

  /* keyboard: open/delete selected */
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('desktop-root').classList.contains('hidden')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const sel = iconsEl.querySelector('.dicon.selected');
    if (!sel) return;
    if (e.key === 'Enter') { sel.dispatchEvent(new Event('dblclick')); }
  });

  renderIcons();
}
