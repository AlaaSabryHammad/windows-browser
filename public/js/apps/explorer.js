/* File Explorer */
import { createWindow } from '../wm.js';
import {
  getNode, canonical, parsePath, addressOf, KNOWN, onFSChange, sizeOf, formatSize, typeLabel, kindOf, walk, pathEquals, diskInfo,
} from '../fs.js';
import { contextMenu, esc, msgDialog } from '../ui.js';
import { I } from '../icons.js';
import { launch } from './registry.js';
import { settings, updateSettings, onSettingsChange } from '../settings.js';
import {
  iconHTML, openPath, itemMenu, setClipboard, pasteInto, clipboardHas, isCut, onClipboardChange, deleteItems,
  renameWithFeedback, newFolder, newTextFile, newOfficeFile, startDrag, dragKind, handleDrop, pickAndImport, downloadNode, showProperties,
} from '../fileops.js';

const QUICK = [
  { name: 'Desktop',   path: KNOWN.desktop,   icon: I.monitor },
  { name: 'Downloads', path: KNOWN.downloads, icon: I.download },
  { name: 'Documents', path: KNOWN.documents, icon: I.docStack },
  { name: 'Pictures',  path: KNOWN.pictures,  icon: I.photos },
  { name: 'Music',     path: KNOWN.music,     icon: I.musicfile },
  { name: 'Videos',    path: KNOWN.videos,    icon: I.videofile },
];

const fmtDate = (t) => new Date(t).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function open(arg = null) {
  const startPath = Array.isArray(arg) ? arg : arg && arg.path ? arg.path : null;
  const win = createWindow({ title: 'File Explorer', icon: I.folder, appId: 'explorer', w: 900, h: 560, minW: 480, minH: 300 });
  win.body.innerHTML = `
    <div class="explorer" tabindex="-1">
      <div class="exp-ribbon">
        <button class="rb-btn big" data-a="newfolder">${I.folder}<span>New folder</span></button>
        <button class="rb-btn" data-a="newtxt">${I.txt}<span>New text document</span></button>
        <div class="rb-sep"></div>
        <button class="rb-btn" data-a="cut">${I.cut}<span>Cut</span></button>
        <button class="rb-btn" data-a="copy">${I.copy}<span>Copy</span></button>
        <button class="rb-btn" data-a="paste">${I.paste}<span>Paste</span></button>
        <div class="rb-sep"></div>
        <button class="rb-btn" data-a="delete">${I.trash}<span>Delete</span></button>
        <button class="rb-btn" data-a="rename">${I.rename}<span>Rename</span></button>
        <div class="rb-sep"></div>
        <button class="rb-btn" data-a="upload" title="Copy files from your real PC into this folder">${I.upload}<span>Upload from PC</span></button>
        <button class="rb-btn" data-a="download" title="Save the selected files to your real PC">${I.download}<span>Download</span></button>
        <div class="rb-sep"></div>
        <button class="rb-btn" data-a="view">${I.viewList}<span>View</span></button>
        <button class="rb-btn" data-a="sort">${I.sort}<span>Sort</span></button>
        <button class="rb-btn" data-a="props">${I.info}<span>Properties</span></button>
      </div>
      <div class="exp-toolbar">
        <button class="toolbar-btn t-back" title="Back (Alt+Left)">${I.arrowLeft}</button>
        <button class="toolbar-btn t-fwd" title="Forward (Alt+Right)">${I.arrowRight}</button>
        <button class="toolbar-btn t-up" title="Up (Alt+Up)">${I.arrowUp}</button>
        <div class="exp-addr"><div class="exp-crumbs"></div><input class="exp-addr-input" spellcheck="false"></div>
        <button class="toolbar-btn t-refresh" title="Refresh (F5)">${I.refresh}</button>
        <div class="exp-search-wrap">${I.search}<input class="exp-search" placeholder="Search" spellcheck="false"></div>
      </div>
      <div class="exp-main">
        <div class="exp-side"></div>
        <div class="exp-files"></div>
      </div>
      <div class="exp-status"><span class="st-count"></span><span class="st-sel"></span></div>
    </div>`;

  const root = win.body.querySelector('.explorer');
  const crumbs = root.querySelector('.exp-crumbs');
  const addrBox = root.querySelector('.exp-addr');
  const addrInput = root.querySelector('.exp-addr-input');
  const side = root.querySelector('.exp-side');
  const files = root.querySelector('.exp-files');
  const stCount = root.querySelector('.st-count'), stSel = root.querySelector('.st-sel');
  const searchInput = root.querySelector('.exp-search');
  const backBtn = root.querySelector('.t-back'), fwdBtn = root.querySelector('.t-fwd'), upBtn = root.querySelector('.t-up');

  const state = {
    atThisPC: !startPath,
    path: startPath ? (canonical(startPath) || []) : [],
    history: [], future: [],
    selected: new Set(),
    anchor: null,
    query: '',
    sort: { key: 'name', dir: 1 },
    renaming: null,
  };
  let shown = [];     /* entries currently listed: {node, dir} */
  let pendingRename = null;

  /* ---------- navigation ---------- */
  function navigate(path, isThisPC = false) {
    if (!isThisPC) {
      const node = getNode(path);
      if (!node) { msgDialog('File Explorer', `Windows can't find '${esc(addressOf(path))}'. Check the spelling and try again.`, 'error'); return false; }
      if (node.type !== 'folder') { openPath(path); return true; }
      path = canonical(path);
    }
    state.history.push({ path: state.path, thisPC: state.atThisPC });
    state.future = [];
    go(path, isThisPC);
    return true;
  }
  function go(path, isThisPC) {
    state.path = path; state.atThisPC = isThisPC;
    state.selected.clear(); state.anchor = null;
    state.query = ''; searchInput.value = '';
    render();
  }
  function goBack() {
    if (!state.history.length) return;
    const prev = state.history.pop();
    state.future.push({ path: state.path, thisPC: state.atThisPC });
    go(prev.path, prev.thisPC);
  }
  function goFwd() {
    if (!state.future.length) return;
    const next = state.future.pop();
    state.history.push({ path: state.path, thisPC: state.atThisPC });
    go(next.path, next.thisPC);
  }
  function goUp() {
    if (state.atThisPC) return;
    if (!state.path.length) navigate([], true);
    else navigate(state.path.slice(0, -1));
  }

  backBtn.addEventListener('click', goBack);
  fwdBtn.addEventListener('click', goFwd);
  upBtn.addEventListener('click', goUp);
  root.querySelector('.t-refresh').addEventListener('click', () => render());
  let searchT = null;
  searchInput.addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(() => { state.query = searchInput.value.trim().toLowerCase(); state.selected.clear(); render(); }, 150); });
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { searchInput.value = ''; state.query = ''; render(); } });

  /* editable address bar */
  addrBox.addEventListener('click', (e) => {
    if (e.target.closest('.crumb')) return;
    addrBox.classList.add('editing');
    addrInput.value = state.atThisPC ? 'This PC' : addressOf(state.path);
    addrInput.focus(); addrInput.select();
  });
  addrInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { addrBox.classList.remove('editing'); return; }
    if (e.key !== 'Enter') return;
    const v = addrInput.value.trim();
    addrBox.classList.remove('editing');
    if (/^this pc$/i.test(v)) { navigate([], true); return; }
    if (/^recycle bin$/i.test(v) || /^shell:recyclebinfolder$/i.test(v)) { launch('recycle'); return; }
    if (/^https?:\/\//i.test(v) || /^www\./i.test(v)) { launch('edge', { url: /^www\./i.test(v) ? 'https://' + v : v }); return; }
    const known = { desktop: KNOWN.desktop, documents: KNOWN.documents, downloads: KNOWN.downloads, pictures: KNOWN.pictures, music: KNOWN.music, videos: KNOWN.videos };
    const p = known[v.toLowerCase()] || parsePath(v, state.atThisPC ? [] : state.path);
    if (!p) { msgDialog('File Explorer', `Windows can't find '${esc(v)}'. Check the spelling and try again.`, 'error'); return; }
    navigate(p);
  });
  addrInput.addEventListener('blur', () => addrBox.classList.remove('editing'));

  /* ---------- ribbon ---------- */
  const selNames = () => [...state.selected];
  const curDir = () => state.atThisPC ? null : state.path;
  const actions = {
    newfolder: () => { if (!curDir()) return; const n = newFolder(curDir()); pendingRename = n.name; },
    newtxt: () => { if (!curDir()) return; const n = newTextFile(curDir()); pendingRename = n.name; },
    cut: () => selectionOps('cut'),
    copy: () => selectionOps('copy'),
    paste: () => { if (curDir()) selectNames(pasteInto(curDir())); },
    delete: () => selectionOps('delete'),
    rename: () => { const n = selNames()[0]; if (n) startRename(n); },
    upload: async () => { if (curDir()) selectNames(await pickAndImport(curDir())); },
    download: () => selectedEntries().forEach(e => downloadNode(e.node)),
    view: () => updateSettings({ explorerView: settings.explorerView === 'details' ? 'icons' : 'details' }),
    sort: (btn) => {
      const r = btn.getBoundingClientRect();
      const s = (key, label) => ({ label, checked: state.sort.key === key, action: () => { state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : 1 }; render(); } });
      contextMenu(r.left, r.bottom + 2, [s('name', 'Name'), s('modified', 'Date modified'), s('type', 'Type'), s('size', 'Size')]);
    },
    props: () => {
      const e = selectedEntries()[0];
      if (e) showProperties([...e.dir, e.node.name]);
      else if (curDir()) showProperties(curDir());
    },
  };
  root.querySelectorAll('.rb-btn').forEach(b => b.addEventListener('click', () => actions[b.dataset.a](b)));

  function selectedEntries() { return shown.filter(e => state.selected.has(entryKey(e))); }
  function selectionOps(op) {
    const entries = selectedEntries();
    if (!entries.length) return;
    /* group by folder (search results may span folders) */
    const groups = new Map();
    entries.forEach(e => { const k = e.dir.join('\\'); if (!groups.has(k)) groups.set(k, { dir: e.dir, names: [] }); groups.get(k).names.push(e.node.name); });
    for (const g of groups.values()) {
      if (op === 'delete' || op === 'shiftdelete') deleteItems(g.dir, g.names, { permanent: op === 'shiftdelete' });
      else { setClipboard(op, g.dir, g.names); break; }
    }
  }

  /* ---------- sidebar ---------- */
  function renderSide() {
    const cur = state.atThisPC ? null : state.path;
    side.innerHTML = `<div class="side-title">${I.star}<span>Quick access</span></div>` +
      QUICK.map((q, i) => `<div class="side-item ${cur && pathEquals(cur, q.path) ? 'sel' : ''}" data-q="${i}">${q.icon}<span>${q.name}</span></div>`).join('') +
      `<div class="side-title" style="margin-top:8px">${I.thispc}<span>This PC</span></div>
       <div class="side-item ${state.atThisPC ? 'sel' : ''}" data-pc="1">${I.thispc}<span>This PC</span></div>
       <div class="side-item ${cur && !cur.length ? 'sel' : ''}" data-c="1">${I.drive}<span>Local Disk (C:)</span></div>
       <div class="side-item" data-bin="1">${I.recycle}<span>Recycle Bin</span></div>`;
    side.querySelectorAll('.side-item').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.pc) navigate([], true);
        else if (el.dataset.c) navigate([]);
        else if (el.dataset.bin) launch('recycle');
        else navigate(QUICK[+el.dataset.q].path);
      });
      /* sidebar entries are drop targets */
      el.addEventListener('dragover', (e) => {
        if (!dragKind(e) || el.dataset.pc) return;
        e.preventDefault(); el.classList.add('drop-hint');
        e.dataTransfer.dropEffect = el.dataset.bin ? 'move' : (e.ctrlKey || dragKind(e) === 'files' ? 'copy' : 'move');
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop-hint'));
      el.addEventListener('drop', async (e) => {
        el.classList.remove('drop-hint');
        if (el.dataset.bin) { const { dropOnBin } = await import('../fileops.js'); dropOnBin(e); return; }
        await handleDrop(e, el.dataset.c ? [] : QUICK[+el.dataset.q].path);
      });
    });
  }

  function renderCrumbs() {
    crumbs.innerHTML = '';
    const add = (label, action, icon) => {
      if (crumbs.children.length) { const sep = document.createElement('span'); sep.className = 'crumb-sep'; sep.textContent = '›'; crumbs.appendChild(sep); }
      const c = document.createElement('span');
      c.className = 'crumb';
      c.innerHTML = (icon ? `<span class="crumb-icon">${icon}</span>` : '') + esc(label);
      c.addEventListener('click', action);
      crumbs.appendChild(c);
    };
    add('This PC', () => navigate([], true), I.thispc);
    if (!state.atThisPC) {
      add('Local Disk (C:)', () => navigate([]));
      state.path.forEach((seg, i) => add(seg, () => navigate(state.path.slice(0, i + 1))));
    }
    if (state.query) add(`Search Results`, () => {});
  }

  /* ---------- listing ---------- */
  const entryKey = (e) => [...e.dir, e.node.name].join('\\');

  function listEntries() {
    const node = getNode(state.path);
    if (state.query) {
      const out = [];
      walk((c, p) => { if (c.name.toLowerCase().includes(state.query)) out.push({ node: c, dir: p.slice(0, -1) }); }, node, state.path);
      return out;
    }
    return (node.children || []).map(c => ({ node: c, dir: state.path }));
  }

  function sortEntries(list) {
    const { key, dir } = state.sort;
    const val = (e) => key === 'modified' ? (e.node.modified || 0) : key === 'size' ? (e.node.type === 'file' ? sizeOf(e.node) : -1) : key === 'type' ? typeLabel(e.node) : e.node.name;
    return list.sort((a, b) => {
      if (a.node.type !== b.node.type) return a.node.type === 'folder' ? -1 : 1;
      const va = val(a), vb = val(b);
      const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
      return c * dir;
    });
  }

  async function renderThisPC() {
    shown = [];
    stCount.textContent = `${QUICK.length + 1} items`; stSel.textContent = '';
    win.setTitle('This PC');
    files.className = 'exp-files thispc';
    files.innerHTML = `
      <div class="pc-group">Folders (${QUICK.length})</div>
      <div class="exp-drives">${QUICK.map((q, i) => `<div class="pcard" data-q="${i}">${q.icon}<div><div class="pc-name">${q.name}</div></div></div>`).join('')}</div>
      <div class="pc-group">Devices and drives (1)</div>
      <div class="exp-drives"><div class="pcard drive" data-c="1">${I.drive}<div><div class="pc-name">Local Disk (C:)</div>
        <div class="drive-bar"><div class="fill"></div></div><div class="drive-info">Calculating…</div></div></div></div>`;
    files.querySelectorAll('.pcard').forEach(el => el.addEventListener('dblclick', () => el.dataset.c ? navigate([]) : navigate(QUICK[+el.dataset.q].path)));
    files.querySelectorAll('.pcard').forEach(el => el.addEventListener('click', () => { files.querySelectorAll('.pcard.sel').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); }));
    const d = await diskInfo();
    const info = files.querySelector('.drive .drive-info');
    if (!info) return;
    const usedPct = Math.min(100, Math.max(1, (d.quota - d.free) / d.quota * 100));
    files.querySelector('.drive .fill').style.width = usedPct + '%';
    info.textContent = `${formatSize(d.free)} free of ${formatSize(d.quota)}`;
  }

  function renderFiles() {
    if (state.atThisPC) { renderThisPC(); return; }
    let node = getNode(state.path);
    while (!node && state.path.length) { state.path = state.path.slice(0, -1); node = getNode(state.path); }
    const view = state.query ? 'details' : settings.explorerView;
    win.setTitle(state.query ? `Search Results in ${node.name}` : (state.path.length ? node.name : 'Local Disk (C:)'));
    shown = sortEntries(listEntries());
    const live = new Set(shown.map(entryKey));
    [...state.selected].forEach(k => { if (!live.has(k)) state.selected.delete(k); });

    files.className = `exp-files view-${view}`;
    files.innerHTML = '';
    if (view === 'details') {
      const head = document.createElement('div');
      head.className = 'det-head';
      const cols = [['name', 'Name'], ['modified', 'Date modified'], ['type', 'Type'], ['size', 'Size']];
      if (state.query) cols.splice(1, 0, ['loc', 'Folder']);
      head.innerHTML = cols.map(([k, l]) => `<span data-k="${k}" class="${state.sort.key === k ? 'sorted' : ''}">${l}${state.sort.key === k ? (state.sort.dir > 0 ? ' ˄' : ' ˅') : ''}</span>`).join('');
      head.querySelectorAll('span').forEach(s => s.addEventListener('click', () => {
        if (s.dataset.k === 'loc') return;
        state.sort = { key: s.dataset.k, dir: state.sort.key === s.dataset.k ? -state.sort.dir : 1 };
        render();
      }));
      files.appendChild(head);
    }
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'exp-empty';
      empty.textContent = state.query ? 'No items match your search.' : 'This folder is empty.';
      files.appendChild(empty);
    }
    for (const entry of shown) {
      const child = entry.node;
      const key = entryKey(entry);
      const el = document.createElement('div');
      el.className = 'exp-item' + (state.selected.has(key) ? ' selected' : '') + (isCut(entry.dir, child.name) ? ' cut' : '');
      el.dataset.key = key;
      el.draggable = true;
      const thumb = view === 'icons';
      if (view === 'details') {
        el.innerHTML = `<span class="ei-name-cell"><span class="ei-icon">${iconHTML(child, false)}</span><span class="ei-name">${esc(child.name)}</span></span>` +
          (state.query ? `<span class="ei-col">${esc(addressOf(entry.dir))}</span>` : '') +
          `<span class="ei-col">${fmtDate(child.modified || child.created)}</span><span class="ei-col">${esc(typeLabel(child))}</span>` +
          `<span class="ei-col num">${child.type === 'file' ? formatSize(sizeOf(child)) : ''}</span>`;
      } else {
        el.innerHTML = `<span class="ei-icon ${thumb && kindOf(child) === 'img' ? 'thumb' : ''}">${iconHTML(child, thumb)}</span><span class="ei-name">${esc(child.name)}</span>`;
      }
      el.title = `${child.name}\nType: ${typeLabel(child)}${child.type === 'file' ? `\nSize: ${formatSize(sizeOf(child))}` : ''}\nDate modified: ${fmtDate(child.modified || child.created)}`;

      el.addEventListener('click', (e) => { e.stopPropagation(); clickSelect(key, e); });
      el.addEventListener('dblclick', () => openEntry(entry));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!state.selected.has(key)) clickSelect(key, {});
        const sel = selectedEntries().filter(x => pathEquals(x.dir, entry.dir)).map(x => x.node.name);
        contextMenu(e.clientX, e.clientY, itemMenu(entry.dir, sel.length ? sel : [child.name], {
          onRename: () => startRename(child.name),
          onOpen: () => selectedEntries().forEach(openEntry),
        }));
      });
      el.addEventListener('dragstart', (e) => {
        if (state.renaming) { e.preventDefault(); return; }
        if (!state.selected.has(key)) clickSelect(key, {});
        const names = selectedEntries().filter(x => pathEquals(x.dir, entry.dir)).map(x => x.node.name);
        startDrag(e, entry.dir, names);
      });
      if (child.type === 'folder') {
        el.addEventListener('dragover', (e) => {
          if (!dragKind(e) || state.selected.has(key) && dragKind(e) === 'internal') return;
          e.preventDefault(); e.stopPropagation();
          e.dataTransfer.dropEffect = e.ctrlKey || dragKind(e) === 'files' ? 'copy' : 'move';
          el.classList.add('drop-hint');
        });
        el.addEventListener('dragleave', () => el.classList.remove('drop-hint'));
        el.addEventListener('drop', async (e) => { e.stopPropagation(); el.classList.remove('drop-hint'); await handleDrop(e, [...entry.dir, child.name]); });
      }
      files.appendChild(el);
    }
    renderStatus();
    if (pendingRename) {
      const n = pendingRename; pendingRename = null;
      selectNames([n]);
      startRename(n);
    }
  }

  function renderStatus() {
    if (state.atThisPC) return;
    stCount.textContent = `${shown.length} item${shown.length === 1 ? '' : 's'}`;
    const sel = selectedEntries();
    if (!sel.length) { stSel.textContent = ''; return; }
    const bytes = sel.reduce((a, e) => a + (e.node.type === 'file' ? sizeOf(e.node) : 0), 0);
    stSel.textContent = `${sel.length} item${sel.length === 1 ? '' : 's'} selected` + (sel.every(e => e.node.type === 'file') ? `  ${formatSize(bytes)}` : '');
  }

  function paintSelection() {
    files.querySelectorAll('.exp-item').forEach(el => el.classList.toggle('selected', state.selected.has(el.dataset.key)));
    renderStatus();
    updateRibbon();
  }
  function updateRibbon() {
    root.querySelectorAll('.rb-btn').forEach(b => {
      const a = b.dataset.a;
      const needSel = ['cut', 'copy', 'delete', 'rename', 'download'].includes(a);
      b.disabled = (state.atThisPC && a !== 'view') || (needSel && !state.selected.size) || (a === 'paste' && !clipboardHas()) ||
        (a === 'download' && selectedEntries().some(x => x.node.type === 'folder'));
    });
  }

  function clickSelect(key, e) {
    const keys = shown.map(entryKey);
    if (e.shiftKey && state.anchor) {
      const a = keys.indexOf(state.anchor), b = keys.indexOf(key);
      if (!e.ctrlKey) state.selected.clear();
      keys.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(k => state.selected.add(k));
    } else if (e.ctrlKey) {
      state.selected.has(key) ? state.selected.delete(key) : state.selected.add(key);
      state.anchor = key;
    } else {
      state.selected.clear(); state.selected.add(key); state.anchor = key;
    }
    paintSelection();
  }
  function selectNames(names) {
    if (!names || !names.length || state.atThisPC) return;
    state.selected.clear();
    names.forEach(n => state.selected.add([...state.path, n].join('\\')));
    state.anchor = [...state.selected][0];
    paintSelection();
  }

  function openEntry(entry) {
    if (entry.node.type === 'folder') navigate([...entry.dir, entry.node.name]);
    else openPath([...entry.dir, entry.node.name]);
  }

  /* ---------- inline rename ---------- */
  function startRename(name) {
    const entry = shown.find(e => e.node.name === name && (state.query || pathEquals(e.dir, state.path)));
    if (!entry) return;
    const el = files.querySelector(`.exp-item[data-key="${CSS.escape(entryKey(entry))}"]`);
    if (!el) return;
    state.renaming = name;
    el.draggable = false;
    const label = el.querySelector('.ei-name');
    const input = document.createElement(settings.explorerView === 'details' || state.query ? 'input' : 'textarea');
    input.className = 'ei-edit selectable';
    input.value = name;
    input.spellcheck = false;
    label.replaceWith(input);
    input.focus();
    const dot = entry.node.type === 'file' ? name.lastIndexOf('.') : -1;
    input.setSelectionRange(0, dot > 0 ? dot : name.length);
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      state.renaming = null;
      const v = input.value.replace(/\n/g, '').trim();
      if (commit && v && v !== name && renameWithFeedback(entry.dir, name, v)) {
        state.selected.clear(); state.selected.add([...entry.dir, v].join('\\'));
      }
      render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    ['pointerdown', 'click', 'dblclick'].forEach(t => input.addEventListener(t, (e) => e.stopPropagation()));
  }

  /* ---------- background interactions ---------- */
  files.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.exp-item') || state.atThisPC) return;
    e.preventDefault();
    state.selected.clear(); paintSelection();
    const v = settings.explorerView;
    contextMenu(e.clientX, e.clientY, [
      { label: 'View', submenu: [
        { label: 'Large icons', checked: v === 'icons', action: () => updateSettings({ explorerView: 'icons' }) },
        { label: 'Details', checked: v === 'details', action: () => updateSettings({ explorerView: 'details' }) },
      ] },
      { label: 'Sort by', submenu: [['name', 'Name'], ['modified', 'Date modified'], ['type', 'Type'], ['size', 'Size']].map(([k, l]) => ({
        label: l, checked: state.sort.key === k, action: () => { state.sort = { key: k, dir: 1 }; render(); } })) },
      { label: 'Refresh', icon: I.refresh, hint: 'F5', action: render },
      '-',
      { label: 'Paste', icon: I.paste, hint: 'Ctrl+V', disabled: !clipboardHas(), action: actions.paste },
      '-',
      { label: 'New', submenu: [
        { label: 'Folder', icon: I.folder, action: actions.newfolder },
        { label: 'Text Document', icon: I.txt, action: actions.newtxt },
        { label: 'Microsoft Word Document', icon: I.wordfile, action: async () => { const n = await newOfficeFile(state.path, 'word'); pendingRename = n.name; render(); } },
        { label: 'Microsoft Excel Worksheet', icon: I.sheetfile, action: async () => { const n = await newOfficeFile(state.path, 'excel'); pendingRename = n.name; render(); } },
      ] },
      { label: 'Upload files from your PC…', icon: I.upload, action: actions.upload },
      '-',
      { label: 'Open in Command Prompt', icon: I.terminalSmall, action: () => launch('terminal', { cwd: state.path }) },
      { label: 'Properties', icon: I.info, action: () => showProperties(state.path) },
    ]);
  });

  /* rubber band selection */
  files.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== files || state.atThisPC) return;
    if (!e.ctrlKey) { state.selected.clear(); paintSelection(); }
    const base = new Set(state.selected);
    const box = document.createElement('div');
    box.className = 'exp-band';
    files.appendChild(box);
    const fr = files.getBoundingClientRect();
    const sx = e.clientX - fr.left + files.scrollLeft, sy = e.clientY - fr.top + files.scrollTop;
    files.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const cx = ev.clientX - fr.left + files.scrollLeft, cy = ev.clientY - fr.top + files.scrollTop;
      const x = Math.min(sx, cx), y = Math.min(sy, cy), w = Math.abs(cx - sx), h = Math.abs(cy - sy);
      Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      state.selected = new Set(base);
      files.querySelectorAll('.exp-item').forEach(it => {
        const ix = it.offsetLeft, iy = it.offsetTop;
        if (ix < x + w && ix + it.offsetWidth > x && iy < y + h && iy + it.offsetHeight > y) state.selected.add(it.dataset.key);
      });
      paintSelection();
    };
    const up = () => { box.remove(); files.removeEventListener('pointermove', move); files.removeEventListener('pointerup', up); };
    files.addEventListener('pointermove', move);
    files.addEventListener('pointerup', up);
  });

  /* drop into the current folder */
  files.addEventListener('dragover', (e) => {
    if (!dragKind(e) || state.atThisPC) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey || dragKind(e) === 'files' ? 'copy' : 'move';
    files.classList.add('drop-ok');
  });
  files.addEventListener('dragleave', (e) => { if (e.target === files) files.classList.remove('drop-ok'); });
  files.addEventListener('drop', async (e) => {
    files.classList.remove('drop-ok');
    if (state.atThisPC) return;
    selectNames(await handleDrop(e, state.path));
  });

  /* ---------- keyboard ---------- */
  root.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const k = e.key, lower = k.toLowerCase();
    if (e.altKey && k === 'ArrowLeft') { e.preventDefault(); goBack(); }
    else if (e.altKey && k === 'ArrowRight') { e.preventDefault(); goFwd(); }
    else if ((e.altKey && k === 'ArrowUp') || k === 'Backspace') { e.preventDefault(); k === 'Backspace' ? goBack() : goUp(); }
    else if (k === 'F5') { e.preventDefault(); render(); }
    else if (k === 'F2') { e.preventDefault(); actions.rename(); }
    else if (k === 'Delete') { e.preventDefault(); selectionOps(e.shiftKey ? 'shiftdelete' : 'delete'); }
    else if (k === 'Enter') { e.preventDefault(); selectedEntries().forEach(openEntry); }
    else if (e.ctrlKey && e.shiftKey && lower === 'n') { e.preventDefault(); actions.newfolder(); }
    else if (e.ctrlKey && lower === 'a') { e.preventDefault(); shown.forEach(x => state.selected.add(entryKey(x))); paintSelection(); }
    else if (e.ctrlKey && lower === 'c') { e.preventDefault(); actions.copy(); }
    else if (e.ctrlKey && lower === 'x') { e.preventDefault(); actions.cut(); }
    else if (e.ctrlKey && lower === 'v') { e.preventDefault(); actions.paste(); }
    else if (e.ctrlKey && lower === 'f') { e.preventDefault(); searchInput.focus(); }
    else if (e.ctrlKey && lower === 'l') { e.preventDefault(); addrBox.click(); }
    else if (k.startsWith('Arrow') && shown.length) {
      e.preventDefault();
      const keys = shown.map(entryKey);
      let i = keys.indexOf(state.anchor);
      const perRow = settings.explorerView === 'details' || state.query ? 1 : Math.max(1, Math.floor(files.clientWidth / 98));
      const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -perRow, ArrowDown: perRow }[k];
      i = i < 0 ? 0 : Math.max(0, Math.min(keys.length - 1, i + d));
      clickSelect(keys[i], { shiftKey: e.shiftKey });
      files.querySelector(`.exp-item[data-key="${CSS.escape(keys[i])}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (k.length === 1 && !e.ctrlKey && !e.altKey && shown.length) {
      /* type-ahead: jump to the first item starting with the letter */
      const keys = shown.map(entryKey);
      const start = keys.indexOf(state.anchor) + 1;
      const order = [...shown.slice(start), ...shown.slice(0, start)];
      const hit = order.find(x => x.node.name.toLowerCase().startsWith(lower));
      if (hit) clickSelect(entryKey(hit), {});
    }
  });
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('input, textarea, button, select')) return;
    setTimeout(() => { if (!state.renaming) root.focus({ preventScroll: true }); }, 0);
  });

  function render() {
    backBtn.disabled = !state.history.length;
    fwdBtn.disabled = !state.future.length;
    upBtn.disabled = state.atThisPC;
    root.querySelector('.rb-btn[data-a="view"]').innerHTML = `${settings.explorerView === 'details' ? I.viewIcons : I.viewList}<span>${settings.explorerView === 'details' ? 'Icons' : 'Details'}</span>`;
    renderSide();
    renderCrumbs();
    renderFiles();
    updateRibbon();
  }

  const offFS = onFSChange(() => { if (!state.renaming) render(); });
  const offClip = onClipboardChange(() => { if (!state.renaming) render(); });
  const offSettings = onSettingsChange((s, patch) => { if (patch && 'explorerView' in patch) render(); });
  win.onclose(() => { offFS(); offClip(); offSettings(); });

  render();
  setTimeout(() => root.focus({ preventScroll: true }), 50);
  return win;
}
