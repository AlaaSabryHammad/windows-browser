/* Paint — pencil, shapes, eraser, palette, save to Pictures */
import { createWindow } from '../wm.js';
import { I } from '../icons.js';
import { promptDialog, notify } from '../ui.js';
import { addNode, HOME, makeFile } from '../fs.js';

const COLORS = ['#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7'];

export function open() {
  const win = createWindow({ title: 'Untitled - Paint', icon: I.paint, appId: 'paint', w: 840, h: 580, minW: 560, minH: 400 });
  win.body.innerHTML = `
    <div class="paint">
      <div class="paint-ribbon">
        <div class="paint-group tools">
          <button class="ptool sel" data-tool="pencil" title="Pencil">${I.pencil}</button>
          <button class="ptool" data-tool="line" title="Line">${I.line}</button>
          <button class="ptool" data-tool="rect" title="Rectangle">${I.rect}</button>
          <button class="ptool" data-tool="ellipse" title="Ellipse">${I.ellipse}</button>
          <button class="ptool" data-tool="eraser" title="Eraser">${I.eraser}</button>
        </div>
        <div class="paint-group colors"><div class="pcolors"></div></div>
        <div class="paint-group size">
          <span style="font-size:11px">Size</span>
          <input type="range" min="1" max="30" value="4">
          <span class="size-val">4</span>
        </div>
        <div class="paint-group actions">
          <button class="ptool" data-act="clear" title="Clear">${I.trash}</button>
          <button class="ptool" data-act="save" title="Save to Pictures">${I.save}</button>
        </div>
      </div>
      <div class="paint-canvas-wrap"><canvas></canvas></div>
      <div class="paint-status"><span class="p-pos">0, 0</span><span class="p-tool">Pencil</span></div>
    </div>`;

  const root = win.body.querySelector('.paint');
  const wrap = root.querySelector('.paint-canvas-wrap');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const statusPos = root.querySelector('.p-pos');
  const statusTool = root.querySelector('.p-tool');

  const W = 900, H = 540;
  canvas.width = W; canvas.height = H;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const st = { tool: 'pencil', color: '#000000', size: 4, drawing: false, startX: 0, startY: 0, snapshot: null };

  /* snapshot layer for shape preview */
  const overlay = document.createElement('canvas');
  overlay.width = W; overlay.height = H;

  /* palette */
  const pal = root.querySelector('.pcolors');
  for (const c of COLORS) {
    const cell = document.createElement('div');
    cell.className = 'pcolor' + (c === st.color ? ' sel' : '');
    cell.style.background = c;
    if (c === '#ffffff') cell.style.borderColor = '#bbb';
    cell.addEventListener('click', () => {
      st.color = c;
      pal.querySelectorAll('.pcolor').forEach(x => x.classList.remove('sel'));
      cell.classList.add('sel');
    });
    pal.appendChild(cell);
  }

  root.querySelectorAll('.ptool[data-tool]').forEach(b => b.addEventListener('click', () => {
    st.tool = b.dataset.tool;
    root.querySelectorAll('.ptool[data-tool]').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    statusTool.textContent = b.title;
  }));

  const sizeInput = root.querySelector('input[type="range"]');
  const sizeVal = root.querySelector('.size-val');
  sizeInput.addEventListener('input', () => { st.size = +sizeInput.value; sizeVal.textContent = sizeInput.value; });

  root.querySelector('[data-act="clear"]').addEventListener('click', () => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  });
  root.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const name = await promptDialog('Save to Pictures', 'Picture name:', 'My drawing.svg.png');
    if (!name) return;
    addNode([...HOME, 'Pictures'], makeFile(name.endsWith('.png') ? name : name + '.png', 'img', canvas.toDataURL('image/png')));
    win.setTitle(`${name.endsWith('.png') ? name : name + '.png'} - Paint`);
    notify('Paint', `Saved to Pictures`, I.paint);
  });

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) * (W / r.width)), y: Math.round((e.clientY - r.top) * (H / r.height)) };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    st.drawing = true;
    st.startX = p.x; st.startY = p.y;
    if (st.tool === 'pencil' || st.tool === 'eraser') {
      ctx.strokeStyle = st.tool === 'eraser' ? '#ffffff' : st.color;
      ctx.lineWidth = st.tool === 'eraser' ? st.size * 2 : st.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.01, p.y);
      ctx.stroke();
    } else {
      st.snapshot = ctx.getImageData(0, 0, W, H);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    statusPos.textContent = `${Math.max(0, Math.min(W, p.x))}, ${Math.max(0, Math.min(H, p.y))}`;
    if (!st.drawing) return;
    if (st.tool === 'pencil' || st.tool === 'eraser') {
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else {
      ctx.putImageData(st.snapshot, 0, 0);
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.size;
      ctx.beginPath();
      if (st.tool === 'line') { ctx.moveTo(st.startX, st.startY); ctx.lineTo(p.x, p.y); }
      if (st.tool === 'rect') ctx.rect(Math.min(st.startX, p.x), Math.min(st.startY, p.y), Math.abs(p.x - st.startX), Math.abs(p.y - st.startY));
      if (st.tool === 'ellipse') ctx.ellipse((st.startX + p.x) / 2, (st.startY + p.y) / 2, Math.abs(p.x - st.startX) / 2, Math.abs(p.y - st.startY) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  const end = () => { st.drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  return win;
}
