/* Recycle Bin — details view, multi-select, restore (one / all), delete permanently, empty. */
import { createWindow } from '../wm.js';
import { getBin, restoreFromBin, removeFromBin, emptyBin, onFSChange, addressOf, sizeOf, formatSize, typeLabel } from '../fs.js';
import { I } from '../icons.js';
import { confirmDialog, contextMenu, esc } from '../ui.js';
import { iconFor, dragKind, dropOnBin } from '../fileops.js';
import { playSound } from '../sound.js';

export function open(arg = null) {
  const win = createWindow({ title: 'Recycle Bin', icon: I.recycle, appId: 'recycle', w: 760, h: 460, minW: 460, minH: 260 });
  win.body.innerHTML = `
    <div class="recycle" tabindex="-1">
      <div class="exp-ribbon">
        <button class="rb-btn big" data-a="empty">${I.trash}<span>Empty Recycle Bin</span></button>
        <button class="rb-btn" data-a="restoreall">${I.undo}<span>Restore all items</span></button>
        <button class="rb-btn" data-a="restore">${I.restart}<span>Restore the selected items</span></button>
        <button class="rb-btn" data-a="delete">${I.x}<span>Delete permanently</span></button>
      </div>
      <div class="rb-list">
        <div class="det-head rb-head"><span>Name</span><span>Original Location</span><span>Date Deleted</span><span>Size</span><span>Item type</span></div>
        <div class="rb-rows"></div>
      </div>
      <div class="exp-status"><span class="rb-info"></span></div>
    </div>`;

  const root = win.body.querySelector('.recycle');
  const rows = root.querySelector('.rb-rows');
  const info = root.querySelector('.rb-info');
  const btn = (a) => root.querySelector(`.rb-btn[data-a="${a}"]`);
  let selected = new Set();   /* item objects */
  let anchor = -1;

  function render() {
    const bin = getBin();
    selected = new Set([...selected].filter(it => bin.includes(it)));
    const list = bin.slice().reverse();   /* newest first */
    rows.innerHTML = '';
    if (!bin.length) rows.innerHTML = `<div class="rb-empty">${I.recycle}<div>The Recycle Bin is empty.</div></div>`;
    list.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'exp-item rb-item' + (selected.has(item) ? ' selected' : '');
      el.innerHTML = `<span class="ei-name-cell"><span class="ei-icon">${iconFor(item.node)}</span><span class="ei-name">${esc(item.node.name)}</span></span>
        <span class="ei-col">${esc(addressOf(item.from))}</span>
        <span class="ei-col">${new Date(item.deletedAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}</span>
        <span class="ei-col num">${formatSize(sizeOf(item.node))}</span>
        <span class="ei-col">${esc(typeLabel(item.node))}</span>`;
      el.addEventListener('click', (e) => {
        if (e.shiftKey && anchor >= 0) {
          if (!e.ctrlKey) selected.clear();
          list.slice(Math.min(anchor, i), Math.max(anchor, i) + 1).forEach(x => selected.add(x));
        } else if (e.ctrlKey) { selected.has(item) ? selected.delete(item) : selected.add(item); anchor = i; }
        else { selected = new Set([item]); anchor = i; }
        paint();
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!selected.has(item)) { selected = new Set([item]); anchor = i; paint(); }
        contextMenu(e.clientX, e.clientY, [
          { label: 'Restore', bold: true, action: restoreSel },
          '-',
          { label: 'Cut', disabled: true },
          { label: 'Delete', icon: I.trash, action: deleteSel },
        ]);
      });
      el.addEventListener('dblclick', () => { selected = new Set([item]); restoreSel(); });
      el.dataset.i = i;
      rows.appendChild(el);
    });
    const total = bin.reduce((a, b) => a + sizeOf(b.node), 0);
    info.textContent = `${bin.length} item${bin.length === 1 ? '' : 's'}` + (bin.length ? `   ${formatSize(total)}` : '');
    paint();
  }

  function paint() {
    const list = getBin().slice().reverse();
    rows.querySelectorAll('.rb-item').forEach(el => el.classList.toggle('selected', selected.has(list[+el.dataset.i])));
    btn('restore').disabled = btn('delete').disabled = !selected.size;
    btn('empty').disabled = btn('restoreall').disabled = !getBin().length;
    if (selected.size) info.textContent = `${getBin().length} items   ${selected.size} item${selected.size === 1 ? '' : 's'} selected`;
  }

  function restoreSel() {
    const items = [...selected];
    let lastDir = null;
    for (const it of items) {
      const i = getBin().indexOf(it);
      if (i >= 0) lastDir = restoreFromBin(i);
    }
    selected.clear();
    return lastDir;
  }
  async function deleteSel() {
    const items = [...selected];
    if (!items.length) return;
    const msg = items.length === 1 ? `Are you sure you want to permanently delete "${esc(items[0].node.name)}"?` : `Are you sure you want to permanently delete these ${items.length} items?`;
    if (!(await confirmDialog(items.length === 1 ? 'Delete File' : 'Delete Multiple Items', msg, 'Yes', 'No', 'warn'))) return;
    for (const it of items) { const i = getBin().indexOf(it); if (i >= 0) removeFromBin(i); }
    selected.clear();
    playSound('recycle');
  }
  async function emptyAll() {
    const n = getBin().length;
    if (!n) return;
    const msg = n === 1 ? `Are you sure you want to permanently delete "${esc(getBin()[0].node.name)}"?` : `Are you sure you want to permanently delete these ${n} items?`;
    if (await confirmDialog(n === 1 ? 'Delete File' : 'Delete Multiple Items', msg, 'Yes', 'No', 'warn')) {
      emptyBin();
      playSound('recycle', true);
    }
  }

  btn('empty').addEventListener('click', emptyAll);
  btn('restoreall').addEventListener('click', async () => {
    if (await confirmDialog('Restore all items', `Restore all ${getBin().length} items to their original locations?`, 'Yes', 'No')) {
      selected = new Set(getBin()); restoreSel();
    }
  });
  btn('restore').addEventListener('click', () => restoreSel());
  btn('delete').addEventListener('click', deleteSel);

  rows.addEventListener('click', (e) => { if (e.target === rows) { selected.clear(); paint(); } });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Delete') { e.preventDefault(); deleteSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); restoreSel(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'a') { e.preventDefault(); selected = new Set(getBin()); paint(); }
  });
  root.addEventListener('pointerdown', () => setTimeout(() => root.focus({ preventScroll: true }), 0));

  /* drop files on the window to delete them */
  root.addEventListener('dragover', (e) => { if (dragKind(e) === 'internal') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
  root.addEventListener('drop', (e) => { if (dragKind(e) === 'internal') dropOnBin(e); });

  const offFS = onFSChange(render);
  win.onclose(offFS);
  win.onRelaunch = (a) => { if (a && a.empty) emptyAll(); };
  render();
  if (arg && arg.empty) setTimeout(emptyAll, 100);
  return win;
}

