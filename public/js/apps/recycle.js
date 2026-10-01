/* Recycle Bin — restore / delete forever / empty */
import { createWindow } from '../wm.js';
import { getBin, restoreFromBin, removeFromBin, emptyBin } from '../fs.js';
import { I } from '../icons.js';
import { notify, confirmDialog } from '../ui.js';
import { emitDesktopRefresh } from '../desktop.js';

const iconFor = (node) =>
  node.type === 'folder' ? I.folder :
  node.kind === 'img' ? I.imgfile : I.txt;

export function open() {
  const win = createWindow({ title: 'Recycle Bin', icon: I.recycle, appId: 'recycle', w: 640, h: 420 });
  win.body.innerHTML = `
    <div class="recycle">
      <div class="rb-bar">
        <button class="btn rb-restore" disabled>Restore the selected item</button>
        <button class="btn rb-delete" disabled>Delete permanently</button>
        <button class="btn rb-empty">Empty Recycle Bin</button>
        <span class="rb-info"></span>
      </div>
      <div class="rb-list"></div>
    </div>`;

  const root = win.body.querySelector('.recycle');
  const list = root.querySelector('.rb-list');
  const info = root.querySelector('.rb-info');
  const restoreBtn = root.querySelector('.rb-restore');
  const deleteBtn = root.querySelector('.rb-delete');
  const emptyBtn = root.querySelector('.rb-empty');
  let selected = -1;

  function render() {
    const bin = getBin();
    selected = -1;
    restoreBtn.disabled = deleteBtn.disabled = true;
    info.textContent = `${bin.length} item${bin.length === 1 ? '' : 's'}`;
    if (!bin.length) {
      list.innerHTML = `<div class="rb-empty">Recycle Bin is empty — a tidy desktop is a tidy mind.</div>`;
      return;
    }
    list.innerHTML = '';
    bin.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'rb-item';
      el.innerHTML = `${iconFor(item.node)}<span>${item.node.name}</span>
        <span class="rbi-date">Deleted ${new Date(item.deletedAt).toLocaleString()}</span>`;
      el.addEventListener('click', () => {
        list.querySelectorAll('.rb-item.selected').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        selected = i;
        restoreBtn.disabled = deleteBtn.disabled = false;
      });
      list.appendChild(el);
    });
  }

  restoreBtn.addEventListener('click', () => {
    if (selected < 0) return;
    restoreFromBin(selected);
    emitDesktopRefresh();
    notify('Recycle Bin', 'Item restored to its original folder.', I.recycle);
    render();
  });
  deleteBtn.addEventListener('click', () => {
    if (selected < 0) return;
    removeFromBin(selected);
    render();
  });
  emptyBtn.addEventListener('click', async () => {
    if (!getBin().length) return;
    if (await confirmDialog('Delete Multiple Items', `Are you sure you want to permanently delete these ${getBin().length} items?`, 'Yes', 'No')) {
      emptyBin();
      render();
    }
  });

  render();
  return win;
}
