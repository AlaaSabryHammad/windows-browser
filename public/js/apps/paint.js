/* Paint — pencil, brush, eraser, fill, color picker, text, shapes, undo/redo, open/save anywhere, paste images. */
import { createWindow } from '../wm.js';
import { I } from '../icons.js';
import { promptDialog, contextMenu, dialog, esc, msgDialog } from '../ui.js';
import { getNode, canonical, writeFile, KNOWN, extOf } from '../fs.js';
import { fileDialog } from '../filedialog.js';
import { setWallpaper, dragKind, currentDrag } from '../fileops.js';
import { launch } from './registry.js';

const COLORS = ['#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7'];
const TOOLS = [
  ['pencil', 'Pencil', I.pencil], ['brush', 'Brush', I.paint], ['eraser', 'Eraser', I.eraser], ['fill', 'Fill with color', I.bucket],
  ['picker', 'Color picker', I.picker], ['text', 'Text', I.text], ['line', 'Line', I.line], ['rect', 'Rectangle', I.rect], ['ellipse', 'Ellipse', I.ellipse],
];

export function open(arg = null) {
  const win = createWindow({ title: 'Untitled - Paint', icon: I.paint, appId: 'paint', w: 900, h: 620, minW: 560, minH: 400 });
  win.body.innerHTML = `
    <div class="paint">
      <div class="np-menu">
        <div class="np-m" data-m="file">File</div>
        <div class="np-m" data-m="edit">Edit</div>
        <div class="np-m" data-m="image">Image</div>
      </div>
      <div class="paint-ribbon">
        <div class="paint-group">
          <button class="ptool" data-act="undo" title="Undo (Ctrl+Z)">${I.undo}</button>
          <button class="ptool" data-act="redo" title="Redo (Ctrl+Y)">${I.redo}</button>
        </div>
        <div class="paint-group tools">${TOOLS.map(([id, label, icon]) => `<button class="ptool ${id === 'pencil' ? 'sel' : ''}" data-tool="${id}" title="${label}">${icon}</button>`).join('')}</div>
        <div class="paint-group">
          <label class="pfill" title="Fill shapes"><input type="checkbox"> Fill</label>
        </div>
        <div class="paint-group size">
          <span style="font-size:11px">Size</span>
          <input type="range" min="1" max="40" value="4">
          <span class="size-val">4</span>
        </div>
        <div class="paint-group colors">
          <div class="pcur" title="Current color"></div>
          <div class="pcolors"></div>
          <label class="pcustom" title="Edit colors"><input type="color" value="#000000"><span>Edit colors</span></label>
        </div>
      </div>
      <div class="paint-canvas-wrap"><div class="pc-holder"><canvas></canvas></div></div>
      <div class="paint-status"><span class="p-pos">0, 0px</span><span class="p-dim"></span><span class="p-tool">Pencil</span></div>
    </div>`;

  const root = win.body.querySelector('.paint');
  const wrap = root.querySelector('.paint-canvas-wrap');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const statusPos = root.querySelector('.p-pos');
  const statusDim = root.querySelector('.p-dim');
  const statusTool = root.querySelector('.p-tool');
  const curSwatch = root.querySelector('.pcur');
  const customColor = root.querySelector('.pcustom input');

  const st = { tool: 'pencil', color: '#000000', size: 4, fill: false, drawing: false, startX: 0, startY: 0, lastX: 0, lastY: 0, snapshot: null, path: null, dirty: false };
  const undoStack = [], redoStack = [];

  function setSize(w, h, keep = false) {
    const old = keep ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
    canvas.width = w; canvas.height = h;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    if (old) ctx.putImageData(old, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    statusDim.textContent = `${w} × ${h}px`;
  }
  setSize(900, 540);

  const fileName = () => st.path ? st.path[st.path.length - 1] : 'Untitled';
  const refreshTitle = () => win.setTitle(`${st.dirty ? '*' : ''}${fileName()} - Paint`);
  const setDirty = (v) => { if (st.dirty !== v) { st.dirty = v; refreshTitle(); } };

  function pushUndo() {
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.length > 30) undoStack.shift();
    redoStack.length = 0;
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const img = undoStack.pop();
    if (img.width !== canvas.width || img.height !== canvas.height) setSize(img.width, img.height);
    ctx.putImageData(img, 0, 0);
    setDirty(true);
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const img = redoStack.pop();
    if (img.width !== canvas.width || img.height !== canvas.height) setSize(img.width, img.height);
    ctx.putImageData(img, 0, 0);
    setDirty(true);
  }

  /* palette */
  const pal = root.querySelector('.pcolors');
  function setColor(c) {
    st.color = c;
    curSwatch.style.background = c;
    customColor.value = c;
    pal.querySelectorAll('.pcolor').forEach(x => x.classList.toggle('sel', x.dataset.c === c));
  }
  for (const c of COLORS) {
    const cell = document.createElement('div');
    cell.className = 'pcolor';
    cell.dataset.c = c;
    cell.style.background = c;
    if (c === '#ffffff') cell.style.borderColor = '#bbb';
    cell.addEventListener('click', () => setColor(c));
    pal.appendChild(cell);
  }
  customColor.addEventListener('input', () => setColor(customColor.value));
  setColor('#000000');

  function setTool(t) {
    st.tool = t;
    root.querySelectorAll('.ptool[data-tool]').forEach(x => x.classList.toggle('sel', x.dataset.tool === t));
    statusTool.textContent = TOOLS.find(x => x[0] === t)[1];
    canvas.style.cursor = t === 'fill' || t === 'picker' ? 'cell' : t === 'text' ? 'text' : 'crosshair';
  }
  root.querySelectorAll('.ptool[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  root.querySelector('[data-act="undo"]').addEventListener('click', undo);
  root.querySelector('[data-act="redo"]').addEventListener('click', redo);
  root.querySelector('.pfill input').addEventListener('change', (e) => { st.fill = e.target.checked; });

  const sizeInput = root.querySelector('.size input[type="range"]');
  const sizeVal = root.querySelector('.size-val');
  sizeInput.addEventListener('input', () => { st.size = +sizeInput.value; sizeVal.textContent = sizeInput.value; });

  /* ---------- file operations ---------- */
  function loadImage(src, path = null) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = Math.min(2400, img.naturalWidth || 900), h = Math.min(2400, img.naturalHeight || 540);
        setSize(w, h);
        ctx.drawImage(img, 0, 0, w, h);
        undoStack.length = 0; redoStack.length = 0;
        st.path = path ? canonical(path) : null;
        st.dirty = false;
        refreshTitle();
        resolve(true);
      };
      img.onerror = () => { msgDialog('Paint', 'Paint cannot read this file. This is not a valid bitmap file, or its format is not currently supported.', 'error'); resolve(false); };
      img.src = src;
    });
  }

  async function save(as = false) {
    let path = st.path;
    if (path && !/^(png|jpe?g|webp|bmp)$/.test(extOf(path[path.length - 1]))) path = null;   /* e.g. an .svg — save a copy */
    if (!path || as) {
      path = await fileDialog({
        mode: 'save', title: 'Save As', startDir: st.path ? st.path.slice(0, -1) : KNOWN.pictures,
        defaultName: st.path ? fileName().replace(/\.[^.]+$/, '') + '.png' : 'Untitled.png', defaultExt: 'png', filterLabel: 'PNG (*.png)', kinds: ['img'],
      });
      if (!path) return false;
    }
    const ext = extOf(path[path.length - 1]);
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    writeFile(path, canvas.toDataURL(mime, 0.92), 'img');
    st.path = canonical(path);
    st.dirty = false;
    refreshTitle();
    return true;
  }

  async function confirmDiscard() {
    if (!st.dirty) return true;
    win.focus();
    const choice = await dialog({
      title: 'Paint',
      bodyHTML: `Do you want to save changes to ${esc(fileName())}?`,
      buttons: [{ label: 'Save', primary: true, value: 'save' }, { label: "Don't Save", value: 'discard' }, { label: 'Cancel', value: 'cancel' }],
      cancelValue: 'cancel',
    });
    if (choice === 'save') return save(false);
    return choice === 'discard';
  }
  win.beforeClose(confirmDiscard);

  async function openFile() {
    if (!(await confirmDiscard())) return;
    const path = await fileDialog({ mode: 'open', title: 'Open', startDir: KNOWN.pictures, kinds: ['img'], filterLabel: 'All Picture Files' });
    if (path) await loadImage(getNode(path).content, path);
  }
  async function newImage() {
    if (!(await confirmDiscard())) return;
    setSize(900, 540);
    undoStack.length = 0; redoStack.length = 0;
    st.path = null; st.dirty = false; refreshTitle();
  }
  async function resizeCanvas() {
    const v = await promptDialog('Resize canvas', 'New size in pixels (width x height):', `${canvas.width} x ${canvas.height}`, '', {
      validate: (x) => (/^\s*\d{1,4}\s*[x×*,]\s*\d{1,4}\s*$/i.test(x) ? null : 'Use the format 800 x 600'),
    });
    if (!v) return;
    const [w, h] = v.split(/[x×*,]/i).map(n => Math.max(1, Math.min(4000, parseInt(n, 10))));
    pushUndo();
    setSize(w, h, true);
    setDirty(true);
  }
  function flip(horizontal) {
    pushUndo();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    c.getContext('2d').drawImage(canvas, 0, 0);
    ctx.save();
    if (horizontal) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); } else { ctx.translate(0, canvas.height); ctx.scale(1, -1); }
    ctx.drawImage(c, 0, 0);
    ctx.restore();
    setDirty(true);
  }
  function rotate() {
    pushUndo();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    c.getContext('2d').drawImage(canvas, 0, 0);
    setSize(c.height, c.width);
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(c, 0, 0);
    ctx.restore();
    setDirty(true);
  }
  async function asWallpaper() {
    if (!st.path || st.dirty) { const ok = await save(false); if (!ok) return; }
    setWallpaper(st.path);
  }
  function clearAll() { pushUndo(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); setDirty(true); }

  const menus = () => ({
    file: [
      { label: 'New', hint: 'Ctrl+N', action: newImage },
      { label: 'Open…', hint: 'Ctrl+O', icon: I.open, action: openFile },
      { label: 'Save', hint: 'Ctrl+S', icon: I.save, action: () => save(false) },
      { label: 'Save as…', hint: 'F12', action: () => save(true) },
      '-',
      { label: 'Set as desktop background', icon: I.wallpaper, action: asWallpaper },
      { label: 'Open in Photos', icon: I.photos, disabled: !st.path, action: () => launch('photos', { path: st.path }) },
      '-',
      { label: 'Exit', action: () => win.close() },
    ],
    edit: [
      { label: 'Undo', hint: 'Ctrl+Z', icon: I.undo, disabled: !undoStack.length, action: undo },
      { label: 'Redo', hint: 'Ctrl+Y', icon: I.redo, disabled: !redoStack.length, action: redo },
      '-',
      { label: 'Paste', hint: 'Ctrl+V', icon: I.paste, action: pasteFromClipboard },
      { label: 'Clear image', icon: I.trash, action: clearAll },
    ],
    image: [
      { label: 'Resize canvas…', hint: 'Ctrl+W', action: resizeCanvas },
      { label: 'Rotate right 90°', icon: I.rotate, action: rotate },
      { label: 'Flip horizontal', action: () => flip(true) },
      { label: 'Flip vertical', action: () => flip(false) },
    ],
  });
  root.querySelectorAll('.np-m').forEach(m => m.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = m.getBoundingClientRect();
    contextMenu(r.left, r.bottom + 2, menus()[m.dataset.m]);
  }));

  /* ---------- drawing ---------- */
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) * (canvas.width / r.width)), y: Math.round((e.clientY - r.top) * (canvas.height / r.height)) };
  };

  function floodFill(x, y, hex) {
    const { width: w, height: h } = canvas;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const i0 = (y * w + x) * 4;
    const target = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
    const n = parseInt(hex.slice(1), 16);
    const fill = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
    if (target.every((v, i) => v === fill[i])) return;
    const tol = 40;
    const match = (i) => Math.abs(d[i] - target[0]) + Math.abs(d[i + 1] - target[1]) + Math.abs(d[i + 2] - target[2]) + Math.abs(d[i + 3] - target[3]) <= tol;
    const stack = [[x, y]];
    const seen = new Uint8Array(w * h);
    while (stack.length) {
      let [cx, cy] = stack.pop();
      while (cy >= 0 && match((cy * w + cx) * 4) && !seen[cy * w + cx]) cy--;
      cy++;
      let left = false, right = false;
      while (cy < h && match((cy * w + cx) * 4) && !seen[cy * w + cx]) {
        const i = (cy * w + cx) * 4;
        seen[cy * w + cx] = 1;
        d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = 255;
        if (cx > 0) { const l = match(i - 4) && !seen[cy * w + cx - 1]; if (l && !left) { stack.push([cx - 1, cy]); left = true; } else if (!l) left = false; }
        if (cx < w - 1) { const rr = match(i + 4) && !seen[cy * w + cx + 1]; if (rr && !right) { stack.push([cx + 1, cy]); right = true; } else if (!rr) right = false; }
        cy++;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', async (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = pos(e);
    if (st.tool === 'picker') {
      const px = ctx.getImageData(p.x, p.y, 1, 1).data;
      setColor('#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join(''));
      setTool('pencil');
      return;
    }
    if (st.tool === 'fill') { pushUndo(); floodFill(p.x, p.y, st.color); setDirty(true); return; }
    if (st.tool === 'text') {
      const text = await promptDialog('Text', 'Type the text to place on the canvas:', '');
      if (!text) return;
      pushUndo();
      ctx.fillStyle = st.color;
      ctx.font = `${8 + st.size * 3}px "Segoe UI", sans-serif`;
      ctx.textBaseline = 'top';
      text.split('\n').forEach((line, i) => ctx.fillText(line, p.x, p.y + i * (10 + st.size * 3)));
      setDirty(true);
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    pushUndo();
    st.drawing = true;
    st.startX = st.lastX = p.x; st.startY = st.lastY = p.y;
    if (['pencil', 'brush', 'eraser'].includes(st.tool)) {
      ctx.strokeStyle = st.tool === 'eraser' ? '#ffffff' : st.color;
      ctx.lineWidth = st.tool === 'eraser' ? st.size * 3 : st.tool === 'brush' ? st.size * 2.2 : st.size;
      ctx.globalAlpha = st.tool === 'brush' ? 0.55 : 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.01, p.y);
      ctx.stroke();
    } else {
      st.snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    statusPos.textContent = `${Math.max(0, Math.min(canvas.width, p.x))}, ${Math.max(0, Math.min(canvas.height, p.y))}px`;
    if (!st.drawing) return;
    if (['pencil', 'brush', 'eraser'].includes(st.tool)) {
      if (st.tool === 'brush') {
        /* brush: separate short segments so the alpha doesn't stack into a solid line */
        ctx.beginPath(); ctx.moveTo(st.lastX, st.lastY); ctx.lineTo(p.x, p.y); ctx.stroke();
      } else { ctx.lineTo(p.x, p.y); ctx.stroke(); }
      st.lastX = p.x; st.lastY = p.y;
    } else {
      ctx.putImageData(st.snapshot, 0, 0);
      ctx.strokeStyle = st.color;
      ctx.fillStyle = st.color;
      ctx.lineWidth = st.size;
      ctx.beginPath();
      let x2 = p.x, y2 = p.y;
      if (e.shiftKey && st.tool !== 'line') {   /* Shift = square / circle */
        const s = Math.max(Math.abs(x2 - st.startX), Math.abs(y2 - st.startY));
        x2 = st.startX + Math.sign(x2 - st.startX || 1) * s; y2 = st.startY + Math.sign(y2 - st.startY || 1) * s;
      }
      if (st.tool === 'line') { ctx.moveTo(st.startX, st.startY); ctx.lineTo(x2, y2); }
      if (st.tool === 'rect') ctx.rect(Math.min(st.startX, x2), Math.min(st.startY, y2), Math.abs(x2 - st.startX), Math.abs(y2 - st.startY));
      if (st.tool === 'ellipse') ctx.ellipse((st.startX + x2) / 2, (st.startY + y2) / 2, Math.abs(x2 - st.startX) / 2, Math.abs(y2 - st.startY) / 2, 0, 0, Math.PI * 2);
      if (st.fill && st.tool !== 'line') ctx.fill();
      ctx.stroke();
    }
  });

  const end = () => {
    if (!st.drawing) return;
    st.drawing = false;
    ctx.globalAlpha = 1;
    setDirty(true);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { statusPos.textContent = ''; });

  /* ---------- paste images ---------- */
  function pasteBlob(blob) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      pushUndo();
      if (img.width > canvas.width || img.height > canvas.height) setSize(Math.max(canvas.width, Math.min(2400, img.width)), Math.max(canvas.height, Math.min(2400, img.height)), true);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      setDirty(true);
    };
    img.src = url;
  }
  async function pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find(t => t.startsWith('image/'));
        if (type) { pasteBlob(await it.getType(type)); return; }
      }
      msgDialog('Paint', 'There is no image on the clipboard.', 'info');
    } catch { msgDialog('Paint', 'Press Ctrl+V to paste an image from the clipboard.', 'info'); }
  }
  const onPaste = (e) => {
    if (document.querySelector('.window.active') !== win.el) return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); pasteBlob(item.getAsFile()); }
  };
  document.addEventListener('paste', onPaste);

  /* drop an image file (from Explorer or your PC) to open it */
  wrap.addEventListener('dragover', (e) => { if (dragKind(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  wrap.addEventListener('drop', async (e) => {
    const kind = dragKind(e);
    if (!kind) return;
    e.preventDefault();
    if (kind === 'internal') {
      const p = currentDrag();
      const node = p && getNode([...p.dir, p.names[0]]);
      if (node && node.content) { if (await confirmDiscard()) loadImage(node.content, [...p.dir, node.name]); }
    } else if (e.dataTransfer.files[0] && e.dataTransfer.files[0].type.startsWith('image/')) {
      pasteBlob(e.dataTransfer.files[0]);
    }
  });

  const onKey = (e) => {
    if (document.querySelector('.window.active') !== win.el) return;
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 'z') { e.preventDefault(); undo(); }
    else if (ctrl && k === 'y') { e.preventDefault(); redo(); }
    else if (ctrl && k === 's') { e.preventDefault(); save(e.shiftKey); }
    else if (ctrl && k === 'o') { e.preventDefault(); openFile(); }
    else if (ctrl && k === 'n') { e.preventDefault(); newImage(); }
    else if (ctrl && k === 'w') { e.preventDefault(); resizeCanvas(); }
    else if (e.key === 'F12') { e.preventDefault(); save(true); }
  };
  document.addEventListener('keydown', onKey);
  win.onclose(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('paste', onPaste); });

  win.onRelaunch = null;
  if (arg && arg.path) {
    const node = getNode(arg.path);
    if (node && node.content) loadImage(node.content, arg.path);
  }
  refreshTitle();
  return win;
}
