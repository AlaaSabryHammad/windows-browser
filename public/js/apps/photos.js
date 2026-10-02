/* Photos — image viewer: browses the folder of the opened picture, zoom/pan, rotate, slideshow, delete, set as background. */
import { createWindow } from '../wm.js';
import { getNode, canonical, KNOWN, kindOf, onFSChange, sizeOf, formatSize, addressOf } from '../fs.js';
import { deleteItems, setWallpaper, openPath, downloadNode } from '../fileops.js';
import { contextMenu, esc } from '../ui.js';
import { launch } from './registry.js';
import { I } from '../icons.js';

function collectImages(dir) {
  const node = getNode(dir);
  if (!node || !node.children) return [];
  return node.children.filter(c => c.type === 'file' && kindOf(c) === 'img' && c.content)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function open(arg = null) {
  const win = createWindow({ title: 'Photos', icon: I.photos, appId: 'photos', w: 820, h: 560, minW: 420, minH: 300 });
  win.body.innerHTML = `
    <div class="photos" tabindex="-1">
      <div class="photos-top">
        <span class="pname"></span>
        <div class="ptools">
          <button class="pbtn" data-a="out" title="Zoom out (-)">−</button>
          <button class="pbtn pzoom" data-a="fit" title="Fit (0)">100%</button>
          <button class="pbtn" data-a="in" title="Zoom in (+)">+</button>
          <button class="pbtn" data-a="rotate" title="Rotate (Ctrl+R)">${I.rotate}</button>
          <button class="pbtn" data-a="delete" title="Delete (Del)">${I.trash}</button>
          <button class="pbtn" data-a="edit" title="Edit in Paint">${I.paint}</button>
          <button class="pbtn" data-a="slideshow" title="Slideshow (F5)">${I.slideshow}</button>
          <button class="pbtn" data-a="full" title="Full screen (F11)">${I.fullscreen}</button>
          <button class="pbtn" data-a="more" title="See more">${I.more}</button>
        </div>
      </div>
      <div class="photos-stage">
        <button class="pnav prev" title="Previous">${I.chevLeft}</button>
        <button class="pnav next" title="Next">${I.chevRight}</button>
      </div>
      <div class="photos-info hidden"></div>
      <div class="photos-film"></div>
    </div>`;

  const root = win.body.querySelector('.photos');
  const stage = root.querySelector('.photos-stage');
  const nameEl = root.querySelector('.pname');
  const zoomBtn = root.querySelector('.pzoom');
  const film = root.querySelector('.photos-film');
  const info = root.querySelector('.photos-info');

  let dir = KNOWN.pictures;
  let images = [];
  let idx = 0;
  let zoom = 1, rot = 0, panX = 0, panY = 0;
  let slideshow = null;
  let imgEl = null;

  function setFrom(path) {
    const node = path && getNode(path);
    if (node && node.type === 'file') { dir = canonical(path.slice(0, -1)); images = collectImages(dir); idx = Math.max(0, images.findIndex(im => im.id === node.id)); }
    else if (node && node.type === 'folder') { dir = canonical(path); images = collectImages(dir); idx = 0; }
    else { dir = KNOWN.pictures; images = collectImages(dir); idx = 0; }
    render();
  }

  function applyTransform() {
    if (!imgEl) return;
    imgEl.style.transform = `translate(${panX}px, ${panY}px) rotate(${rot}deg) scale(${zoom})`;
    zoomBtn.textContent = Math.round(zoom * 100) + '%';
    stage.classList.toggle('zoomed', zoom > 1);
  }

  function render() {
    stage.querySelectorAll('img, .photos-empty').forEach(e => e.remove());
    zoom = 1; rot = 0; panX = panY = 0;
    if (!images.length) {
      imgEl = null;
      stage.insertAdjacentHTML('beforeend', `<div class="photos-empty">No pictures here yet. Take one with Camera, draw one in Paint, or drop images from your PC into ${esc(addressOf(dir))}.</div>`);
      nameEl.textContent = '';
      film.innerHTML = '';
      win.setTitle('Photos');
      return;
    }
    idx = (idx + images.length) % images.length;
    const img = images[idx];
    imgEl = document.createElement('img');
    imgEl.src = img.content;
    imgEl.alt = img.name;
    imgEl.draggable = false;
    imgEl.addEventListener('load', () => renderInfo());
    stage.appendChild(imgEl);
    applyTransform();
    nameEl.textContent = `${img.name}   ·   ${idx + 1} of ${images.length}`;
    win.setTitle(`${img.name} - Photos`);
    renderFilm();
    renderInfo();
  }

  function renderFilm() {
    film.innerHTML = '';
    images.forEach((im, i) => {
      const t = document.createElement('div');
      t.className = 'pf-thumb' + (i === idx ? ' sel' : '');
      t.style.backgroundImage = `url("${im.content.replace(/"/g, '%22')}")`;
      t.title = im.name;
      t.addEventListener('click', () => { idx = i; render(); });
      film.appendChild(t);
    });
    film.querySelector('.sel')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function renderInfo() {
    if (info.classList.contains('hidden') || !images[idx]) return;
    const im = images[idx];
    info.innerHTML = `<h3>File information</h3>
      <div class="pi-row"><b>${esc(im.name)}</b></div>
      <div class="pi-row">${new Date(im.modified || im.created).toLocaleString()}</div>
      <div class="pi-row">${imgEl && imgEl.naturalWidth ? `${imgEl.naturalWidth} × ${imgEl.naturalHeight}` : ''}  ${formatSize(sizeOf(im))}</div>
      <div class="pi-row pi-path">${esc(addressOf([...dir, im.name]))}</div>
      <button class="flyout-linkbtn pi-open">Open file location</button>`;
    info.querySelector('.pi-open').addEventListener('click', () => launch('explorer', { path: dir }));
  }

  const nav = (d) => { if (!images.length) return; idx = (idx + d + images.length) % images.length; render(); };
  root.querySelector('.pnav.prev').addEventListener('click', () => nav(-1));
  root.querySelector('.pnav.next').addEventListener('click', () => nav(1));

  function setZoom(z, cx = null, cy = null) {
    const nz = Math.max(0.1, Math.min(8, z));
    if (cx != null && imgEl) {
      const r = stage.getBoundingClientRect();
      const ox = cx - r.left - r.width / 2 - panX, oy = cy - r.top - r.height / 2 - panY;
      panX -= ox * (nz / zoom - 1); panY -= oy * (nz / zoom - 1);
    }
    zoom = nz;
    if (zoom <= 1) { panX = 0; panY = 0; }
    applyTransform();
  }

  function toggleSlideshow() {
    if (slideshow) { clearInterval(slideshow); slideshow = null; root.classList.remove('slideshow'); return; }
    if (images.length < 2) return;
    root.classList.add('slideshow');
    slideshow = setInterval(() => nav(1), 3500);
  }
  async function del() {
    const im = images[idx];
    if (!im) return;
    await deleteItems(dir, [im.name]);
  }

  const actions = {
    in: () => setZoom(zoom * 1.25), out: () => setZoom(zoom / 1.25), fit: () => setZoom(1),
    rotate: () => { rot = (rot + 90) % 360; applyTransform(); },
    delete: del,
    edit: () => images[idx] && launch('paint', { path: [...dir, images[idx].name] }),
    slideshow: toggleSlideshow,
    full: () => { if (document.fullscreenElement === root) document.exitFullscreen(); else root.requestFullscreen?.().catch(() => {}); },
    more: (btn) => {
      const r = btn.getBoundingClientRect();
      const im = images[idx];
      contextMenu(r.right - 220, r.bottom + 4, [
        { label: 'Set as desktop background', icon: I.wallpaper, disabled: !im, action: () => setWallpaper([...dir, im.name]) },
        { label: 'Open with Paint', icon: I.paint, disabled: !im, action: actions.edit },
        { label: 'Open in Edge', icon: I.edge, disabled: !im, action: () => openPath([...dir, im.name], 'edge') },
        { label: 'Save a copy to your PC', icon: I.download, disabled: !im, action: () => downloadNode(im) },
        '-',
        { label: 'File info', icon: I.info, checked: !info.classList.contains('hidden'), action: () => { info.classList.toggle('hidden'); renderInfo(); } },
        { label: 'Open file location', icon: I.folder, action: () => launch('explorer', { path: dir }) },
      ]);
    },
  };
  root.querySelectorAll('.ptools .pbtn').forEach(b => b.addEventListener('click', () => actions[b.dataset.a](b)));

  stage.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); }, { passive: false });
  stage.addEventListener('dblclick', (e) => { if (e.target === imgEl) setZoom(zoom > 1 ? 1 : 2, e.clientX, e.clientY); });
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (zoom <= 1 || e.target !== imgEl) return;
    drag = { x: e.clientX - panX, y: e.clientY - panY };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => { if (drag) { panX = e.clientX - drag.x; panY = e.clientY - drag.y; applyTransform(); } });
  stage.addEventListener('pointerup', () => { drag = null; });
  stage.addEventListener('contextmenu', (e) => { e.preventDefault(); actions.more({ getBoundingClientRect: () => ({ right: e.clientX + 220, bottom: e.clientY - 4 }) }); });

  const onKey = (e) => {
    if (document.querySelector('.window.active') !== win.el) return;
    if (e.target.tagName === 'INPUT') return;
    const k = e.key;
    if (k === 'ArrowLeft') nav(-1);
    else if (k === 'ArrowRight' || k === ' ') { e.preventDefault(); nav(1); }
    else if (k === 'Delete') del();
    else if (k === '+' || k === '=') setZoom(zoom * 1.25);
    else if (k === '-') setZoom(zoom / 1.25);
    else if (k === '0') setZoom(1);
    else if (k === 'F5') { e.preventDefault(); toggleSlideshow(); }
    else if (k === 'Escape' && slideshow) toggleSlideshow();
    else if (e.ctrlKey && k.toLowerCase() === 'r') { e.preventDefault(); actions.rotate(); }
  };
  document.addEventListener('keydown', onKey);

  const offFS = onFSChange(() => {
    const cur = images[idx];
    const before = images.length;
    images = collectImages(dir);
    const i = cur ? images.findIndex(im => im.id === cur.id) : -1;
    if (i >= 0) idx = i; else if (before) idx = Math.min(idx, images.length - 1);
    if (i < 0 || images.length !== before) render(); else renderFilm();
  });
  win.onclose(() => { document.removeEventListener('keydown', onKey); offFS(); if (slideshow) clearInterval(slideshow); });

  setFrom(arg && arg.path ? arg.path : null);
  return win;
}

