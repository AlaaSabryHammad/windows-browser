/* File Explorer */
import { createWindow } from '../wm.js';
import { getNode, addNode, deleteNode, renameNode, addressOf, HOME, makeFolder, makeFile, getBin } from '../fs.js';
import { contextMenu, promptDialog, msgDialog, notify } from '../ui.js';
import { I } from '../icons.js';
import { launch } from './registry.js';

const iconFor = (node) =>
  node.type === 'folder' ? I.folder :
  node.kind === 'img' ? I.imgfile : I.txt;

const QUICK = [
  { name: 'Desktop',   path: [...HOME, 'Desktop'],   icon: I.monitor },
  { name: 'Documents', path: [...HOME, 'Documents'], icon: I.docStack },
  { name: 'Downloads', path: [...HOME, 'Downloads'], icon: I.arrowDown || I.folder },
  { name: 'Pictures',  path: [...HOME, 'Pictures'],  icon: I.photos },
  { name: 'Music',     path: [...HOME, 'Music'],     icon: I.play },
  { name: 'Videos',    path: [...HOME, 'Videos'],    icon: I.ellipse },
];

export function open(startPath = null) {
  const win = createWindow({ title: 'File Explorer', icon: I.folder, appId: 'explorer', w: 860, h: 540 });
  win.body.innerHTML = `
    <div class="explorer">
      <div class="exp-toolbar">
        <button class="toolbar-btn t-back" title="Back">${I.arrowLeft}</button>
        <button class="toolbar-btn t-fwd" title="Forward">${I.arrowRight}</button>
        <button class="toolbar-btn t-up" title="Up one level">${I.arrowUp}</button>
        <div class="exp-crumbs"></div>
        <input class="exp-search" placeholder="Search">
      </div>
      <div class="exp-actions">
        <div class="act a-newfolder">${I.plus}<span>New folder</span></div>
        <div class="act a-newtxt">${I.txt}<span>New text document</span></div>
        <div class="sep"></div>
        <div class="act a-refresh">${I.refresh}<span>Refresh</span></div>
      </div>
      <div class="exp-main">
        <div class="exp-side"></div>
        <div class="exp-files"></div>
      </div>
      <div class="exp-status"></div>
    </div>`;

  const root = win.body.querySelector('.explorer');
  const crumbs = root.querySelector('.exp-crumbs');
  const side = root.querySelector('.exp-side');
  const files = root.querySelector('.exp-files');
  const status = root.querySelector('.exp-status');
  const searchInput = root.querySelector('.exp-search');
  const backBtn = root.querySelector('.t-back'), fwdBtn = root.querySelector('.t-fwd'), upBtn = root.querySelector('.t-up');

  const state = { atThisPC: !startPath, path: startPath || [], history: [], future: [], selected: null, filter: '' };

  function navigate(path, isThisPC = false) {
    if (!isThisPC) {
      const node = getNode(path);
      if (!node || node.type !== 'folder') return;
    }
    state.history.push({ path: state.path, thisPC: state.atThisPC });
    state.future = [];
    state.path = path; state.atThisPC = isThisPC;
    state.selected = null; state.filter = ''; searchInput.value = '';
    render();
  }

  function goBack() {
    if (!state.history.length) return;
    const prev = state.history.pop();
    state.future.push({ path: state.path, thisPC: state.atThisPC });
    state.path = prev.path; state.atThisPC = prev.thisPC;
    state.selected = null;
    render();
  }
  function goFwd() {
    if (!state.future.length) return;
    const next = state.future.pop();
    state.history.push({ path: state.path, thisPC: state.atThisPC });
    state.path = next.path; state.thisPC = next.thisPC;
    state.atThisPC = next.thisPC;
    state.selected = null;
    render();
  }
  function goUp() {
    if (state.atThisPC) return;
    if (!state.path.length) { state.history.push({ path: [], thisPC: false }); state.atThisPC = true; render(); return; }
    state.history.push({ path: state.path, thisPC: false });
    state.path = state.path.slice(0, -1);
    state.selected = null;
    render();
  }

  backBtn.addEventListener('click', goBack);
  fwdBtn.addEventListener('click', goFwd);
  upBtn.addEventListener('click', goUp);
  root.querySelector('.a-refresh').addEventListener('click', render);
  searchInput.addEventListener('input', () => { state.filter = searchInput.value.toLowerCase(); render(); });

  root.querySelector('.a-newfolder').addEventListener('click', async () => {
    const name = await promptDialog('New folder', 'Folder name:', 'New folder');
    if (name) { addNode(state.path, makeFolder(name)); render(); }
  });
  root.querySelector('.a-newtxt').addEventListener('click', async () => {
    const name = await promptDialog('New text document', 'File name:', 'New Text Document.txt');
    if (name) { addNode(state.path, makeFile(name.endsWith('.txt') ? name : name + '.txt', 'txt', '')); render(); }
  });

  function renderSide() {
    side.innerHTML = `<div class="side-title">Quick access</div>` +
      QUICK.map(q => `<div class="side-item" data-i="${q.name}">${q.icon}<span>${q.name}</span></div>`).join('') +
      `<div class="side-title" style="margin-top:10px">This PC</div>
       <div class="side-item" data-pc="1">${I.thispc}<span>This PC</span></div>
       <div class="drive-wrap">
         <div class="drive-bar"><div class="fill"></div></div>
         <div class="drive-info">Local Disk (C:) — 163 GB free of 512 GB</div>
       </div>`;
    side.querySelectorAll('.side-item').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.pc) navigate([], true);
        else { const q = QUICK.find(x => x.name === el.dataset.i); navigate(q.path); }
      });
    });
  }

  function renderCrumbs() {
    crumbs.innerHTML = '';
    const add = (label, action, first) => {
      if (!first) { const sep = document.createElement('span'); sep.className = 'crumb-sep'; sep.textContent = '›'; crumbs.appendChild(sep); }
      const c = document.createElement('span');
      c.className = 'crumb'; c.textContent = label;
      c.addEventListener('click', action);
      crumbs.appendChild(c);
    };
    add('This PC', () => navigate([], true), true);
    if (!state.atThisPC) {
      let acc = [];
      add('Local Disk (C:)', () => navigate([]));
      state.path.forEach(seg => {
        acc = [...acc, seg];
        const p = [...acc];
        add(seg, () => navigate(p));
      });
    }
  }

  function openItem(node) {
    if (node.type === 'folder') navigate([...state.path, node.name]);
    else if (node.kind === 'txt') launch('notepad', { path: [...state.path, node.name] });
    else if (node.kind === 'img') launch('photos', { path: [...state.path, node.name] });
    else msgDialog('File Explorer', `Windows can't open this type of file yet.`);
  }

  function renderFiles() {
    files.innerHTML = '';
    if (state.atThisPC) {
      status.textContent = `${QUICK.length + 1} items`;
      files.innerHTML = `<div class="exp-drives">
        ${QUICK.map(q => `<div class="pcard" data-i="${q.name}">${q.icon}<div><div class="pc-name">${q.name}</div></div></div>`).join('')}
        <div class="pcard" data-i="__c">${I.drive}<div><div class="pc-name">Local Disk (C:)</div>
          <div class="drive-bar"><div class="fill"></div></div>
          <div class="drive-info">163 GB free of 512 GB</div></div></div>
      </div>`;
      files.querySelectorAll('.pcard').forEach(el => el.addEventListener('click', () => {
        if (el.dataset.i === '__c') navigate([]);
        else { const q = QUICK.find(x => x.name === el.dataset.i); navigate(q.path); }
      }));
      return;
    }

    const node = getNode(state.path);
    if (!node) { state.atThisPC = true; renderFiles(); return; }
    let children = (node.children || []).slice().sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1);
    if (state.filter) children = children.filter(c => c.name.toLowerCase().includes(state.filter));

    win.setTitle(`${node.name} — File Explorer`);
    status.textContent = `${children.length} item${children.length === 1 ? '' : 's'}` + (state.selected ? `  |  1 item selected` : '');

    if (!children.length) {
      files.innerHTML = `<div class="exp-empty">This folder is empty</div>`;
      return;
    }
    for (const child of children) {
      const el = document.createElement('div');
      el.className = 'exp-item';
      el.innerHTML = `<span class="ei-icon">${iconFor(child)}</span><span class="ei-name">${child.name}</span>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        files.querySelectorAll('.exp-item.selected').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        state.selected = child;
        status.textContent = `${children.length} items  |  1 item selected`;
      });
      el.addEventListener('dblclick', () => openItem(child));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!el.classList.contains('selected')) el.click();
        contextMenu(e.clientX, e.clientY, [
          { label: 'Open', icon: I.open, action: () => openItem(child) },
          '-',
          { label: 'Rename', icon: I.rename, action: async () => {
            const name = await promptDialog('Rename', 'New name:', child.name);
            if (name) { renameNode(state.path, child.name, name); render(); }
          } },
          { label: 'Delete', icon: I.trash, action: async () => {
            if (await confirm('Delete', `Are you sure you want to delete "${child.name}"?`)) {
              deleteNode(state.path, child.name); render();
              notify('File Explorer', `"${child.name}" moved to Recycle Bin`, I.recycle);
            }
          } },
          '-',
          { label: 'Properties', icon: I.info, action: () => msgDialog(`${child.name} Properties`,
            `Type: ${child.type === 'folder' ? 'File folder' : child.kind === 'img' ? 'SVG image' : 'Text document'}<br>
             Location: ${addressOf(state.path)}<br>
             Size: ${child.type === 'file' ? `${(child.content.length / 1024).toFixed(1)} KB` : '—'}<br>
             Created: ${new Date(child.created).toLocaleString()}`) },
        ]);
      });
      files.appendChild(el);
    }
  }

  async function confirm(title, msg) {
    return (await import('../ui.js')).confirmDialog(title, msg, 'Delete', 'Cancel');
  }

  files.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.exp-item')) return;
    e.preventDefault();
    contextMenu(e.clientX, e.clientY, [
      { label: 'New folder', icon: I.plus, action: () => root.querySelector('.a-newfolder').click() },
      { label: 'New text document', icon: I.txt, action: () => root.querySelector('.a-newtxt').click() },
      '-',
      { label: 'Refresh', icon: I.refresh, action: render },
      { label: 'Empty Recycle Bin', icon: I.recycle, action: () => { import('./recycle.js').then(r => r.open()); } },
    ]);
  });

  files.addEventListener('click', (e) => {
    if (e.target === files) {
      files.querySelectorAll('.exp-item.selected').forEach(x => x.classList.remove('selected'));
      state.selected = null; renderStatus();
    }
  });

  function renderStatus() {
    const node = state.atThisPC ? null : getNode(state.path);
    const n = node ? (node.children || []).length : QUICK.length + 1;
    status.textContent = `${n} items` + (state.selected ? '  |  1 item selected' : '');
  }

  function render() {
    backBtn.disabled = !state.history.length;
    fwdBtn.disabled = !state.future.length;
    renderSide();
    renderCrumbs();
    renderFiles();
    side.querySelectorAll('.side-item').forEach(el => el.classList.remove('sel'));
  }

  render();
  return win;
}
