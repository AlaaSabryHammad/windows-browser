/* Virtual file system "C:" — persisted in localStorage. */

const FS_KEY = 'webwin-fs-v1';
const BIN_KEY = 'webwin-bin-v1';

let idc = Date.now() % 100000;
export const uid = () => `n${idc++}${Math.floor(Math.random() * 9999)}`;

const ART = {
  aurora: `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04101f"/><stop offset="1" stop-color="#0a2d4a"/></linearGradient><filter id="b" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="26"/></filter></defs><rect width="900" height="560" fill="url(#s)"/><g filter="url(#b)"><path d="M80 420 C 260 180 420 260 560 120 S 800 40 900 60 L 900 200 C 700 220 520 300 340 460 Z" fill="#19e68c" opacity=".45"/><path d="M-20 480 C 220 300 480 340 700 160 S 860 60 940 90 L 940 240 C 700 280 420 380 140 560 Z" fill="#00bcd4" opacity=".4"/></g><circle cx="120" cy="90" r="2.2" fill="#fff" opacity=".9"/><circle cx="320" cy="60" r="1.6" fill="#fff" opacity=".7"/><circle cx="540" cy="100" r="1.8" fill="#fff" opacity=".8"/><circle cx="760" cy="50" r="1.4" fill="#fff" opacity=".6"/><circle cx="840" cy="120" r="2" fill="#fff" opacity=".75"/></svg>`,
  waves: `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a237e"/><stop offset="1" stop-color="#0277bd"/></linearGradient></defs><rect width="900" height="560" fill="url(#g)"/><path d="M0 300 C 150 240 300 360 450 300 S 750 240 900 300 V560 H0 Z" fill="#4fc3f7" opacity=".35"/><path d="M0 380 C 150 320 300 440 450 380 S 750 320 900 380 V560 H0 Z" fill="#29b6f6" opacity=".45"/><path d="M0 460 C 150 400 300 520 450 460 S 750 400 900 460 V560 H0 Z" fill="#0288d1" opacity=".8"/><circle cx="720" cy="120" r="46" fill="#fff59d" opacity=".95"/></svg>`,
  retro: `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b0f54"/><stop offset=".6" stop-color="#ab1f6a"/><stop offset="1" stop-color="#ff6e40"/></linearGradient></defs><rect width="900" height="560" fill="url(#s)"/><circle cx="450" cy="330" r="130" fill="#ffd180"/><circle cx="450" cy="330" r="104" fill="#ffe082"/><g stroke="#2b0f54" stroke-width="10"><path d="M320 330 H580"/><path d="M450 200 V460"/><path d="M358 238 L542 422"/><path d="M358 422 L542 238"/></g><rect x="0" y="430" width="900" height="130" fill="#1a0b35"/><path d="M0 430 H900" stroke="#ff9e80" stroke-width="6"/></svg>`
};

function imgFile(name, svg) {
  return { id: uid(), name, type: 'file', kind: 'img', content: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, created: Date.now() };
}
function txtFile(name, content) {
  return { id: uid(), name, type: 'file', kind: 'txt', content, created: Date.now() };
}
function folder(name, children = []) {
  return { id: uid(), name, type: 'folder', children, created: Date.now() };
}

function seed() {
  return folder('C:', [
    folder('Program Files', []),
    folder('Windows', []),
    folder('Users', [
      folder('User', [
        folder('Desktop', [
          txtFile('Read Me.txt', 'Welcome to Windows 10 Web!\r\n\r\nThis whole desktop runs in your browser.\r\n\r\nThings to try:\r\n  * Open the Start menu (bottom-left)\r\n  * Double-click icons on the desktop\r\n  * Right-click the desktop for options\r\n  * Drag windows to screen edges to snap them\r\n  * Change wallpaper & colors in Settings\r\n  * Play Minesweeper\r\n  * Type "help" in Command Prompt\r\n\r\nEverything you create is saved in your browser.')
        ]),
        folder('Documents', [
          txtFile('Welcome.txt', 'Hi Alaa!\r\n\r\nThis is a tiny virtual file system. Files you save from Notepad land here.\r\nThey stay saved even after you close the tab (localStorage).'),
          txtFile('Ideas.txt', '- Learn JavaScript modules\r\n- Build an OS in the browser (done!)\r\n- Take a break ☕')
        ]),
        folder('Downloads', [
          txtFile('todo.txt', '[x] Boot Windows in a browser\r\n[ ] Conquer the world')
        ]),
        folder('Pictures', [imgFile('Aurora.svg', ART.aurora), imgFile('Waves.svg', ART.waves), imgFile('Retro.svg', ART.retro)]),
        folder('Music', []),
        folder('Videos', [])
      ])
    ])
  ]);
}

export const HOME = ['Users', 'User'];

let FS;
let BIN = [];

function save() {
  try {
    localStorage.setItem(FS_KEY, JSON.stringify(FS));
    localStorage.setItem(BIN_KEY, JSON.stringify(BIN));
  } catch { /* ignore quota errors */ }
}
export const saveFS = save;

export function initFS() {
  try {
    const raw = localStorage.getItem(FS_KEY);
    if (raw) { FS = JSON.parse(raw); BIN = JSON.parse(localStorage.getItem(BIN_KEY) || '[]'); return; }
  } catch { /* corrupted -> reseed */ }
  FS = seed(); BIN = []; save();
}

export function resetFS() { FS = seed(); BIN = []; save(); }

export const ROOT = () => FS;

/* path: array of names starting below C:, e.g. ['Users','User','Documents'] */
export function getNode(path) {
  let node = FS;
  for (const seg of path) {
    if (!node.children) return null;
    node = node.children.find(c => c.name === seg);
    if (!node) return null;
  }
  return node;
}

export function parentOf(path) { return getNode(path.slice(0, -1)); }

export function addressOf(path) {
  return 'C:\\' + path.join('\\');
}

export function pathOfNode(node) {
  // search for node path by id
  const result = [];
  function walk(n, trail) {
    if (n.id === node.id) { result.push(...trail); return true; }
    if (n.children) for (const c of n.children) if (walk(c, [...trail, c.name])) return true;
    return false;
  }
  walk(FS, []);
  return result;
}

export function uniqueName(dirPath, base) {
  const dir = getNode(dirPath);
  if (!dir.children || !dir.children.some(c => c.name === base)) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let i = 2;
  while (dir.children.some(c => c.name === `${stem} (${i})${ext}`)) i++;
  return `${stem} (${i})${ext}`;
}

export function addNode(dirPath, node) {
  const dir = getNode(dirPath);
  if (!dir || dir.type !== 'folder') return null;
  node.name = uniqueName(dirPath, node.name);
  dir.children.push(node);
  save();
  return node;
}

/* Move to recycle bin. Returns true on success. */
export function deleteNode(dirPath, name) {
  const dir = getNode(dirPath);
  if (!dir || !dir.children) return false;
  const idx = dir.children.findIndex(c => c.name === name);
  if (idx === -1) return false;
  const [removed] = dir.children.splice(idx, 1);
  BIN.push({ node: removed, from: [...dirPath], deletedAt: Date.now() });
  save();
  return true;
}

export function getBin() { return BIN; }

export function restoreFromBin(i) {
  const item = BIN[i];
  if (!item) return;
  const dir = getNode(item.from) || getNode(HOME);
  item.node.name = uniqueName(pathOfNodeSafe(dir), item.node.name);
  dir.children.push(item.node);
  BIN.splice(i, 1);
  save();
}

function pathOfNodeSafe(node) { return pathOfNode(node); }

export function removeFromBin(i) { BIN.splice(i, 1); save(); }
export function emptyBin() { BIN = []; save(); }

export function renameNode(dirPath, oldName, newName) {
  const dir = getNode(dirPath);
  if (!dir) return false;
  const node = dir.children.find(c => c.name === oldName);
  if (!node || !newName || dir.children.some(c => c !== node && c.name === newName)) return false;
  node.name = newName;
  save();
  return true;
}

export function fileIcon(node) {
  if (node.type === 'folder') return null; // caller uses folder icon
  if (node.kind === 'img') return 'img';
  return 'txt';
}

export function makeFile(name, kind, content) { return { id: uid(), name, type: 'file', kind, content, created: Date.now() }; }
export function makeFolder(name) { return { id: uid(), name, type: 'folder', children: [], created: Date.now() }; }
