/* Notepad */
import { createWindow } from '../wm.js';
import { getNode, addNode, HOME, makeFile } from '../fs.js';
import { contextMenu, promptDialog, msgDialog, confirmDialog } from '../ui.js';
import { I } from '../icons.js';

export function open(arg = null) {
  /* single existing path or a fresh doc */
  const state = {
    path: arg && arg.path ? arg.path : null,   // array path or null (unsaved)
    dirty: false,
    zoom: 100,
    wrap: true,
  };

  const win = createWindow({ title: 'Untitled - Notepad', icon: I.notepad, appId: 'notepad', w: 620, h: 440, minW: 360, minH: 240 });
  win.body.innerHTML = `
    <div class="notepad">
      <div class="np-menu">
        <div class="np-m" data-m="file">File</div>
        <div class="np-m" data-m="edit">Edit</div>
        <div class="np-m" data-m="format">Format</div>
        <div class="np-m" data-m="view">View</div>
        <div class="np-m" data-m="help">Help</div>
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

  function currentTitle() {
    const name = state.path ? state.path[state.path.length - 1] : 'Untitled';
    return `${state.dirty ? '*' : ''}${name} - Notepad`;
  }
  function refreshTitle() { win.setTitle(currentTitle()); }

  function loadPath() {
    if (state.path) {
      const node = getNode(state.path);
      if (node) { ta.value = node.content || ''; }
      else { state.path = null; }
    } else {
      ta.value = '';
    }
    refreshTitle();
  }

  loadPath();

  function updateCaret() {
    const upto = ta.value.slice(0, ta.selectionStart);
    const lines = upto.split('\n');
    lnEl.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
  }
  ta.addEventListener('keyup', updateCaret);
  ta.addEventListener('click', updateCaret);
  ta.addEventListener('input', () => { if (!state.dirty) { state.dirty = true; refreshTitle(); } });

  async function save(as = false) {
    if (!state.path || as) {
      const name = await promptDialog('Save As', 'File name:', state.path ? state.path[state.path.length - 1] : 'Untitled.txt');
      if (!name) return;
      const fname = name.endsWith('.txt') ? name : name + '.txt';
      addNode([...HOME, 'Documents'], makeFile(fname, 'txt', ta.value));
      state.path = [...HOME, 'Documents', fname];
    } else {
      const node = getNode(state.path);
      if (node) node.content = ta.value;
      else { save(true); return; }
    }
    /* persist */
    const { saveFS } = await import('../fs.js');
    saveFS();
    state.dirty = false;
    refreshTitle();
    const { notify } = await import('../ui.js');
    notify('Notepad', `Saved to ${state.path ? state.path.join('\\') : ''}`, I.notepad);
  }

  const menus = {
    file: [
      { label: 'New', icon: I.file, action: () => { ta.value = ''; state.path = null; state.dirty = false; refreshTitle(); } },
      { label: 'Open…', icon: I.open, action: () => openFile() },
      { label: 'Save', icon: I.save, action: () => save(false) },
      { label: 'Save As…', icon: I.save, action: () => save(true) },
      '-',
      { label: 'Exit', action: () => win.close() },
    ],
    edit: [
      { label: 'Cut', icon: I.copy, action: () => { ta.focus(); document.execCommand('cut'); } },
      { label: 'Copy', icon: I.copy, action: () => { ta.focus(); document.execCommand('copy'); } },
      { label: 'Paste', icon: I.copy, action: async () => {
          ta.focus();
          try { const txt = await navigator.clipboard.readText(); insertAtCursor(txt); } catch {}
        } },
      '-',
      { label: 'Select All', action: () => { ta.focus(); ta.select(); } },
      { label: 'Time/Date', icon: I.clock, action: () => insertAtCursor(new Date().toLocaleString()) },
    ],
    format: [
      { label: 'Word Wrap', checked: state.wrap, action: () => toggleWrap() },
    ],
    view: [
      { label: 'Zoom In', action: () => setZoom(state.zoom + 10) },
      { label: 'Zoom Out', action: () => setZoom(state.zoom - 10) },
      { label: 'Restore Default Zoom', action: () => setZoom(100) },
    ],
    help: [
      { label: 'About Notepad', icon: I.info, action: () => msgDialog('About Notepad',
        'Windows 10 Web — Notepad<br>The little editor that could.<br><br>Files are saved to Documents in the virtual file system.') },
    ],
  };

  function insertAtCursor(text) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + text.length;
    if (!state.dirty) { state.dirty = true; refreshTitle(); }
    ta.focus();
  }
  function toggleWrap() {
    state.wrap = !state.wrap;
    ta.classList.toggle('wrap', state.wrap);
  }
  function setZoom(z) {
    state.zoom = Math.max(30, Math.min(500, z));
    ta.style.fontSize = `${(13 * state.zoom / 100).toFixed(1)}px`;
    zoomEl.textContent = `${state.zoom}%`;
  }
  ta.classList.add('wrap');

  root.querySelectorAll('.np-m').forEach(m => {
    m.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = m.getBoundingClientRect();
      contextMenu(r.left, r.bottom + 2, menus[m.dataset.m]);
    });
  });

  async function openFile() {
    if (state.dirty && !(await confirmDialog('Notepad', 'You have unsaved changes. Continue?', 'Continue', 'Cancel'))) return;
    /* gather all txt files */
    const { getNode: gn, ROOT } = await import('../fs.js');
    const filesFound = [];
    (function walk(node, trail) {
      for (const c of node.children || []) {
        if (c.type === 'folder') walk(c, [...trail, c.name]);
        else if (c.kind === 'txt') filesFound.push({ node: c, path: [...trail, c.name] });
      }
    })(ROOT(), []);
    if (!filesFound.length) { msgDialog('Notepad', 'No text documents found.'); return; }

    const choice = await filePicker(filesFound);
    if (choice) { state.path = choice; state.dirty = false; loadPath(); updateCaret(); }
  }

  function filePicker(filesFound) {
    return new Promise((resolve) => {
      const layer = document.getElementById('dialog-layer');
      layer.classList.remove('hidden');
      layer.innerHTML = '';
      const dlg = document.createElement('div');
      dlg.className = 'dlg';
      dlg.innerHTML = `<div class="dlg-title">Open</div><div class="dlg-body file-list" style="padding:8px"></div>`;
      const list = dlg.querySelector('.dlg-body');
      for (const f of filesFound) {
        const item = document.createElement('div');
        item.className = 'fitem';
        item.innerHTML = `<span class="fi-icon">${I.txt}</span><span>${f.path[f.path.length - 1]}</span><span class="fi-path">C:\\${f.path.slice(0, -1).join('\\')}</span>`;
        item.addEventListener('click', () => { cleanup(); resolve(f.path); });
        list.appendChild(item);
      }
      const onOuter = (e) => { if (e.target === layer) { cleanup(); resolve(null); } };
      function cleanup() {
        layer.classList.add('hidden');
        layer.innerHTML = '';
        layer.removeEventListener('pointerdown', onOuter);
      }
      layer.addEventListener('pointerdown', onOuter);
      layer.appendChild(dlg);
    });
  }

  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
  });

  setTimeout(() => ta.focus(), 60);
  return win;
}
