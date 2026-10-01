/* Photos — image viewer for the Pictures library */
import { createWindow } from '../wm.js';
import { getNode, HOME, pathOfNode, saveFS } from '../fs.js';
import { I } from '../icons.js';

function collectImages() {
  const dir = getNode([...HOME, 'Pictures']);
  if (!dir || !dir.children) return [];
  return dir.children.filter(c => c.kind === 'img' || /\.(png|jpe?g|gif|svg)$/i.test(c.name));
}

export function open(arg = null) {
  const win = createWindow({ title: 'Photos', icon: I.photos, appId: 'photos', w: 780, h: 540 });
  win.body.innerHTML = `
    <div class="photos">
      <div class="photos-stage"></div>
      <div class="photos-bar">
        <span class="pname"></span>
        <button class="pbtn p-prev" title="Previous">${I.chevLeft.replace('<svg', '<svg width="16" height="16"')}</button>
        <button class="pbtn p-out" title="Zoom out">−</button>
        <button class="pbtn p-fit" title="Fit">Fit</button>
        <button class="pbtn p-in" title="Zoom in">+</button>
        <button class="pbtn p-next" title="Next">${I.chevRight.replace('<svg', '<svg width="16" height="16"')}</button>
        <span class="pcount"></span>
      </div>
    </div>`;

  const root = win.body.querySelector('.photos');
  const stage = root.querySelector('.photos-stage');
  const nameEl = root.querySelector('.pname');
  const countEl = root.querySelector('.pcount');

  let images = collectImages();
  let idx = 0;
  let zoom = 1;

  if (arg && arg.path) {
    const node = getNode(arg.path);
    if (node) {
      images = collectImages();
      const i = images.findIndex(im => im.id === node.id);
      if (i >= 0) idx = i;
    }
  }

  function render() {
    if (!images.length) {
      stage.innerHTML = `<div class="photos-empty">No pictures found. Draw something in Paint and save it!</div>`;
      nameEl.textContent = '';
      countEl.textContent = '';
      return;
    }
    const img = images[idx];
    zoom = 1;
    stage.innerHTML = `<img src="${img.content}" alt="${img.name}">`;
    nameEl.textContent = img.name;
    countEl.textContent = `${idx + 1} / ${images.length}`;
    win.setTitle(`${img.name} - Photos`);
  }

  const nav = (d) => { if (!images.length) return; idx = (idx + d + images.length) % images.length; render(); };
  root.querySelector('.p-prev').addEventListener('click', () => nav(-1));
  root.querySelector('.p-next').addEventListener('click', () => nav(1));
  root.querySelector('.p-in').addEventListener('click', () => { zoom = Math.min(4, zoom * 1.25); applyZoom(); });
  root.querySelector('.p-out').addEventListener('click', () => { zoom = Math.max(0.25, zoom / 1.25); applyZoom(); });
  root.querySelector('.p-fit').addEventListener('click', () => { zoom = 1; applyZoom(); });
  function applyZoom() {
    const im = stage.querySelector('img');
    if (im) im.style.transform = `scale(${zoom})`;
  }

  const onKey = (e) => {
    if (document.querySelector('.window.active') !== win.el) return;
    if (e.key === 'ArrowLeft') nav(-1);
    if (e.key === 'ArrowRight') nav(1);
  };
  document.addEventListener('keydown', onKey);
  win.onclose(() => document.removeEventListener('keydown', onKey));

  render();
  return win;
}
