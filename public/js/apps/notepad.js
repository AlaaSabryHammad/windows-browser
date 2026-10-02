/* Notepad — open/save anywhere, find & replace, go to, word wrap, zoom, status bar, unsaved-changes prompt, print. */
import { createWindow } from '../wm.js';
import { getNode, canonical, writeFile, KNOWN, onFSChange, kindOf } from '../fs.js';
import { contextMenu, promptDialog, msgDialog, dialog, esc, notify } from '../ui.js';
import { fileDialog } from '../filedialog.js';
import { dragKind, currentDrag } from '../fileops.js';
import { I } from '../icons.js';
import { launch } from './registry.js';

const PREFS_KEY = 'webwin-notepad-v1';
const loadPrefs = () => { try { return { wrap: true, status: true, font: 13, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { wrap: true, status: true, font: 13 }; } };

export function open(arg = null) {
  const prefs = loadPrefs();
  const state = {
    path: null,          /* canonical path or null (unsaved) */
    dirty: false,
    zoom: 100,
    wrap: prefs.wrap,
    status: prefs.status,
    font: prefs.font,
    lastFind: '',
    matchCase: false,
  };
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ wrap: state.wrap, status: state.status, font: state.font })); } catch { /* ignore */ } };

  const win = createWindow({ title: 'Untitled - Notepad', icon: I.notepad, appId: 'notepad', w: 640, h: 460, minW: 360, minH: 240 });
  win.body.innerHTML = `
    <div class="notepad">
      <div class="np-menu">
        <div class="np-m" data-m="file">File</div>
        <div class="np-m" data-m="edit">Edit</div>
        <div class="np-m" data-m="format">Format</div>
        <div class="np-m" data-m="view">View</div>
        <div class="np-m" data-m="help">Help</div>
      </div>
      <div class="np-find hidden">
        <input class="nf-find" placeholder="Find" spellcheck="false">
        <input class="nf-repl" placeholder="Replace with" spellcheck="false">
        <button class="btn nf-next">Find next</button>
        <button class="btn nf-prev">Previous</button>
        <button class="btn nf-one">Replace</button>
        <button class="btn nf-all">Replace all</button>
        <label class="nf-case"><input type="checkbox"> Match case</label>
        <button class="toolbar-btn nf-x" title="Close">${I.x}</button>
      </div>
      <textarea class="selectable" spellcheck="false"></textarea>
      <div class="np-status">
        <span class="ln">Ln 1, Col 1</span>
        <span class="zoom">100%</span>
        <span>Windows (CRLF)</span>
        <span>UTF-8</span>
      </div>
    </div>`;

  const root = win.body.querySelector('.notepad');
  const ta = root.querySelector('textarea');
  const lnEl = root.querySelector('.ln');
  const zoomEl = root.querySelector('.zoom');
  const findBar = root.querySelector('.np-find');
  const fInput = findBar.querySelector('.nf-find'), rInput = findBar.querySelector('.nf-repl');

  const fileName = () => state.path ? state.path[state.path.length - 1] : 'Untitled';
  function refreshTitle() { win.setTitle(`${state.dirty ? '*' : ''}${fileName()} - Notepad`); }
  function setDirty(v) { if (state.dirty !== v) { state.dirty = v; refreshTitle(); } }

  function load(path) {
    const node = path && getNode(path);
    if (!node) { state.path = null; ta.value = ''; }
    else if (node.content && node.content.startsWith('data:') && kindOf(node) !== 'txt') {
      state.path = canonical(path);
      ta.value = '[This is a binary file — Notepad can only show text.]';
    } else {
      state.path = canonical(path);
      ta.value = (node.content || '').replace(/\r\n/g, '\n');
    }
    state.dirty = false;
    refreshTitle();
    ta.setSelectionRange(0, 0);
    ta.scrollTop = 0;
    updateCaret();
  }

  function applyView() {
    ta.classList.toggle('wrap', state.wrap);
    root.querySelector('.np-status').classList.toggle('hidden', !state.status);
    ta.style.fontSize = `${(state.font * state.zoom / 100).toFixed(1)}px`;
    zoomEl.textContent = `${state.zoom}%`;
  }

  function updateCaret() {
    const upto = ta.value.slice(0, ta.selectionStart);
    const lines = upto.split('\n');
    lnEl.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
  }
  ['keyup', 'click', 'select'].forEach(ev => ta.addEventListener(ev, updateCaret));
  ta.addEventListener('input', () => { setDirty(true); updateCaret(); });

  /* ---------- save / open ---------- */
  async function save(as = false) {
    let path = state.path;
    if (!path || as) {
      path = await fileDialog({
        mode: 'save', title: 'Save As', startDir: state.path ? state.path.slice(0, -1) : KNOWN.documents,
        defaultName: state.path ? fileName() : 'Untitled.txt', defaultExt: 'txt', filterLabel: 'Text Documents (*.txt)',
      });
      if (!path) return false;
    }
    writeFile(path, ta.value.replace(/\r?\n/g, '\r\n'), 'txt');
    state.path = canonical(path);
    state.dirty = false;
    refreshTitle();
    return true;
  }

  /* "Do you want to save changes…?" — resolves true when it's OK to continue */
  async function confirmDiscard() {
    if (!state.dirty) return true;
    win.focus();
    const where = state.path ? state.path.join('\\') : 'Untitled';
    const choice = await dialog({
      title: 'Notepad',
      bodyHTML: `<div class="np-save-q">Do you want to save changes to ${esc(where === 'Untitled' ? 'Untitled' : 'C:\\' + where)}?</div>`,
      buttons: [{ label: 'Save', primary: true, value: 'save' }, { label: "Don't Save", value: 'discard' }, { label: 'Cancel', value: 'cancel' }],
      cancelValue: 'cancel',
    });
    if (choice === 'save') return save(false);
    return choice === 'discard';
  }
  win.beforeClose(confirmDiscard);

  async function openFile() {
    if (!(await confirmDiscard())) return;
    const path = await fileDialog({ mode: 'open', title: 'Open', startDir: state.path ? state.path.slice(0, -1) : KNOWN.documents, kinds: ['txt', 'html', 'other'], filterLabel: 'Text Documents (*.txt)' });
    if (path) load(path);
  }
  async function newFile() {
    if (!(await confirmDiscard())) return;
    load(null);
  }

  function print() {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(fr);
    fr.contentDocument.write(`<title>${esc(fileName())}</title><pre style="font:12pt Consolas,monospace;white-space:pre-wrap">${esc(ta.value)}</pre>`);
    fr.contentDocument.close();
    setTimeout(() => { fr.contentWindow.print(); setTimeout(() => fr.remove(), 1000); }, 100);
  }

  /* ---------- find / replace ---------- */
  function showFind(replace) {
    findBar.classList.remove('hidden');
    findBar.classList.toggle('with-replace', replace);
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (sel && !sel.includes('\n')) fInput.value = sel;
    fInput.focus(); fInput.select();
  }
  function findNext(back = false) {
    const needle = fInput.value || state.lastFind;
    if (!needle) { showFind(false); return false; }
    state.lastFind = needle;
    state.matchCase = findBar.querySelector('.nf-case input').checked;
    const hay = state.matchCase ? ta.value : ta.value.toLowerCase();
    const n = state.matchCase ? needle : needle.toLowerCase();
    let i = back ? hay.lastIndexOf(n, ta.selectionStart - 1) : hay.indexOf(n, ta.selectionEnd);
    if (i < 0) i = back ? hay.lastIndexOf(n) : hay.indexOf(n);   /* wrap around */
    if (i < 0) { msgDialog('Notepad', `Cannot find "${esc(needle)}"`, 'info'); return false; }
    ta.focus();
    ta.setSelectionRange(i, i + needle.length);
    /* scroll the selection into view */
    const before = ta.value.slice(0, i).split('\n').length;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    ta.scrollTop = Math.max(0, (before - 3) * lh);
    updateCaret();
    return true;
  }
  function replaceOne() {
    const needle = fInput.value;
    if (!needle) return;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    const same = state.matchCase ? sel === needle : sel.toLowerCase() === needle.toLowerCase();
    if (same) { ta.setRangeText(rInput.value, ta.selectionStart, ta.selectionEnd, 'end'); setDirty(true); }
    findNext();
  }
  function replaceAll() {
    const needle = fInput.value;
    if (!needle) return;
    const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), findBar.querySelector('.nf-case input').checked ? 'g' : 'gi');
    const count = (ta.value.match(re) || []).length;
    if (!count) { msgDialog('Notepad', `Cannot find "${esc(needle)}"`, 'info'); return; }
    ta.value = ta.value.replace(re, rInput.value);
    setDirty(true);
  }
  findBar.querySelector('.nf-next').addEventListener('click', () => findNext());
  findBar.querySelector('.nf-prev').addEventListener('click', () => findNext(true));
  findBar.querySelector('.nf-one').addEventListener('click', replaceOne);
  findBar.querySelector('.nf-all').addEventListener('click', replaceAll);
  findBar.querySelector('.nf-x').addEventListener('click', () => { findBar.classList.add('hidden'); ta.focus(); });
  fInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey); } if (e.key === 'Escape') { findBar.classList.add('hidden'); ta.focus(); } });
  rInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } if (e.key === 'Escape') { findBar.classList.add('hidden'); ta.focus(); } });

  async function goTo() {
    const total = ta.value.split('\n').length;
    const v = await promptDialog('Go To Line', 'Line number:', String(ta.value.slice(0, ta.selectionStart).split('\n').length), '', {
      validate: (x) => (/^\d+$/.test(x) && +x >= 1 && +x <= total ? null : 'The line number is beyond the total number of lines'),
    });
    if (!v) return;
    const lines = ta.value.split('\n');
    const pos = lines.slice(0, +v - 1).reduce((a, l) => a + l.length + 1, 0);
    ta.focus(); ta.setSelectionRange(pos, pos);
    updateCaret();
  }

  function insertAtCursor(text) {
    ta.focus();
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    setDirty(true);
    updateCaret();
  }
  function setZoom(z) { state.zoom = Math.max(10, Math.min(500, z)); applyView(); }

  /* ---------- menus ---------- */
  const menus = () => ({
    file: [
      { label: 'New', hint: 'Ctrl+N', action: newFile },
      { label: 'New Window', hint: 'Ctrl+Shift+N', action: () => launch('notepad') },
      { label: 'Open…', hint: 'Ctrl+O', icon: I.open, action: openFile },
      { label: 'Save', hint: 'Ctrl+S', icon: I.save, action: () => save(false) },
      { label: 'Save As…', hint: 'Ctrl+Shift+S', action: () => save(true) },
      '-',
      { label: 'Print…', hint: 'Ctrl+P', action: print },
      '-',
      { label: 'Exit', action: () => win.close() },
    ],
    edit: [
      { label: 'Undo', hint: 'Ctrl+Z', icon: I.undo, action: () => { ta.focus(); document.execCommand('undo'); } },
      '-',
      { label: 'Cut', hint: 'Ctrl+X', icon: I.cut, action: () => { ta.focus(); document.execCommand('cut'); } },
      { label: 'Copy', hint: 'Ctrl+C', icon: I.copy, action: () => { ta.focus(); document.execCommand('copy'); } },
      { label: 'Paste', hint: 'Ctrl+V', icon: I.paste, action: async () => { try { insertAtCursor(await navigator.clipboard.readText()); } catch { ta.focus(); } } },
      { label: 'Delete', hint: 'Del', action: () => insertAtCursor('') },
      '-',
      { label: 'Search with Bing…', hint: 'Ctrl+E', action: () => { const s = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim(); if (s) launch('edge', { url: 'https://www.bing.com/search?q=' + encodeURIComponent(s) }); } },
      { label: 'Find…', hint: 'Ctrl+F', icon: I.search, action: () => showFind(false) },
      { label: 'Find Next', hint: 'F3', action: () => findNext() },
      { label: 'Find Previous', hint: 'Shift+F3', action: () => findNext(true) },
      { label: 'Replace…', hint: 'Ctrl+H', action: () => showFind(true) },
      { label: 'Go To…', hint: 'Ctrl+G', action: goTo },
      '-',
      { label: 'Select All', hint: 'Ctrl+A', action: () => { ta.focus(); ta.select(); } },
      { label: 'Time/Date', hint: 'F5', icon: I.clock, action: () => insertAtCursor(new Date().toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'numeric', day: 'numeric', year: 'numeric' })) },
    ],
    format: [
      { label: 'Word Wrap', checked: state.wrap, action: () => { state.wrap = !state.wrap; savePrefs(); applyView(); } },
      { label: 'Font size', submenu: [10, 11, 12, 13, 14, 16, 18, 20, 24].map(sz => ({ label: `${sz} px`, checked: state.font === sz, action: () => { state.font = sz; savePrefs(); applyView(); } })) },
    ],
    view: [
      { label: 'Zoom', submenu: [
        { label: 'Zoom In', hint: 'Ctrl+Plus', action: () => setZoom(state.zoom + 10) },
        { label: 'Zoom Out', hint: 'Ctrl+Minus', action: () => setZoom(state.zoom - 10) },
        { label: 'Restore Default Zoom', hint: 'Ctrl+0', action: () => setZoom(100) },
      ] },
      { label: 'Status Bar', checked: state.status, action: () => { state.status = !state.status; savePrefs(); applyView(); } },
    ],
    help: [
      { label: 'View Help', action: () => launch('edge', { url: 'https://www.bing.com/search?q=get+help+with+notepad+in+windows' }) },
      '-',
      { label: 'About Notepad', icon: I.info, action: () => msgDialog('About Notepad', 'Windows 10 Web — Notepad<br>Version 10.0 (Web)<br><br>Files are saved in the virtual file system of this PC.', 'info') },
    ],
  });

  root.querySelectorAll('.np-m').forEach(m => {
    m.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = m.getBoundingClientRect();
      contextMenu(r.left, r.bottom + 2, menus()[m.dataset.m]);
    });
  });

  ta.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 's') { e.preventDefault(); save(e.shiftKey); }
    else if (ctrl && k === 'o') { e.preventDefault(); openFile(); }
    else if (ctrl && k === 'n') { e.preventDefault(); e.shiftKey ? launch('notepad') : newFile(); }
    else if (ctrl && k === 'p') { e.preventDefault(); print(); }
    else if (ctrl && k === 'f') { e.preventDefault(); showFind(false); }
    else if (ctrl && k === 'h') { e.preventDefault(); showFind(true); }
    else if (ctrl && k === 'g') { e.preventDefault(); goTo(); }
    else if (e.key === 'F3') { e.preventDefault(); findNext(e.shiftKey); }
    else if (e.key === 'F5') { e.preventDefault(); insertAtCursor(new Date().toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'numeric', day: 'numeric', year: 'numeric' })); }
    else if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); setZoom(state.zoom + 10); }
    else if (ctrl && k === '-') { e.preventDefault(); setZoom(state.zoom - 10); }
    else if (ctrl && k === '0') { e.preventDefault(); setZoom(100); }
    else if (e.key === 'Tab') { e.preventDefault(); insertAtCursor('\t'); }
  });
  ta.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(state.zoom + (e.deltaY < 0 ? 10 : -10)); } }, { passive: false });

  /* drop a text file from Explorer / desktop / your PC onto Notepad to open it */
  ta.addEventListener('dragover', (e) => { if (dragKind(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  ta.addEventListener('drop', async (e) => {
    const kind = dragKind(e);
    if (!kind) return;
    e.preventDefault();
    if (!(await confirmDiscard())) return;
    if (kind === 'internal') {
      const p = currentDrag();
      if (p && p.names.length) load([...p.dir, p.names[0]]);
    } else if (e.dataTransfer.files[0]) {
      const f = e.dataTransfer.files[0];
      ta.value = await f.text();
      state.path = null; state.dirty = true; refreshTitle();
      notify('Notepad', `Opened ${f.name} from your PC. Use Save As to keep it.`, I.notepad, { silent: true });
    }
  });

  /* if the file is renamed/moved/deleted elsewhere, keep up */
  let nodeId = null;
  const offFS = onFSChange(() => {
    if (!state.path) return;
    const node = getNode(state.path);
    if (node) { nodeId = node.id; return; }
    import('../fs.js').then(({ walk, ROOT }) => {
      let found = null;
      walk((n, p) => { if (n.id === nodeId) { found = p; return false; } return true; }, ROOT());
      if (found) { state.path = found; refreshTitle(); }
    });
  });
  win.onclose(offFS);

  win.onRelaunch = (a) => { if (a && a.path) load(a.path); };

  applyView();
  load(arg && arg.path ? arg.path : null);
  nodeId = state.path ? getNode(state.path)?.id : null;
  setTimeout(() => ta.focus(), 60);
  return win;
}
