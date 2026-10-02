/* Virtual file system "C:" — kept in memory, persisted to IndexedDB (localStorage fallback).
 *
 * A path is an array of names below C:, e.g. ['Users','User','Documents'].
 * Names are matched case-insensitively, like on Windows.
 * Binary files (images, audio, video…) keep their content as a data: URL; that content is stored
 * in its own IndexedDB record so saving the tree stays cheap.
 */

import { sampleDocx, sampleXlsx } from './office/samples.js';

const LEGACY_FS_KEY = 'webwin-fs-v1';
const LEGACY_BIN_KEY = 'webwin-bin-v1';
const DB_NAME = 'webwin';
const DB_VERSION = 1;

let idc = Date.now() % 100000;
export const uid = () => `n${idc++}${Math.floor(Math.random() * 9999)}`;

const ART = {
  aurora: `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04101f"/><stop offset="1" stop-color="#0a2d4a"/></linearGradient><filter id="b" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="26"/></filter></defs><rect width="900" height="560" fill="url(#s)"/><g filter="url(#b)"><path d="M80 420 C 260 180 420 260 560 120 S 800 40 900 60 L 900 200 C 700 220 520 300 340 460 Z" fill="#19e68c" opacity=".45"/><path d="M-20 480 C 220 300 480 340 700 160 S 860 60 940 90 L 940 240 C 700 280 420 380 140 560 Z" fill="#00bcd4" opacity=".4"/></g><circle cx="120" cy="90" r="2.2" fill="#fff" opacity=".9"/><circle cx="320" cy="60" r="1.6" fill="#fff" opacity=".7"/><circle cx="540" cy="100" r="1.8" fill="#fff" opacity=".8"/><circle cx="760" cy="50" r="1.4" fill="#fff" opacity=".6"/><circle cx="840" cy="120" r="2" fill="#fff" opacity=".75"/></svg>`,
  waves: `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a237e"/><stop offset="1" stop-color="#0277bd"/></linearGradient></defs><rect width="900" height="560" fill="url(#g)"/><path d="M0 300 C 150 240 300 360 450 300 S 750 240 900 300 V560 H0 Z" fill="#4fc3f7" opacity=".35"/><path d="M0 380 C 150 320 300 440 450 380 S 750 320 900 380 V560 H0 Z" fill="#29b6f6" opacity=".45"/><path d="M0 460 C 150 400 300 520 450 460 S 750 400 900 460 V560 H0 Z" fill="#0288d1" opacity=".8"/><circle cx="720" cy="120" r="46" fill="#fff59d" opacity=".95"/></svg>`,
  retro: `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b0f54"/><stop offset=".6" stop-color="#ab1f6a"/><stop offset="1" stop-color="#ff6e40"/></linearGradient></defs><rect width="900" height="560" fill="url(#s)"/><circle cx="450" cy="330" r="130" fill="#ffd180"/><circle cx="450" cy="330" r="104" fill="#ffe082"/><g stroke="#2b0f54" stroke-width="10"><path d="M320 330 H580"/><path d="M450 200 V460"/><path d="M358 238 L542 422"/><path d="M358 422 L542 238"/></g><rect x="0" y="430" width="900" height="130" fill="#1a0b35"/><path d="M0 430 H900" stroke="#ff9e80" stroke-width="6"/></svg>`
};

const now = () => Date.now();
function imgFile(name, svg) {
  return { id: uid(), name, type: 'file', kind: 'img', content: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, created: now(), modified: now() };
}
function txtFile(name, content) {
  return { id: uid(), name, type: 'file', kind: 'txt', content, created: now(), modified: now() };
}
function folder(name, children = []) {
  return { id: uid(), name, type: 'folder', children, created: now(), modified: now() };
}

function officeSamples() {
  try {
    return [
      { id: uid(), name: 'Welcome to Word.docx', type: 'file', kind: 'doc', content: sampleDocx(), created: now(), modified: now() },
      { id: uid(), name: 'Budget.xlsx', type: 'file', kind: 'sheet', content: sampleXlsx(), created: now(), modified: now() },
    ];
  } catch (e) { console.warn('Could not create sample Office files', e); return []; }
}

function seed() {
  return folder('C:', [
    folder('Program Files', [
      folder('Windows NT', [folder('Accessories', [])]),
      folder('Internet Explorer', []),
    ]),
    folder('Windows', [
      folder('System32', [
        txtFile('drivers.ini', '[drivers]\r\nwave=web-audio.drv\r\ntimer=performance.now.drv\r\nvideo=css-compositor.drv\r\n'),
      ]),
      folder('Fonts', []),
      txtFile('win.ini', '; for 16-bit app support\r\n[fonts]\r\n[extensions]\r\n[mci extensions]\r\n[files]\r\n[Mail]\r\nMAPI=1\r\n'),
    ]),
    folder('Users', [
      folder('User', [
        folder('Desktop', [
          txtFile('Read Me.txt', 'Welcome to Windows 10 Web!\r\n\r\nThis whole computer runs in your browser.\r\n\r\nThings to try:\r\n  * Win key (or Ctrl+Esc) opens Start, Win+E opens File Explorer, Win+R opens Run\r\n  * Alt+Tab (or Alt+`) switches windows, Win+Arrows snap them\r\n  * Drag files from your real PC into File Explorer to copy them in\r\n  * Right-click anything\r\n  * Camera, Media Player, Alarms & Clock, Weather, Sticky Notes…\r\n  * Type "help" in Command Prompt\r\n\r\nEverything you create is saved in this browser.')
        ]),
        folder('Documents', [
          txtFile('Welcome.txt', 'Hi!\r\n\r\nThis is your Documents folder. Files you save from Notepad land here by default.\r\nThey stay saved even after you close the tab.'),
          txtFile('Ideas.txt', '- Learn JavaScript modules\r\n- Build an OS in the browser (done!)\r\n- Take a break ☕'),
          ...officeSamples(),
        ]),
        folder('Downloads', [
          txtFile('todo.txt', '[x] Boot Windows in a browser\r\n[ ] Conquer the world')
        ]),
        folder('Pictures', [
          imgFile('Aurora.svg', ART.aurora), imgFile('Waves.svg', ART.waves), imgFile('Retro.svg', ART.retro),
          folder('Camera Roll', []),
          folder('Screenshots', []),
        ]),
        folder('Music', []),
        folder('Videos', [folder('Captures', [])])
      ])
    ])
  ]);
}

export const HOME = ['Users', 'User'];
export const DESKTOP = [...HOME, 'Desktop'];
export const KNOWN = {
  desktop: DESKTOP,
  documents: [...HOME, 'Documents'],
  downloads: [...HOME, 'Downloads'],
  pictures: [...HOME, 'Pictures'],
  music: [...HOME, 'Music'],
  videos: [...HOME, 'Videos'],
};

let FS;
let BIN = [];

/* ---------------- change events ---------------- */
const listeners = new Set();
let emitQueued = false;
export function onFSChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function changed() {
  scheduleSave();
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => { emitQueued = false; listeners.forEach(cb => { try { cb(); } catch (e) { console.error(e); } }); });
}

/* I/O stats for Task Manager's disk graph */
export const ioStats = { bytesWritten: 0, writes: 0 };

/* ---------------- persistence ---------------- */
let db = null;            /* IDBDatabase or null (localStorage fallback) */
const storedData = new Set();   /* ids whose binary content is already in the DB */
const dirtyData = new Set();    /* ids whose content changed since last save */

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no idb'));
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('kv');
      r.result.createObjectStore('data');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('blocked'));
  });
}
const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const isBinary = (n) => n && n.type === 'file' && typeof n.content === 'string' && n.content.startsWith('data:') && n.kind !== 'txt';

/* clone of the tree with binary content removed (stored separately) */
function strip(node, live) {
  if (node.type === 'folder') return { ...node, children: node.children.map(c => strip(c, live)) };
  if (isBinary(node)) { live.push(node); return { ...node, content: null, ext: true }; }
  return { ...node };
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}
export function flushSave() { clearTimeout(saveTimer); return save(); }
window.addEventListener('pagehide', () => flushSave());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

async function save() {
  saveTimer = null;
  if (!FS) return;
  const live = [];
  const tree = strip(FS, live);
  const bin = BIN.map(b => ({ ...b, node: strip(b.node, live) }));

  if (!db) {
    /* fallback: everything inline in localStorage */
    try {
      localStorage.setItem(LEGACY_FS_KEY, JSON.stringify(FS));
      localStorage.setItem(LEGACY_BIN_KEY, JSON.stringify(BIN));
    } catch { /* quota */ }
    return;
  }
  try {
    const tx = db.transaction(['kv', 'data'], 'readwrite');
    const kv = tx.objectStore('kv');
    const data = tx.objectStore('data');
    const json = JSON.stringify(tree);
    kv.put(tree, 'tree');
    kv.put(bin, 'bin');
    ioStats.bytesWritten += json.length;
    ioStats.writes++;
    const liveIds = new Set();
    for (const n of live) {
      liveIds.add(n.id);
      if (!storedData.has(n.id) || dirtyData.has(n.id)) {
        data.put(n.content, n.id);
        storedData.add(n.id);
        ioStats.bytesWritten += n.content.length;
      }
    }
    for (const id of [...storedData]) {
      if (!liveIds.has(id)) { data.delete(id); storedData.delete(id); }
    }
    dirtyData.clear();
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  } catch (e) {
    console.warn('File system save failed', e);
  }
}
export const saveFS = () => changed();

function reattach(node, data) {
  if (node.type === 'folder') node.children.forEach(c => reattach(c, data));
  else if (node.ext) {
    node.content = data.get(node.id) ?? '';
    delete node.ext;
    storedData.add(node.id);
  }
  if (!node.modified) node.modified = node.created || now();
}

export async function initFS() {
  try { db = await openDB(); } catch { db = null; }

  if (db) {
    try {
      const tx = db.transaction(['kv', 'data'], 'readonly');
      const tree = await reqP(tx.objectStore('kv').get('tree'));
      if (tree) {
        const bin = (await reqP(tx.objectStore('kv').get('bin'))) || [];
        const keys = await reqP(tx.objectStore('data').getAllKeys());
        const vals = await reqP(tx.objectStore('data').getAll());
        const data = new Map(keys.map((k, i) => [k, vals[i]]));
        reattach(tree, data);
        bin.forEach(b => reattach(b.node, data));
        FS = tree; BIN = bin;
        return;
      }
    } catch (e) { console.warn('File system load failed, reseeding', e); }
  }

  /* first run, or migrate from the localStorage version */
  try {
    const raw = localStorage.getItem(LEGACY_FS_KEY);
    if (raw) {
      FS = JSON.parse(raw);
      BIN = JSON.parse(localStorage.getItem(LEGACY_BIN_KEY) || '[]');
      reattach(FS, new Map());
      BIN.forEach(b => reattach(b.node, new Map()));
      if (db) {
        await save();
        localStorage.removeItem(LEGACY_FS_KEY);
        localStorage.removeItem(LEGACY_BIN_KEY);
      }
      return;
    }
  } catch { /* corrupted -> reseed */ }

  FS = seed(); BIN = [];
  await save();
}

export async function resetFS() {
  FS = seed(); BIN = [];
  storedData.forEach(id => dirtyData.add(id));
  await save();
  changed();
}

/* wipe everything (factory reset) */
export async function eraseAll() {
  try { localStorage.removeItem(LEGACY_FS_KEY); localStorage.removeItem(LEGACY_BIN_KEY); } catch { /* ignore */ }
  if (db) db.close();
  await new Promise(res => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); });
}

export const ROOT = () => FS;

/* ---------------- lookups ---------------- */
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
function child(dir, name) {
  if (!dir || !dir.children) return null;
  return dir.children.find(c => c.name === name) || dir.children.find(c => same(c.name, name)) || null;
}

export function getNode(path) {
  let node = FS;
  for (const seg of path) {
    node = child(node, seg);
    if (!node) return null;
  }
  return node;
}

/* canonical path (real letter case) for a path that exists */
export function canonical(path) {
  let node = FS;
  const out = [];
  for (const seg of path) {
    node = child(node, seg);
    if (!node) return null;
    out.push(node.name);
  }
  return out;
}

export function parentOf(path) { return getNode(path.slice(0, -1)); }

export function addressOf(path) {
  return 'C:\\' + path.join('\\');
}

/* Parse a Windows-style path relative to cwd. Returns a normalized array (may not exist), or null if invalid. */
export function parsePath(str, cwd = []) {
  if (str == null) return null;
  let s = String(str).trim().replace(/^"(.*)"$/, '$1').replace(/\//g, '\\');
  if (!s) return [...cwd];
  let base;
  const drive = s.match(/^([a-z]):(.*)$/i);
  if (drive) {
    if (drive[1].toLowerCase() !== 'c') return null;
    s = drive[2];
    base = s.startsWith('\\') ? [] : (s ? [...cwd] : []);
  } else if (s.startsWith('\\')) base = [];
  else base = [...cwd];
  for (const part of s.split('\\')) {
    if (!part || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base;
}

export function pathOfNode(node) {
  const result = [];
  function walk(n, trail) {
    if (n.id === node.id) { result.push(...trail); return true; }
    if (n.children) for (const c of n.children) if (walk(c, [...trail, c.name])) return true;
    return false;
  }
  return walk(FS, []) ? result : null;
}

export function walk(cb, start = FS, trail = []) {
  for (const c of start.children || []) {
    const p = [...trail, c.name];
    if (cb(c, p) === false) return false;
    if (c.type === 'folder' && walk(cb, c, p) === false) return false;
  }
  return true;
}

export const pathEquals = (a, b) => a.length === b.length && a.every((s, i) => same(s, b[i]));
export const isInside = (path, ancestor) => path.length >= ancestor.length && ancestor.every((s, i) => same(s, path[i]));

/* ---------------- names & kinds ---------------- */
const BAD = /[\\/:*?"<>|]/;
export function isValidName(name) {
  return !!name && !BAD.test(name) && name.trim() === name && !/^\.+$/.test(name) && name.length <= 200;
}

const EXT_KINDS = {
  txt: ['txt', 'md', 'log', 'ini', 'cfg', 'json', 'js', 'mjs', 'css', 'xml', 'bat', 'cmd', 'ps1', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'ts', 'yml', 'yaml', 'sql', 'sh', 'reg', 'srt'],
  html: ['html', 'htm'],
  img: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'opus', 'weba'],
  video: ['mp4', 'webm', 'ogv', 'mov', 'mkv', 'm4v'],
  pdf: ['pdf'],
  doc: ['docx', 'doc', 'docm', 'odt', 'rtf'],
  sheet: ['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv'],
};
export const extOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
export function kindFromName(name) {
  const ext = extOf(name);
  for (const [k, list] of Object.entries(EXT_KINDS)) if (list.includes(ext)) return k;
  return 'other';
}
export function kindOf(node) {
  if (node.type === 'folder') return 'folder';
  const k = kindFromName(node.name);
  if (k !== 'other') return k;
  return node.kind || 'other';
}
const TYPE_LABELS = {
  folder: 'File folder', txt: 'Text Document', html: 'HTML Document', img: 'Image', audio: 'Audio file',
  video: 'Video file', pdf: 'PDF Document', doc: 'Microsoft Word Document', sheet: 'Microsoft Excel Worksheet', other: 'File',
};
export function typeLabel(node) {
  const k = kindOf(node);
  if (k === 'img') return `${extOf(node.name).toUpperCase() || 'Image'} File`;
  if (k === 'other' && extOf(node.name)) return `${extOf(node.name).toUpperCase()} File`;
  if (k === 'sheet' && /^(csv|tsv)$/.test(extOf(node.name))) return 'Microsoft Excel Comma Separated Values File';
  return TYPE_LABELS[k];
}

export function sizeOf(node) {
  if (node.type === 'folder') return node.children.reduce((a, c) => a + sizeOf(c), 0);
  const c = node.content || '';
  if (c.startsWith('data:')) {
    const comma = c.indexOf(',');
    const meta = c.slice(0, comma);
    const body = c.slice(comma + 1);
    if (meta.endsWith(';base64')) return Math.floor(body.length * 3 / 4) - (body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0);
    try { return decodeURIComponent(body).length; } catch { return body.length; }
  }
  let bytes = 0;
  for (let i = 0; i < c.length; i++) {
    const code = c.charCodeAt(i);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : (code >= 0xd800 && code < 0xdc00) ? (i++, 4) : 3;
  }
  return bytes;
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function countItems(node) {
  let files = 0, folders = 0;
  walk((c) => { if (c.type === 'folder') folders++; else files++; }, node);
  return { files, folders };
}

export function uniqueName(dirPath, base) {
  const dir = getNode(dirPath);
  if (!dir || !dir.children || !child(dir, base)) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let i = 2;
  while (child(dir, `${stem} (${i})${ext}`)) i++;
  return `${stem} (${i})${ext}`;
}

/* ---------------- mutations ---------------- */
export function addNode(dirPath, node) {
  const dir = getNode(dirPath);
  if (!dir || dir.type !== 'folder') return null;
  node.name = uniqueName(dirPath, node.name);
  node.modified = node.modified || now();
  dir.children.push(node);
  dir.modified = now();
  if (isBinary(node)) dirtyData.add(node.id);
  changed();
  return node;
}

/* Move to recycle bin. Returns true on success. */
export function deleteNode(dirPath, name) {
  const dir = getNode(dirPath);
  if (!dir || !dir.children) return false;
  const node = child(dir, name);
  if (!node) return false;
  dir.children.splice(dir.children.indexOf(node), 1);
  dir.modified = now();
  BIN.push({ node, from: canonical(dirPath) || [...dirPath], deletedAt: now() });
  changed();
  return true;
}

/* Delete without the recycle bin. */
export function destroyNode(dirPath, name) {
  const dir = getNode(dirPath);
  const node = child(dir, name);
  if (!node) return false;
  dir.children.splice(dir.children.indexOf(node), 1);
  dir.modified = now();
  changed();
  return true;
}

export function getBin() { return BIN; }

export function restoreFromBin(i) {
  const item = BIN[i];
  if (!item) return null;
  let dirPath = item.from;
  if (!getNode(dirPath)) {
    /* recreate the missing original folders, like Windows does */
    let acc = [];
    for (const seg of item.from) {
      if (!getNode([...acc, seg])) {
        const d = getNode(acc);
        if (!d || d.type !== 'folder') { dirPath = HOME; break; }
        d.children.push(folder(seg));
      }
      acc = [...acc, seg];
    }
  }
  const dir = getNode(dirPath);
  item.node.name = uniqueName(dirPath, item.node.name);
  dir.children.push(item.node);
  BIN.splice(i, 1);
  changed();
  return dirPath;
}

export function restoreAll() { while (BIN.length) restoreFromBin(BIN.length - 1); }
export function removeFromBin(i) { BIN.splice(i, 1); changed(); }
export function emptyBin() { BIN = []; changed(); }

/* returns true, or an error string: 'invalid' | 'exists' | 'missing' */
export function renameNode(dirPath, oldName, newName) {
  const dir = getNode(dirPath);
  if (!dir) return 'missing';
  const node = child(dir, oldName);
  if (!node) return 'missing';
  if (!isValidName(newName)) return 'invalid';
  if (newName === node.name) return true;
  const clash = child(dir, newName);
  if (clash && clash !== node) return 'exists';
  node.name = newName;
  node.modified = now();
  changed();
  return true;
}

/* Move fromDir/name into toDir. Returns the moved node, or an error string. */
export function moveNode(fromDir, name, toDir) {
  const src = getNode(fromDir);
  const node = child(src, name);
  const dst = getNode(toDir);
  if (!node || !dst || dst.type !== 'folder') return 'missing';
  if (pathEquals(fromDir, toDir)) return node;
  if (node.type === 'folder' && isInside(toDir, [...fromDir, node.name])) return 'into-self';
  src.children.splice(src.children.indexOf(node), 1);
  node.name = uniqueName(toDir, node.name);
  dst.children.push(node);
  src.modified = dst.modified = now();
  changed();
  return node;
}

function cloneNode(node) {
  const copy = { ...node, id: uid(), created: now() };
  if (node.type === 'folder') copy.children = node.children.map(cloneNode);
  else if (isBinary(copy)) dirtyData.add(copy.id);
  return copy;
}

/* Copy fromDir/name into toDir ("name - Copy" when copying onto itself). Returns the new node or an error string. */
export function copyNode(fromDir, name, toDir) {
  const node = child(getNode(fromDir), name);
  const dst = getNode(toDir);
  if (!node || !dst || dst.type !== 'folder') return 'missing';
  if (node.type === 'folder' && isInside(toDir, [...fromDir, node.name])) return 'into-self';
  const copy = cloneNode(node);
  if (child(dst, node.name)) {
    const dot = node.type === 'file' ? node.name.lastIndexOf('.') : -1;
    copy.name = dot > 0 ? `${node.name.slice(0, dot)} - Copy${node.name.slice(dot)}` : `${node.name} - Copy`;
  }
  return addNode(toDir, copy);
}

/* Overwrite (or create) a file at path. Returns the node. */
export function writeFile(path, content, kind = null) {
  const existing = getNode(path);
  if (existing && existing.type === 'file') {
    existing.content = content;
    existing.modified = now();
    if (kind) existing.kind = kind;
    if (isBinary(existing)) dirtyData.add(existing.id);
    changed();
    return existing;
  }
  const name = path[path.length - 1];
  return addNode(path.slice(0, -1), makeFile(name, kind || kindFromName(name), content));
}

export function makeFile(name, kind, content) { return { id: uid(), name, type: 'file', kind: kind || kindFromName(name), content, created: now(), modified: now() }; }
export function makeFolder(name) { return { id: uid(), name, type: 'folder', children: [], created: now(), modified: now() }; }

/* real browser storage numbers for "Local Disk (C:)" */
export async function diskInfo() {
  const used = sizeOf(FS) + BIN.reduce((a, b) => a + sizeOf(b.node), 0);
  let quota = 0, browserUsage = 0;
  try {
    const est = await navigator.storage.estimate();
    quota = est.quota || 0;
    browserUsage = est.usage || 0;
  } catch { /* unsupported */ }
  if (!quota) quota = 512 * 1024 ** 3;
  return { used, quota, free: Math.max(0, quota - Math.max(used, browserUsage)), browserUsage };
}

/* ask the browser not to evict our data */
export function requestPersistence() {
  try { navigator.storage?.persist?.(); } catch { /* ignore */ }
}
