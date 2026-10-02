/* Shared file operations: open/open-with, clipboard, delete, rename, drag & drop, import/export, properties. */
import {
  getNode, canonical, kindOf, typeLabel, sizeOf, formatSize, countItems, addressOf, addNode, makeFile, makeFolder,
  uniqueName, deleteNode, destroyNode, renameNode, moveNode, copyNode, pathEquals, kindFromName, KNOWN, extOf,
} from './fs.js';
import { launch } from './apps/registry.js';
import { I } from './icons.js';
import { esc, msgDialog, dialog, notify, confirmDialog } from './ui.js';
import { updateSettings } from './settings.js';

/* ---------------- icons ---------------- */
const KIND_ICONS = { folder: 'folder', txt: 'txt', img: 'imgfile', audio: 'musicfile', video: 'videofile', pdf: 'pdffile', html: 'htmlfile', doc: 'wordfile', sheet: 'sheetfile', other: 'file' };
export function iconFor(node) { return I[KIND_ICONS[kindOf(node)]] || I.file; }
export function iconHTML(node, thumbs = true) {
  if (thumbs && kindOf(node) === 'img' && node.content) return `<img src="${esc(node.content)}" alt="" loading="lazy" draggable="false">`;
  return iconFor(node);
}

/* ---------------- opening ---------------- */
const OPENERS = { folder: 'explorer', txt: 'notepad', img: 'photos', audio: 'mediaplayer', video: 'mediaplayer', html: 'edge', pdf: 'edge', doc: 'word', sheet: 'excel' };
const APP_NAMES = { notepad: 'Notepad', photos: 'Photos', mediaplayer: 'Media Player', edge: 'Microsoft Edge', paint: 'Paint', word: 'Word', excel: 'Excel' };

export function openPath(path, appId = null) {
  const node = getNode(path);
  if (!node) { msgDialog('Location is not available', `Windows can't find '${esc(addressOf(path))}'. Make sure you typed the name correctly, and then try again.`, 'error'); return; }
  const p = canonical(path);
  const kind = kindOf(node);
  const app = appId || OPENERS[kind];
  if (!app) { openWithDialog(p); return; }
  if (app === 'paint') launch('paint', { path: p });
  else launch(app, { path: p });
}

function openWithApps(node) {
  const k = kindOf(node);
  const apps = ['notepad'];
  if (k === 'doc') apps.unshift('word');
  if (k === 'sheet') apps.unshift('excel');
  if (k === 'txt' || k === 'html') apps.push('word');
  if (k === 'img') apps.unshift('photos', 'paint');
  if (k === 'audio' || k === 'video') apps.unshift('mediaplayer');
  if (k === 'html' || k === 'pdf' || k === 'img' || k === 'txt') apps.push('edge');
  if (k === 'doc' || (k === 'sheet' && !/^(csv|tsv)$/.test(extOf(node.name)))) return [...new Set(apps.filter(a => a !== 'notepad'))];
  return [...new Set(apps)];
}

export async function openWithDialog(path) {
  const node = getNode(path);
  if (!node) return;
  const apps = openWithApps(node);
  const body = `<div style="margin-bottom:10px">How do you want to open <b>${esc(node.name)}</b>?</div>` +
    apps.map((a, i) => `<label class="wradio"><input type="radio" name="ow" value="${a}" ${i === 0 ? 'checked' : ''}><span>${APP_NAMES[a]}</span></label>`).join('');
  lastOpenWith = apps[0];
  const res = await dialog({ title: 'Open with', bodyHTML: body, buttons: [{ label: 'OK', primary: true, value: 'ok' }, { label: 'Cancel', value: null }] });
  if (res === 'ok') openPath(path, lastOpenWith);
}
let lastOpenWith = null;
document.addEventListener('change', (e) => { if (e.target.name === 'ow') lastOpenWith = e.target.value; });

export function openWithMenu(path) {
  const node = getNode(path);
  if (!node || node.type === 'folder') return null;
  return openWithApps(node).map(a => ({ label: APP_NAMES[a], action: () => openPath(path, a) }));
}

export function setWallpaper(path) {
  updateSettings({ wallpaper: 'picture', wallpaperPath: canonical(path) });
}

/* ---------------- clipboard ---------------- */
let clip = null;     /* { mode: 'copy'|'cut', dir, names } */
const clipListeners = new Set();
export function onClipboardChange(cb) { clipListeners.add(cb); return () => clipListeners.delete(cb); }
export function setClipboard(mode, dir, names) {
  clip = { mode, dir: [...dir], names: [...names] };
  clipListeners.forEach(cb => cb());
}
export const clipboardHas = () => !!clip && clip.names.some(n => getNode([...clip.dir, n]));
export const isCut = (dir, name) => !!clip && clip.mode === 'cut' && pathEquals(clip.dir, dir) && clip.names.includes(name);

/* returns the names created in dir */
export function pasteInto(dir) {
  if (!clip) return [];
  const out = [];
  for (const name of clip.names) {
    if (!getNode([...clip.dir, name])) continue;
    const res = clip.mode === 'cut' ? moveNode(clip.dir, name, dir) : copyNode(clip.dir, name, dir);
    if (res === 'into-self') { msgDialog('Interrupted Action', 'The destination folder is a subfolder of the source folder.', 'error'); break; }
    if (res && typeof res === 'object') out.push(res.name);
  }
  if (clip.mode === 'cut') { clip = null; clipListeners.forEach(cb => cb()); }
  return out;
}

/* ---------------- delete / rename / new ---------------- */
export async function deleteItems(dir, names, { permanent = false } = {}) {
  names = names.filter(n => getNode([...dir, n]));
  if (!names.length) return false;
  if (permanent) {
    const what = names.length === 1 ? `this ${getNode([...dir, names[0]]).type === 'folder' ? 'folder' : 'file'}` : `these ${names.length} items`;
    const ok = await confirmDialog(names.length === 1 ? 'Delete File' : 'Delete Multiple Items', `Are you sure you want to permanently delete ${what}?`, 'Yes', 'No', 'warn');
    if (!ok) return false;
    names.forEach(n => destroyNode(dir, n));
  } else {
    names.forEach(n => deleteNode(dir, n));
  }
  return true;
}

export function renameWithFeedback(dir, oldName, newName) {
  if (newName == null || newName === oldName) return true;
  const node = getNode([...dir, oldName]);
  /* keep the extension if the user dropped it while renaming a file, like Explorer warns */
  const res = renameNode(dir, oldName, newName);
  if (res === true) return true;
  if (res === 'invalid') msgDialog('Rename', 'A file name can\'t contain any of the following characters:<br><b style="font-size:15px">\\ / : * ? " &lt; &gt; |</b>', 'error');
  else if (res === 'exists') msgDialog('Rename', `There is already a ${node && node.type === 'folder' ? 'folder' : 'file'} with the same name in this location.`, 'warn');
  return false;
}

export function newFolder(dir) { return addNode(dir, makeFolder(uniqueName(dir, 'New folder'))); }
export function newTextFile(dir) { return addNode(dir, makeFile(uniqueName(dir, 'New Text Document.txt'), 'txt', '')); }

/* real, valid empty Office files (they open in Microsoft Office too) */
export async function newOfficeFile(dir, type) {
  if (type === 'word') {
    const { htmlToDocx } = await import('./office/docx.js');
    const { toDataURL } = await import('./office/zip.js');
    const div = document.createElement('div');
    div.innerHTML = '<p></p>';
    const data = toDataURL(htmlToDocx(div), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    return addNode(dir, makeFile(uniqueName(dir, 'New Microsoft Word Document.docx'), 'doc', data));
  }
  const { writeXlsx } = await import('./office/xlsx.js');
  const { Book } = await import('./office/formula.js');
  const { toDataURL } = await import('./office/zip.js');
  const data = toDataURL(writeXlsx(new Book()), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return addNode(dir, makeFile(uniqueName(dir, 'New Microsoft Excel Worksheet.xlsx'), 'sheet', data));
}

/* ---------------- import from / export to the real PC ---------------- */
const readAs = (file, how) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  if (how === 'text') r.readAsText(file); else r.readAsDataURL(file);
});

async function importFile(dir, file) {
  const kind = kindFromName(file.name);
  const asText = (kind === 'txt' || kind === 'html' || /\.(csv|tsv)$/i.test(file.name)) && file.size < 20 * 1024 * 1024;
  const content = await readAs(file, asText ? 'text' : 'data');
  const node = makeFile(file.name, kind === 'other' && !asText ? 'other' : kind, content);
  if (file.lastModified) node.modified = file.lastModified;
  return addNode(dir, node);
}

/* FileList / File[] */
export async function importFiles(dir, files) {
  const list = [...files];
  if (!list.length) return [];
  const big = list.filter(f => f.size > 200 * 1024 * 1024);
  if (big.length) msgDialog('File too large', `${esc(big[0].name)} is too large for this PC (the limit is 200 MB per file).`, 'warn');
  const out = [];
  for (const f of list) {
    if (f.size > 200 * 1024 * 1024) continue;
    try { const n = await importFile(dir, f); if (n) out.push(n.name); } catch (e) { console.warn(e); }
  }
  if (out.length) notify('File Explorer', `Copied ${out.length} item${out.length === 1 ? '' : 's'} to ${addressOf(dir)}`, I.folder, { silent: true });
  return out;
}

/* DataTransfer from the host OS: supports dropped folders too */
export async function importDataTransfer(dir, dt) {
  const entries = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return importFiles(dir, dt.files);
  const out = [];
  async function walkEntry(entry, into) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      const n = await importFile(into, file);
      return n;
    }
    const folderNode = addNode(into, makeFolder(entry.name));
    const sub = [...into, folderNode.name];
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const e of batch) await walkEntry(e, sub);
    } while (batch.length);
    return folderNode;
  }
  for (const e of entries) {
    try { const n = await walkEntry(e, dir); if (n) out.push(n.name); } catch (err) { console.warn(err); }
  }
  if (out.length) notify('File Explorer', `Copied ${out.length} item${out.length === 1 ? '' : 's'} to ${addressOf(dir)}`, I.folder, { silent: true });
  return out;
}

export function pickAndImport(dir, accept = '') {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    if (accept) inp.accept = accept;
    inp.style.display = 'none';
    inp.addEventListener('change', async () => { resolve(await importFiles(dir, inp.files)); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

export function nodeBlob(node) {
  const c = node.content || '';
  if (c.startsWith('data:')) {
    const comma = c.indexOf(',');
    const meta = c.slice(5, comma);
    const mime = meta.split(';')[0] || 'application/octet-stream';
    if (meta.endsWith(';base64')) {
      const bin = atob(c.slice(comma + 1));
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    }
    return new Blob([decodeURIComponent(c.slice(comma + 1))], { type: mime });
  }
  const mime = kindOf(node) === 'html' ? 'text/html' : 'text/plain';
  return new Blob([c], { type: mime + ';charset=utf-8' });
}

export function downloadNode(node) {
  if (!node || node.type !== 'file') return;
  const url = URL.createObjectURL(nodeBlob(node));
  const a = document.createElement('a');
  a.href = url; a.download = node.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ---------------- drag & drop ---------------- */
export const DND_TYPE = 'application/x-webwin-items';
let dragPayload = null;

export function startDrag(e, dir, names) {
  dragPayload = { dir: [...dir], names: [...names] };
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData(DND_TYPE, JSON.stringify(dragPayload));
  e.dataTransfer.setData('text/plain', names.map(n => addressOf([...dir, n])).join('\n'));
  /* Chrome: dragging a single file out of the browser saves it on the real PC */
  if (names.length === 1) {
    const node = getNode([...dir, names[0]]);
    if (node && node.type === 'file') {
      try {
        const blob = nodeBlob(node);
        const url = URL.createObjectURL(blob);
        e.dataTransfer.setData('DownloadURL', `${blob.type || 'application/octet-stream'}:${node.name}:${url}`);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch { /* ignore */ }
    }
  }
}
document.addEventListener('dragend', () => { setTimeout(() => { dragPayload = null; }, 0); });

export function dragKind(e) {
  const types = [...(e.dataTransfer?.types || [])];
  if (types.includes(DND_TYPE)) return 'internal';
  if (types.includes('Files')) return 'files';
  return null;
}
export const currentDrag = () => dragPayload;

/* Drop onto a folder. Ctrl = copy (default move), like Explorer on the same drive. Returns new names. */
export async function handleDrop(e, targetDir) {
  e.preventDefault();
  const kind = dragKind(e);
  if (kind === 'files') return importDataTransfer(targetDir, e.dataTransfer);
  if (kind !== 'internal') return [];
  let payload = dragPayload;
  if (!payload) { try { payload = JSON.parse(e.dataTransfer.getData(DND_TYPE)); } catch { return []; } }
  dragPayload = null;
  const copy = e.ctrlKey || e.altKey;
  if (!copy && pathEquals(payload.dir, targetDir)) return [];
  const out = [];
  for (const name of payload.names) {
    if (!copy && pathEquals([...payload.dir, name], targetDir)) continue;
    const res = copy ? copyNode(payload.dir, name, targetDir) : moveNode(payload.dir, name, targetDir);
    if (res === 'into-self') { msgDialog('Interrupted Action', 'The destination folder is a subfolder of the source folder.', 'error'); break; }
    if (res && typeof res === 'object') out.push(res.name);
  }
  return out;
}

export function dropOnBin(e) {
  e.preventDefault();
  let payload = dragPayload;
  if (!payload) { try { payload = JSON.parse(e.dataTransfer.getData(DND_TYPE)); } catch { return; } }
  dragPayload = null;
  if (payload) deleteItems(payload.dir, payload.names);
}

/* ---------------- properties ---------------- */
export function showProperties(path) {
  const node = getNode(path);
  if (!node) return;
  const isFolder = node.type === 'folder';
  const size = sizeOf(node);
  const counts = isFolder ? countItems(node) : null;
  const fmt = (t) => new Date(t).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  const loc = path.length > 1 ? addressOf(path.slice(0, -1)) : 'C:\\';
  const body = `
    <div class="props">
      <div class="props-head"><span class="props-icon">${iconHTML(node)}</span><span class="props-name selectable">${esc(node.name)}</span></div>
      <table class="props-table">
        <tr><td>Type of file:</td><td>${esc(typeLabel(node))}</td></tr>
        ${isFolder ? '' : `<tr><td>Opens with:</td><td>${APP_NAMES[OPENERS[kindOf(node)]] || 'Pick an app'}</td></tr>`}
        <tr><td>Location:</td><td class="selectable">${esc(loc)}</td></tr>
        <tr><td>Size:</td><td>${formatSize(size)} (${size.toLocaleString()} bytes)</td></tr>
        ${isFolder ? `<tr><td>Contains:</td><td>${counts.files} Files, ${counts.folders} Folders</td></tr>` : ''}
        <tr><td>Created:</td><td>${fmt(node.created)}</td></tr>
        <tr><td>Modified:</td><td>${fmt(node.modified || node.created)}</td></tr>
      </table>
    </div>`;
  dialog({ title: `${node.name} Properties`, bodyHTML: body, cancelValue: true });
}

/* ---------------- standard context menu for selected items ---------------- */
export function itemMenu(dir, names, { onRename, onOpen } = {}) {
  const first = getNode([...dir, names[0]]);
  if (!first) return [];
  const single = names.length === 1;
  const path = [...dir, first.name];
  const isImg = single && kindOf(first) === 'img';
  const items = [
    { label: 'Open', bold: true, icon: I.open, action: () => (onOpen ? onOpen() : names.forEach(n => openPath([...dir, n]))) },
  ];
  if (single && first.type === 'file') items.push({ label: 'Open with', submenu: openWithMenu(path) });
  if (single && first.type === 'folder') items.push({ label: 'Open in Command Prompt', icon: I.terminalSmall, action: () => launch('terminal', { cwd: path }) });
  if (isImg) items.push({ label: 'Set as desktop background', icon: I.wallpaper, action: () => setWallpaper(path) });
  items.push('-');
  const sendTo = [
    { label: 'Desktop (create copy)', icon: I.monitor, action: () => names.forEach(n => copyNode(dir, n, KNOWN.desktop)) },
    { label: 'Documents', icon: I.docStack, action: () => names.forEach(n => copyNode(dir, n, KNOWN.documents)) },
  ];
  if (names.every(n => getNode([...dir, n])?.type === 'file')) {
    sendTo.push({ label: 'Your real PC (download)', icon: I.download, action: () => names.forEach(n => downloadNode(getNode([...dir, n]))) });
  }
  items.push({ label: 'Send to', submenu: sendTo });
  items.push('-',
    { label: 'Cut', icon: I.cut, hint: 'Ctrl+X', action: () => setClipboard('cut', dir, names) },
    { label: 'Copy', icon: I.copy, hint: 'Ctrl+C', action: () => setClipboard('copy', dir, names) },
    '-',
    { label: 'Delete', icon: I.trash, hint: 'Del', action: () => deleteItems(dir, names) },
    { label: 'Rename', icon: I.rename, hint: 'F2', disabled: !single, action: () => onRename && onRename(first.name) },
    '-',
    { label: 'Properties', icon: I.info, disabled: !single, action: () => showProperties(path) });
  return items;
}

