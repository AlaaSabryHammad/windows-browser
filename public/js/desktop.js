/* Desktop: icons on a grid (free placement, saved), selection, drag & drop, inline rename, context menus, shortcuts. */
import { getNode, getBin, DESKTOP, onFSChange, sizeOf, kindOf } from './fs.js';
import { contextMenu, esc } from './ui.js';
import { I } from './icons.js';
import { launch } from './apps/registry.js';
import { settings, updateSettings, onSettingsChange } from './settings.js';
import { on as onWm, getFocused } from './wm.js';
import {
  iconHTML, openPath, itemMenu, setClipboard, pasteInto, clipboardHas, isCut, onClipboardChange, deleteItems,
  renameWithFeedback, newFolder, newTextFile, newOfficeFile, startDrag, dragKind, handleDrop, dropOnBin, currentDrag,
} from './fileops.js';

const POS_KEY = 'webwin-icons-v1';
const CELL = { large: [102, 116], medium: [80, 90], small: [78, 64] };

const SYSTEM_ICONS = [
  { key: 'sys:pc', name: 'This PC', icon: () => I.thispc, open: () => launch('explorer') },
  { key: 'sys:bin', name: 'Recycle Bin', icon: () => (getBin().length ? I.recycleFull : I.recycle), open: () => launch('recycle') },
];

let positions = {};
try { positions = JSON.parse(localStorage.getItem(POS_KEY) || '{}'); } catch { positions = {}; }
const savePositions = () => { try { localStorage.setItem(POS_KEY, JSON.stringify(positions)); } catch { /* ignore */ } };

let desktopFocused = false;
export const isDesktopFocused = () => desktopFocused && !getFocused();

export function initDesktop() {
  const iconsEl = document.getElementById('desktop-icons');
  const root = document.getElementById('desktop-root');
  const selBox = document.getElementById('selection-box');
  const selected = new Set();       /* keys */
  let items = [];                   /* current render list */
  let renaming = null;
  let pendingRename = null;         /* name of a new item to rename once rendered */
  let placeAt = null;               /* {col,row} for items dropped from elsewhere */

  const cell = () => CELL[settings.iconSize] || CELL.medium;
  const rowsPerCol = () => Math.max(1, Math.floor((root.clientHeight - 12) / cell()[1]));
  const colsMax = () => Math.max(1, Math.floor((root.clientWidth - 8) / cell()[0]));

  function buildItems() {
    const list = SYSTEM_ICONS.map(s => ({ key: s.key, name: s.name, iconSvg: s.icon(), type: 'sys', sys: s }));
    const dir = getNode(DESKTOP);
    for (const child of dir?.children || []) {
      list.push({ key: 'fs:' + child.id, name: child.name, node: child, type: child.type, iconSvg: iconHTML(child) });
    }
    return list;
  }

  function layout() {
    const R = rowsPerCol(), C = colsMax();
    const taken = new Set();
    const cellKey = (c, r) => c + ':' + r;
    const free = () => {
      for (let c = 0; c < 400; c++) for (let r = 0; r < R; r++) if (!taken.has(cellKey(c, r))) return { col: c, row: r };
      return { col: 0, row: 0 };
    };
    /* honour saved positions first */
    const pending = [];
    for (const it of items) {
      const p = settings.autoArrange ? null : positions[it.key];
      if (p && p.row < R && p.col < C && !taken.has(cellKey(p.col, p.row))) { it.pos = { col: p.col, row: p.row }; taken.add(cellKey(p.col, p.row)); }
      else pending.push(it);
    }
    for (const it of pending) {
      let p = null;
      if (placeAt && it.dropped) {
        p = nearestFree(placeAt, taken, R, C);
      }
      it.pos = p || free();
      taken.add(cellKey(it.pos.col, it.pos.row));
      if (!settings.autoArrange) positions[it.key] = it.pos;
    }
    placeAt = null;
    savePositions();
  }

  function nearestFree(target, taken, R, C) {
    for (let d = 0; d < 60; d++) {
      for (let dc = -d; dc <= d; dc++) for (let dr = -d; dr <= d; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== d) continue;
        const c = target.col + dc, r = target.row + dr;
        if (c < 0 || r < 0 || r >= R || c >= C) continue;
        if (!taken.has(c + ':' + r)) return { col: c, row: r };
      }
    }
    return null;
  }

  function renderIcons() {
    if (renaming) return;   /* don't blow away the rename box */
    if (!root.clientHeight) return;   /* hidden (boot / lock screen) — layout would be wrong */
    const prevKeys = new Set(items.map(i => i.key));
    items = buildItems();
    items.forEach(it => { if (!prevKeys.has(it.key) && prevKeys.size) it.dropped = true; });
    /* forget positions of deleted items */
    const live = new Set(items.map(i => i.key));
    Object.keys(positions).forEach(k => { if (!live.has(k)) delete positions[k]; });
    [...selected].forEach(k => { if (!live.has(k)) selected.delete(k); });
    layout();

    iconsEl.className = `size-${settings.iconSize}` + (settings.showDesktopIcons ? '' : ' hidden');
    iconsEl.innerHTML = '';
    const [cw, ch] = cell();
    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'dicon' + (selected.has(item.key) ? ' selected' : '') + (item.node && isCut(DESKTOP, item.name) ? ' cut' : '');
      el.dataset.key = item.key;
      el.draggable = true;
      el.style.left = (4 + item.pos.col * cw) + 'px';
      el.style.top = (6 + item.pos.row * ch) + 'px';
      el.style.width = (cw - 4) + 'px';
      el.innerHTML = `<span class="di-img">${item.iconSvg}</span><span class="di-label">${esc(item.name)}</span>`;
      el.title = item.node ? `${item.name}\nSize: ${Math.ceil(sizeOf(item.node) / 1024)} KB` : item.name;
      item.el = el;

      el.addEventListener('pointerdown', (e) => {
        if (e.button === 2 && selected.has(item.key)) return;
        if (e.ctrlKey) return;
        if (!selected.has(item.key)) selectOnly(item.key);
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.ctrlKey) { toggle(item.key); return; }
        selectOnly(item.key);
      });
      el.addEventListener('dblclick', (e) => { e.stopPropagation(); openItem(item); });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!selected.has(item.key)) selectOnly(item.key);
        contextMenu(e.clientX, e.clientY, menuFor(item));
      });

      /* drag source */
      el.addEventListener('dragstart', (e) => {
        if (renaming) { e.preventDefault(); return; }
        if (!selected.has(item.key)) selectOnly(item.key);
        const r = el.getBoundingClientRect();
        dragState = { anchor: item, grabX: e.clientX - r.left, grabY: e.clientY - r.top, keys: [...selected] };
        startDrag(e, DESKTOP, selectedNames());
      });
      el.addEventListener('dragend', () => { dragState = null; clearDropHints(); });

      /* drop targets: folders and the recycle bin */
      if (item.type === 'folder' || item.key === 'sys:bin') {
        el.addEventListener('dragover', (e) => {
          if (!dragKind(e)) return;
          if (dragState && dragState.keys.includes(item.key)) return;
          if (item.key === 'sys:bin' && dragKind(e) !== 'internal') return;
          e.preventDefault(); e.stopPropagation();
          e.dataTransfer.dropEffect = item.key === 'sys:bin' ? 'move' : (e.ctrlKey ? 'copy' : 'move');
          el.classList.add('drop-hint');
        });
        el.addEventListener('dragleave', () => el.classList.remove('drop-hint'));
        el.addEventListener('drop', async (e) => {
          e.stopPropagation();
          el.classList.remove('drop-hint');
          if (item.key === 'sys:bin') dropOnBin(e);
          else await handleDrop(e, [...DESKTOP, item.name]);
          dragState = null;
        });
      }
      iconsEl.appendChild(el);
    }

    if (pendingRename) {
      const it = items.find(i => i.node && i.name === pendingRename);
      pendingRename = null;
      if (it) { selectOnly(it.key); startRename(it); }
    }
  }

  let dragState = null;
  const clearDropHints = () => iconsEl.querySelectorAll('.drop-hint').forEach(x => x.classList.remove('drop-hint'));

  function openItem(item) {
    if (item.sys) item.sys.open();
    else openPath([...DESKTOP, item.name]);
  }
  function selectedItems() { return items.filter(i => selected.has(i.key)); }
  function selectedNames() { return selectedItems().filter(i => i.node).map(i => i.name); }

  function paintSelection() {
    iconsEl.querySelectorAll('.dicon').forEach(el => el.classList.toggle('selected', selected.has(el.dataset.key)));
  }
  function selectOnly(key) { selected.clear(); if (key) selected.add(key); paintSelection(); desktopFocused = true; }
  function toggle(key) { selected.has(key) ? selected.delete(key) : selected.add(key); paintSelection(); }

  /* ---------- inline rename ---------- */
  function startRename(item) {
    if (!item || !item.node || !item.el) return;
    renaming = item;
    item.el.classList.add('editing');
    item.el.draggable = false;
    const ta = document.createElement('textarea');
    ta.className = 'di-edit selectable';
    ta.value = item.name;
    ta.spellcheck = false;
    item.el.appendChild(ta);
    const dot = item.node.type === 'file' ? item.name.lastIndexOf('.') : -1;
    ta.focus();
    ta.setSelectionRange(0, dot > 0 ? dot : item.name.length);
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const v = ta.value.replace(/\n/g, '').trim();
      renaming = null;
      if (commit && v && v !== item.name) {
        const oldKey = item.key;
        if (renameWithFeedback(DESKTOP, item.name, v)) { positions[oldKey] = item.pos; }
      }
      renderIcons();
    };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    ta.addEventListener('blur', () => finish(true));
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    ta.addEventListener('dblclick', (e) => e.stopPropagation());
  }
  function renameSelected() {
    const it = selectedItems().find(i => i.node);
    if (it) startRename(it);
  }

  /* ---------- menus ---------- */
  function menuFor(item) {
    if (item.key === 'sys:bin') {
      return [
        { label: 'Open', bold: true, icon: I.open, action: () => item.sys.open() },
        '-',
        { label: 'Empty Recycle Bin', icon: I.trash, disabled: !getBin().length, action: () => launch('recycle', { empty: true }) },
      ];
    }
    if (item.key === 'sys:pc') {
      return [
        { label: 'Open', bold: true, icon: I.open, action: () => item.sys.open() },
        { label: 'Manage', icon: I.taskmgr, action: () => launch('taskmgr') },
        '-',
        { label: 'Properties', icon: I.info, action: () => launch('settings', { page: 'about' }) },
      ];
    }
    const names = selectedNames();
    return itemMenu(DESKTOP, names.length ? names : [item.name], { onRename: () => startRename(item) });
  }

  function desktopMenu(x, y) {
    const sizeItem = (label, v) => ({ label, checked: settings.iconSize === v, action: () => updateSettings({ iconSize: v }) });
    const sortBy = (fn) => () => {
      const fsItems = items.filter(i => i.node).sort(fn);
      const ordered = [...items.filter(i => i.sys), ...fsItems];
      positions = {};
      const R = rowsPerCol();
      ordered.forEach((it, i) => { positions[it.key] = { col: Math.floor(i / R), row: i % R }; });
      savePositions();
      renderIcons();
    };
    contextMenu(x, y, [
      { label: 'View', submenu: [
        sizeItem('Large icons', 'large'), sizeItem('Medium icons', 'medium'), sizeItem('Small icons', 'small'),
        '-',
        { label: 'Auto arrange icons', checked: settings.autoArrange, action: () => updateSettings({ autoArrange: !settings.autoArrange }) },
        { label: 'Show desktop icons', checked: settings.showDesktopIcons, action: () => updateSettings({ showDesktopIcons: !settings.showDesktopIcons }) },
      ] },
      { label: 'Sort by', submenu: [
        { label: 'Name', action: sortBy((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'folder' ? -1 : 1)) },
        { label: 'Size', action: sortBy((a, b) => sizeOf(b.node) - sizeOf(a.node)) },
        { label: 'Item type', action: sortBy((a, b) => kindOf(a.node).localeCompare(kindOf(b.node)) || a.name.localeCompare(b.name)) },
        { label: 'Date modified', action: sortBy((a, b) => (b.node.modified || 0) - (a.node.modified || 0)) },
      ] },
      { label: 'Refresh', icon: I.refresh, hint: 'F5', action: () => { iconsEl.classList.add('refreshing'); setTimeout(() => { iconsEl.classList.remove('refreshing'); renderIcons(); }, 120); } },
      '-',
      { label: 'Paste', icon: I.paste, hint: 'Ctrl+V', disabled: !clipboardHas(), action: () => { placeAt = cellAt(x, y); pasteInto(DESKTOP); } },
      '-',
      { label: 'New', submenu: [
        { label: 'Folder', icon: I.folder, action: () => { placeAt = cellAt(x, y); const n = newFolder(DESKTOP); pendingRename = n.name; } },
        { label: 'Text Document', icon: I.txt, action: () => { placeAt = cellAt(x, y); const n = newTextFile(DESKTOP); pendingRename = n.name; } },
        { label: 'Microsoft Word Document', icon: I.wordfile, action: async () => { placeAt = cellAt(x, y); const n = await newOfficeFile(DESKTOP, 'word'); pendingRename = n.name; renderIcons(); } },
        { label: 'Microsoft Excel Worksheet', icon: I.sheetfile, action: async () => { placeAt = cellAt(x, y); const n = await newOfficeFile(DESKTOP, 'excel'); pendingRename = n.name; renderIcons(); } },
      ] },
      '-',
      { label: 'Open in Command Prompt', icon: I.terminalSmall, action: () => launch('terminal', { cwd: DESKTOP }) },
      { label: 'Display settings', icon: I.monitor, action: () => launch('settings', { page: 'system' }) },
      { label: 'Personalize', icon: I.paint, action: () => launch('settings', { page: 'personalization' }) },
    ]);
  }

  function cellAt(x, y) {
    const r = iconsEl.getBoundingClientRect();
    const [cw, ch] = cell();
    return { col: Math.max(0, Math.floor((x - r.left - 4) / cw)), row: Math.max(0, Math.min(rowsPerCol() - 1, Math.floor((y - r.top - 6) / ch))) };
  }

  /* ---------- rubber band selection ---------- */
  let band = null;
  root.addEventListener('pointerdown', (e) => {
    desktopFocused = !e.target.closest('.window');
    if (e.button !== 0) return;
    if (e.target !== iconsEl && e.target !== root) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (!e.ctrlKey) selectOnly(null);
    const base = new Set(selected);
    band = { x: e.clientX, y: e.clientY };
    selBox.classList.remove('hidden');
    Object.assign(selBox.style, { left: e.clientX + 'px', top: e.clientY + 'px', width: '0px', height: '0px' });
    const move = (ev) => {
      if (!band) return;
      const rr = root.getBoundingClientRect();
      const cx = Math.max(rr.left, Math.min(rr.right, ev.clientX)), cy = Math.max(rr.top, Math.min(rr.bottom, ev.clientY));
      const x = Math.min(band.x, cx), y = Math.min(band.y, cy);
      const w = Math.abs(cx - band.x), h = Math.abs(cy - band.y);
      Object.assign(selBox.style, { left: (x - rr.left) + 'px', top: (y - rr.top) + 'px', width: w + 'px', height: h + 'px' });
      selected.clear(); base.forEach(k => selected.add(k));
      iconsEl.querySelectorAll('.dicon').forEach(ic => {
        const r = ic.getBoundingClientRect();
        if (r.left < x + w && r.right > x && r.top < y + h && r.bottom > y) selected.add(ic.dataset.key);
      });
      paintSelection();
    };
    const up = () => {
      band = null;
      selBox.classList.add('hidden');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  document.getElementById('taskbar').addEventListener('pointerdown', () => { desktopFocused = false; });
  onWm('focus', (w) => { if (w) desktopFocused = false; });

  /* ---------- desktop context menu ---------- */
  root.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.window') || e.target.closest('.dicon')) return;
    e.preventDefault();
    selectOnly(null);
    desktopMenu(e.clientX, e.clientY);
  });

  /* ---------- drop onto the desktop background ---------- */
  const isBackground = (e) => e.target === root || e.target === iconsEl || e.target.closest('.dicon') && !e.target.closest('.dicon.drop-hint');
  root.addEventListener('dragover', (e) => {
    if (e.target.closest('.window')) return;
    if (!dragKind(e) || !isBackground(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragState ? 'move' : (dragKind(e) === 'files' || e.ctrlKey ? 'copy' : 'move');
  });
  root.addEventListener('drop', async (e) => {
    if (e.target.closest('.window')) return;
    if (!isBackground(e)) return;
    e.preventDefault();
    const target = cellAt(e.clientX, e.clientY);
    const payload = currentDrag();
    if (dragState && payload && !e.ctrlKey) {
      /* rearranging icons on the desktop */
      const anchor = dragState.anchor;
      const anchorCell = cellAt(e.clientX - dragState.grabX + cell()[0] / 2, e.clientY - dragState.grabY + cell()[1] / 2);
      const dc = anchorCell.col - anchor.pos.col, dr = anchorCell.row - anchor.pos.row;
      const R = rowsPerCol(), C = colsMax();
      const moving = items.filter(i => dragState.keys.includes(i.key));
      const taken = new Set(items.filter(i => !dragState.keys.includes(i.key)).map(i => i.pos.col + ':' + i.pos.row));
      for (const it of moving) {
        let p = { col: Math.max(0, Math.min(C - 1, it.pos.col + dc)), row: Math.max(0, Math.min(R - 1, it.pos.row + dr)) };
        if (taken.has(p.col + ':' + p.row)) p = nearestFree(p, taken, R, C) || it.pos;
        taken.add(p.col + ':' + p.row);
        positions[it.key] = p;
      }
      if (settings.autoArrange) updateSettings({ autoArrange: false });
      savePositions();
      dragState = null;
      renderIcons();
      return;
    }
    placeAt = target;
    await handleDrop(e, DESKTOP);
  });

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', (e) => {
    if (root.classList.contains('hidden') || renaming) return;
    if (!isDesktopFocused()) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (document.getElementById('dialog-layer').children.length) return;
    const k = e.key;
    const names = selectedNames();
    if (k === 'Enter') { selectedItems().forEach(openItem); }
    else if (k === 'Delete') { if (names.length) deleteItems(DESKTOP, names, { permanent: e.shiftKey }); }
    else if (k === 'F2') { e.preventDefault(); renameSelected(); }
    else if (k === 'F5') { e.preventDefault(); renderIcons(); }
    else if (e.ctrlKey && k.toLowerCase() === 'a') { e.preventDefault(); items.forEach(i => selected.add(i.key)); paintSelection(); }
    else if (e.ctrlKey && k.toLowerCase() === 'c') { if (names.length) setClipboard('copy', DESKTOP, names); }
    else if (e.ctrlKey && k.toLowerCase() === 'x') { if (names.length) setClipboard('cut', DESKTOP, names); }
    else if (e.ctrlKey && k.toLowerCase() === 'v') { pasteInto(DESKTOP); }
    else if (k.startsWith('Arrow')) {
      e.preventDefault();
      const cur = selectedItems()[0] || items[0];
      if (!cur) return;
      const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[k];
      const next = items.filter(i => i !== cur).map(i => ({ i, dc: i.pos.col - cur.pos.col, dr: i.pos.row - cur.pos.row }))
        .filter(o => (d[0] ? Math.sign(o.dc) === d[0] : Math.sign(o.dr) === d[1]))
        .sort((a, b) => (Math.abs(a.dc) + Math.abs(a.dr) * (d[0] ? 3 : 1)) - (Math.abs(b.dc) + Math.abs(b.dr) * (d[0] ? 3 : 1)))[0];
      selectOnly((next ? next.i : cur).key);
    }
  });

  onFSChange(renderIcons);
  onClipboardChange(renderIcons);
  onSettingsChange((s, patch) => {
    if (patch && ('iconSize' in patch || 'showDesktopIcons' in patch || 'autoArrange' in patch)) renderIcons();
  });
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderIcons, 120); });

  renderIcons();
  /* layout depends on the desktop's size, which is only known once it is visible */
  requestAnimationFrame(renderIcons);
  return { refresh: renderIcons };
}
