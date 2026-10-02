/* Common file dialog (Open / Save As) — browses the virtual file system like the real comdlg32. */
import { getNode, canonical, parsePath, kindOf, typeLabel, formatSize, sizeOf, addressOf, isValidName, extOf, KNOWN, pathEquals } from './fs.js';
import { mountDialog, esc, msgDialog, confirmDialog } from './ui.js';
import { iconFor, newFolder } from './fileops.js';
import { I } from './icons.js';

const PLACES = [
  { name: 'Desktop', path: KNOWN.desktop, icon: I.monitor },
  { name: 'Documents', path: KNOWN.documents, icon: I.docStack },
  { name: 'Downloads', path: KNOWN.downloads, icon: I.download },
  { name: 'Pictures', path: KNOWN.pictures, icon: I.photos },
  { name: 'Music', path: KNOWN.music, icon: I.musicfile },
  { name: 'Videos', path: KNOWN.videos, icon: I.videofile },
  { name: 'Local Disk (C:)', path: [], icon: I.drive },
];

/**
 * mode: 'open' | 'save'
 * kinds: array of kinds to show (e.g. ['txt']) or null for all files
 * filterLabel: shown in the type box, e.g. 'Text Documents (*.txt)'
 * defaultExt: appended on save when the name has no extension, e.g. 'txt'
 * Resolves with a path array, or null when cancelled.
 */
export function fileDialog({ mode = 'open', title, startDir = KNOWN.documents, defaultName = '', kinds = null, filterLabel = 'All Files (*.*)', defaultExt = null } = {}) {
  return new Promise((resolve) => {
    let dir = canonical(startDir) || [...KNOWN.documents];
    const history = [];
    let selected = null;

    const dlg = document.createElement('div');
    dlg.className = 'dlg fdlg';
    dlg.innerHTML = `
      <div class="dlg-title">${esc(title || (mode === 'save' ? 'Save As' : 'Open'))}</div>
      <div class="fd-bar">
        <button class="toolbar-btn fd-back" title="Back">${I.arrowLeft}</button>
        <button class="toolbar-btn fd-up" title="Up">${I.arrowUp}</button>
        <input class="fd-addr" spellcheck="false">
        <button class="toolbar-btn fd-new" title="New folder">${I.plus}</button>
      </div>
      <div class="fd-main">
        <div class="fd-side"></div>
        <div class="fd-list">
          <div class="fd-head"><span>Name</span><span>Date modified</span><span>Type</span><span>Size</span></div>
          <div class="fd-rows"></div>
        </div>
      </div>
      <div class="fd-foot">
        <label>File name:</label><input class="fd-name" spellcheck="false">
        <select class="fd-type"><option>${esc(filterLabel)}</option></select>
      </div>
      <div class="dlg-footer">
        <button class="btn primary fd-ok">${mode === 'save' ? 'Save' : 'Open'}</button>
        <button class="btn fd-cancel">Cancel</button>
      </div>`;

    const side = dlg.querySelector('.fd-side');
    const rows = dlg.querySelector('.fd-rows');
    const addr = dlg.querySelector('.fd-addr');
    const nameInput = dlg.querySelector('.fd-name');
    nameInput.value = defaultName;

    side.innerHTML = PLACES.map((p, i) => `<div class="fd-place" data-i="${i}">${p.icon}<span>${p.name}</span></div>`).join('');
    side.querySelectorAll('.fd-place').forEach(el => el.addEventListener('click', () => go(PLACES[+el.dataset.i].path)));

    function go(path, push = true) {
      const node = getNode(path);
      if (!node || node.type !== 'folder') return false;
      if (push) history.push(dir);
      dir = canonical(path);
      selected = null;
      render();
      return true;
    }

    function render() {
      addr.value = addressOf(dir);
      side.querySelectorAll('.fd-place').forEach(el => el.classList.toggle('sel', pathEquals(PLACES[+el.dataset.i].path, dir)));
      const node = getNode(dir);
      const kids = (node.children || [])
        .filter(c => c.type === 'folder' || !kinds || kinds.includes(kindOf(c)))
        .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'folder' ? -1 : 1);
      rows.innerHTML = kids.length ? '' : '<div class="fd-empty">No items match your search.</div>';
      for (const c of kids) {
        const r = document.createElement('div');
        r.className = 'fd-row';
        r.innerHTML = `<span class="fd-n">${iconFor(c)}<span>${esc(c.name)}</span></span>
          <span>${new Date(c.modified || c.created).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}</span>
          <span>${esc(typeLabel(c))}</span><span>${c.type === 'file' ? formatSize(sizeOf(c)) : ''}</span>`;
        r.addEventListener('click', () => {
          rows.querySelectorAll('.fd-row.sel').forEach(x => x.classList.remove('sel'));
          r.classList.add('sel');
          selected = c;
          if (c.type === 'file') nameInput.value = c.name;
        });
        r.addEventListener('dblclick', () => {
          if (c.type === 'folder') go([...dir, c.name]);
          else { nameInput.value = c.name; submit(); }
        });
        rows.appendChild(r);
      }
    }

    async function submit() {
      let name = nameInput.value.trim();
      if (!name && selected && selected.type === 'folder') { go([...dir, selected.name]); return; }
      if (!name) return;
      const target = parsePath(name, dir);
      if (!target) { msgDialog(title || 'Open', 'The file name is not valid.', 'error'); return; }
      const existing = getNode(target);
      if (existing && existing.type === 'folder') { go(target); nameInput.value = ''; return; }

      if (mode === 'open') {
        if (!existing) {
          msgDialog(title || 'Open', `${esc(name)}<br>File not found.<br>Check the file name and try again.`, 'warn');
          return;
        }
        finish(canonical(target));
        return;
      }

      /* save */
      let fname = target[target.length - 1];
      if (defaultExt && !extOf(fname)) fname += '.' + defaultExt;
      const parent = target.slice(0, -1);
      const pnode = getNode(parent);
      if (!pnode || pnode.type !== 'folder') { msgDialog(title || 'Save As', `The path '${esc(addressOf(parent))}' does not exist.`, 'error'); return; }
      if (!isValidName(fname)) {
        msgDialog(title || 'Save As', 'The file name is not valid. A file name can\'t contain any of the following characters: \\ / : * ? " &lt; &gt; |', 'error');
        return;
      }
      const full = [...canonical(parent), fname];
      const clash = getNode(full);
      if (clash) {
        if (clash.type === 'folder') { msgDialog(title || 'Save As', 'A folder with that name already exists.', 'warn'); return; }
        const ok = await confirmDialog('Confirm Save As', `${esc(clash.name)} already exists.<br>Do you want to replace it?`, 'Yes', 'No', 'warn');
        if (!ok) return;
        full[full.length - 1] = clash.name;
      }
      finish(full);
    }

    let close;
    const finish = (v) => { close(); resolve(v); };
    close = mountDialog(dlg, { onCancel: () => finish(null), onEnter: submit });

    dlg.querySelector('.fd-ok').addEventListener('click', submit);
    dlg.querySelector('.fd-cancel').addEventListener('click', () => finish(null));
    dlg.querySelector('.fd-back').addEventListener('click', () => { if (history.length) go(history.pop(), false); });
    dlg.querySelector('.fd-up').addEventListener('click', () => { if (dir.length) go(dir.slice(0, -1)); });
    dlg.querySelector('.fd-new').addEventListener('click', () => { newFolder(dir); render(); });
    addr.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault(); e.stopPropagation();
      const p = parsePath(addr.value, dir);
      if (!p || !go(p)) { msgDialog('Location', `Windows can't find '${esc(addr.value)}'.`, 'error'); addr.value = addressOf(dir); }
    });

    render();
    setTimeout(() => { nameInput.focus(); const dot = nameInput.value.lastIndexOf('.'); nameInput.setSelectionRange(0, dot > 0 ? dot : nameInput.value.length); }, 30);
  });
}
