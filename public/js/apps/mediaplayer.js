/* Media Player — music & video library from the virtual disk, playlist, shuffle/repeat, visualizer, media keys. */
import { createWindow } from '../wm.js';
import { I } from '../icons.js';
import { getNode, canonical, KNOWN, kindOf, walk, onFSChange, sizeOf, formatSize, addressOf } from '../fs.js';
import { importFiles, dragKind, currentDrag, iconFor } from '../fileops.js';
import { masterVolume } from '../sound.js';
import { onSettingsChange } from '../settings.js';
import { esc, contextMenu } from '../ui.js';
import { launch } from './registry.js';

const fmt = (s) => !isFinite(s) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function library(kind) {
  const roots = kind === 'video' ? [KNOWN.videos, KNOWN.pictures] : [KNOWN.music];
  const out = [];
  for (const r of roots) {
    const node = getNode(r);
    if (!node) continue;
    walk((n, p) => { if (n.type === 'file' && kindOf(n) === kind && n.content) out.push({ node: n, path: p }); }, node, r);
  }
  return out.sort((a, b) => a.node.name.localeCompare(b.node.name, undefined, { numeric: true }));
}

export function open(arg = null) {
  const win = createWindow({ title: 'Media Player', icon: I.media, appId: 'mediaplayer', w: 900, h: 580, minW: 520, minH: 360 });
  win.body.innerHTML = `
    <div class="mp" tabindex="-1">
      <div class="mp-side">
        <div class="mp-nav sel" data-v="music">${I.musicfile}<span>Music library</span></div>
        <div class="mp-nav" data-v="video">${I.videofile}<span>Video library</span></div>
        <div class="mp-nav" data-v="now">${I.media}<span>Now playing</span></div>
        <div class="mp-sep"></div>
        <div class="mp-nav" data-v="add">${I.upload}<span>Add files from your PC</span></div>
        <div class="mp-nav" data-v="folder">${I.folder}<span>Open music folder</span></div>
      </div>
      <div class="mp-main">
        <div class="mp-list"></div>
        <div class="mp-now hidden"><div class="mp-art"><canvas class="mp-viz"></canvas><div class="mp-art-ic">${I.media}</div><div class="mp-art-title"></div></div><video class="mp-video" playsinline></video></div>
      </div>
      <div class="mp-bar">
        <div class="mp-track"><span class="mp-ic">${I.musicfile}</span><div><div class="mp-title">Nothing playing</div><div class="mp-sub"></div></div></div>
        <div class="mp-center">
          <div class="mp-btns">
            <button class="mp-b" data-a="shuffle" title="Shuffle">${I.shuffle}</button>
            <button class="mp-b" data-a="prev" title="Previous (Ctrl+B)">${I.prev}</button>
            <button class="mp-b big" data-a="play" title="Play (Ctrl+P)">${I.play}</button>
            <button class="mp-b" data-a="next" title="Next (Ctrl+F)">${I.next}</button>
            <button class="mp-b" data-a="repeat" title="Repeat">${I.repeat}</button>
          </div>
          <div class="mp-seek"><span class="mp-t0">0:00</span><input type="range" min="0" max="1000" value="0" class="mp-range"><span class="mp-t1">0:00</span></div>
        </div>
        <div class="mp-vol">${I.volume}<input type="range" min="0" max="100" value="80" class="mp-volr" title="App volume"></div>
      </div>
    </div>`;

  const root = win.body.querySelector('.mp');
  const listEl = root.querySelector('.mp-list');
  const nowEl = root.querySelector('.mp-now');
  const video = root.querySelector('.mp-video');
  const art = root.querySelector('.mp-art');
  const viz = root.querySelector('.mp-viz');
  const seek = root.querySelector('.mp-range');
  const volR = root.querySelector('.mp-volr');
  const t0 = root.querySelector('.mp-t0'), t1 = root.querySelector('.mp-t1');
  const playBtn = root.querySelector('[data-a="play"]');

  /* one element plays everything; audio is drawn as album art + visualizer */
  const media = video;
  let view = 'music';
  let queue = [];          /* [{node, path}] */
  let qi = -1;
  let shuffle = false, repeat = 'off';   /* 'off' | 'all' | 'one' */
  let appVol = 0.8;

  const applyVolume = () => { media.volume = Math.max(0, Math.min(1, appVol * masterVolume())); };
  applyVolume();
  const offSet = onSettingsChange((s, p) => { if (p && ('volume' in p || 'muted' in p)) applyVolume(); });
  volR.addEventListener('input', () => { appVol = volR.value / 100; applyVolume(); });

  function setView(v) {
    view = v;
    root.querySelectorAll('.mp-nav[data-v]').forEach(n => n.classList.toggle('sel', n.dataset.v === v));
    listEl.classList.toggle('hidden', v === 'now');
    nowEl.classList.toggle('hidden', v !== 'now');
    if (v !== 'now') renderList();
  }

  function renderList() {
    const kind = view === 'video' ? 'video' : 'audio';
    const items = library(kind);
    const current = queue[qi];
    listEl.innerHTML = `<div class="mp-head"><h1>${view === 'video' ? 'Videos' : 'Music'}</h1>
      ${items.length ? `<button class="btn primary mp-playall">${I.play} Play all</button><button class="btn mp-shuf">${I.shuffle} Shuffle all</button>` : ''}</div>`;
    if (!items.length) {
      listEl.insertAdjacentHTML('beforeend', `<div class="mp-empty">${view === 'video' ? I.videofile : I.musicfile}
        <p>We couldn't find any ${view === 'video' ? 'videos' : 'music'}.</p>
        <p class="sr-sub">Add ${view === 'video' ? '.mp4 or .webm' : '.mp3, .wav, .ogg or .m4a'} files to ${esc(addressOf(view === 'video' ? KNOWN.videos : KNOWN.music))} — drag them in from your PC, or use the button below. Videos recorded with Camera show up here too.</p>
        <button class="btn primary mp-addbtn">Add files from your PC</button></div>`);
      listEl.querySelector('.mp-addbtn').addEventListener('click', addFiles);
      return;
    }
    const table = document.createElement('div');
    table.className = 'mp-table';
    items.forEach((it, i) => {
      const r = document.createElement('div');
      r.className = 'mp-row' + (current && current.node.id === it.node.id ? ' playing' : '');
      r.innerHTML = `<span class="mp-ri">${current && current.node.id === it.node.id && !media.paused ? I.play : iconFor(it.node)}</span><span class="mp-rn">${esc(it.node.name.replace(/\.[^.]+$/, ''))}</span><span class="mp-rf">${esc(it.path.slice(-2, -1)[0] || '')}</span><span class="mp-rs">${formatSize(sizeOf(it.node))}</span>`;
      r.addEventListener('dblclick', () => playList(items, i));
      r.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: 'Play', bold: true, icon: I.play, action: () => playList(items, i) },
          { label: 'Play next', action: () => { queue.splice(qi + 1, 0, it); } },
          { label: 'Add to queue', action: () => { queue.push(it); if (qi < 0) playAt(0); } },
          '-',
          { label: 'Show in folder', icon: I.folder, action: () => launch('explorer', { path: it.path.slice(0, -1) }) },
        ]);
      });
      table.appendChild(r);
    });
    listEl.appendChild(table);
    listEl.querySelector('.mp-playall').addEventListener('click', () => { shuffle = false; syncButtons(); playList(items, 0); });
    listEl.querySelector('.mp-shuf').addEventListener('click', () => { shuffle = true; syncButtons(); playList(items, Math.floor(Math.random() * items.length)); });
  }

  function playList(items, i) { queue = items.slice(); playAt(i); }

  function playAt(i) {
    if (!queue.length) return;
    qi = (i + queue.length) % queue.length;
    const it = queue[qi];
    const node = getNode(it.path) || it.node;
    const isVideo = kindOf(node) === 'video';
    media.src = node.content;
    media.play().catch(() => {});
    nowEl.classList.toggle('is-video', isVideo);
    root.querySelector('.mp-title').textContent = node.name.replace(/\.[^.]+$/, '');
    root.querySelector('.mp-sub').textContent = isVideo ? 'Video' : (it.path.slice(-2, -1)[0] || 'Music');
    root.querySelector('.mp-ic').innerHTML = isVideo ? I.videofile : I.musicfile;
    root.querySelector('.mp-art-title').textContent = node.name.replace(/\.[^.]+$/, '');
    win.setTitle(`${node.name.replace(/\.[^.]+$/, '')} - Media Player`);
    window.__nowPlaying = node.name.replace(/\.[^.]+$/, '');
    if (isVideo || view === 'now') setView('now'); else renderList();
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: node.name.replace(/\.[^.]+$/, ''), artist: 'Windows 10 Web', album: isVideo ? 'Videos' : 'Music' });
      } catch { /* ignore */ }
    }
    setupViz();
  }

  function next(auto = false) {
    if (!queue.length) return;
    if (auto && repeat === 'one') { media.currentTime = 0; media.play(); return; }
    if (shuffle && queue.length > 1) { let n; do { n = Math.floor(Math.random() * queue.length); } while (n === qi); playAt(n); return; }
    if (qi + 1 >= queue.length && auto && repeat === 'off') { media.pause(); return; }
    playAt(qi + 1);
  }
  function prev() {
    if (media.currentTime > 3) { media.currentTime = 0; return; }
    playAt(qi - 1);
  }
  function toggle() {
    if (qi < 0) {
      const items = library(view === 'video' ? 'video' : 'audio');
      if (items.length) playList(items, 0);
      return;
    }
    if (media.paused) media.play().catch(() => {}); else media.pause();
  }

  function syncButtons() {
    playBtn.innerHTML = media.paused ? I.play : I.pause;
    playBtn.title = media.paused ? 'Play (Ctrl+P)' : 'Pause (Ctrl+P)';
    root.querySelector('[data-a="shuffle"]').classList.toggle('on', shuffle);
    const rb = root.querySelector('[data-a="repeat"]');
    rb.classList.toggle('on', repeat !== 'off');
    rb.classList.toggle('one', repeat === 'one');
    rb.title = `Repeat: ${repeat}`;
  }

  root.querySelectorAll('.mp-b').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.a;
    if (a === 'play') toggle();
    else if (a === 'next') next();
    else if (a === 'prev') prev();
    else if (a === 'shuffle') { shuffle = !shuffle; syncButtons(); }
    else if (a === 'repeat') { repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'; syncButtons(); }
  }));

  media.addEventListener('play', () => { syncButtons(); if (view !== 'now') renderList(); });
  media.addEventListener('pause', () => { syncButtons(); if (view !== 'now') renderList(); });
  media.addEventListener('ended', () => next(true));
  media.addEventListener('timeupdate', () => {
    if (!seeking) seek.value = media.duration ? Math.round(media.currentTime / media.duration * 1000) : 0;
    t0.textContent = fmt(media.currentTime);
    t1.textContent = fmt(media.duration);
  });
  media.addEventListener('error', () => { if (media.src) root.querySelector('.mp-sub').textContent = 'Can\'t play this file (unsupported format)'; });
  let seeking = false;
  seek.addEventListener('input', () => { seeking = true; t0.textContent = fmt(seek.value / 1000 * (media.duration || 0)); });
  seek.addEventListener('change', () => { if (media.duration) media.currentTime = seek.value / 1000 * media.duration; seeking = false; });

  /* ---------- visualizer (audio only) ---------- */
  let actx = null, analyser = null, raf = null;
  function setupViz() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      const src = actx.createMediaElementSource(media);
      analyser = actx.createAnalyser();
      analyser.fftSize = 128;
      src.connect(analyser);
      analyser.connect(actx.destination);
    } catch { actx = null; return; }
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (nowEl.classList.contains('hidden') || nowEl.classList.contains('is-video')) return;
      const c = viz.getContext('2d');
      const w = viz.width = viz.clientWidth, h = viz.height = viz.clientHeight;
      analyser.getByteFrequencyData(data);
      c.clearRect(0, 0, w, h);
      const bw = w / data.length;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] / 255;
        c.fillStyle = `hsla(${320 + v * 60}, 90%, ${45 + v * 25}%, .85)`;
        c.fillRect(i * bw + 1, h - v * h * 0.9, bw - 2, v * h * 0.9);
      }
    };
    draw();
  }

  /* ---------- importing ---------- */
  async function addFiles() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.accept = 'audio/*,video/*';
    inp.addEventListener('change', async () => {
      const files = [...inp.files];
      await importFiles(KNOWN.music, files.filter(f => !f.type.startsWith('video/')));
      await importFiles(KNOWN.videos, files.filter(f => f.type.startsWith('video/')));
      if (files.length && files.every(f => f.type.startsWith('video/'))) setView('video'); else setView('music');
    });
    inp.click();
  }

  root.querySelectorAll('.mp-nav').forEach(n => n.addEventListener('click', () => {
    const v = n.dataset.v;
    if (v === 'add') addFiles();
    else if (v === 'folder') launch('explorer', { path: view === 'video' ? KNOWN.videos : KNOWN.music });
    else setView(v);
  }));

  root.addEventListener('dragover', (e) => { if (dragKind(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  root.addEventListener('drop', async (e) => {
    const k = dragKind(e);
    if (!k) return;
    e.preventDefault();
    if (k === 'internal') {
      const p = currentDrag();
      const items = (p ? p.names : []).map(n => ({ node: getNode([...p.dir, n]), path: [...p.dir, n] })).filter(x => x.node && ['audio', 'video'].includes(kindOf(x.node)));
      if (items.length) playList(items, 0);
    } else {
      const files = [...e.dataTransfer.files];
      const a = await importFiles(KNOWN.music, files.filter(f => f.type.startsWith('audio/')));
      const v = await importFiles(KNOWN.videos, files.filter(f => f.type.startsWith('video/')));
      const first = a.length ? [...KNOWN.music, a[0]] : v.length ? [...KNOWN.videos, v[0]] : null;
      if (first) openPathHere(first);
    }
  });

  function openPathHere(path) {
    const node = getNode(path);
    if (!node) return;
    const cp = canonical(path);
    const kind = kindOf(node);
    /* play the folder it lives in, starting at this file */
    const dirNode = getNode(cp.slice(0, -1));
    const siblings = dirNode.children.filter(c => c.type === 'file' && kindOf(c) === kind && c.content).map(c => ({ node: c, path: [...cp.slice(0, -1), c.name] }));
    const i = siblings.findIndex(s => s.node.id === node.id);
    view = 'now';
    playList(siblings, Math.max(0, i));
  }

  root.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    const k = e.key.toLowerCase();
    if (e.key === ' ' || (e.ctrlKey && k === 'p')) { e.preventDefault(); toggle(); }
    else if (e.ctrlKey && k === 'f') { e.preventDefault(); next(); }
    else if (e.ctrlKey && k === 'b') { e.preventDefault(); prev(); }
    else if (e.key === 'ArrowRight' && !e.ctrlKey) { media.currentTime += 5; }
    else if (e.key === 'ArrowLeft' && !e.ctrlKey) { media.currentTime -= 5; }
  });
  video.addEventListener('dblclick', () => { if (document.fullscreenElement) document.exitFullscreen(); else video.requestFullscreen?.(); });
  video.addEventListener('click', toggle);

  /* hardware media keys / OS media controls */
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => media.play());
      navigator.mediaSession.setActionHandler('pause', () => media.pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => next());
      navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    } catch { /* ignore */ }
  }

  const offFS = onFSChange(() => { if (view !== 'now') renderList(); });
  win.onclose(() => {
    offFS(); offSet();
    media.pause(); media.removeAttribute('src'); media.load();
    window.__nowPlaying = null;
    if (raf) cancelAnimationFrame(raf);
    if (actx) actx.close();
  });
  win.onRelaunch = (a) => { if (a && a.path) openPathHere(a.path); };

  syncButtons();
  if (arg && arg.path) openPathHere(arg.path); else setView('music');
  setTimeout(() => root.focus({ preventScroll: true }), 50);
  return win;
}
