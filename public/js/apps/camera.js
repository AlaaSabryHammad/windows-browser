/* Camera — real webcam via getUserMedia: photos & videos saved to Camera Roll. Also: screenshots (PrintScreen). */
import { createWindow } from '../wm.js';
import { I } from '../icons.js';
import { addNode, makeFile, makeFolder, getNode, KNOWN } from '../fs.js';
import { notify, msgDialog } from '../ui.js';
import { playSound } from '../sound.js';
import { launch } from './registry.js';

const ROLL = [...KNOWN.pictures, 'Camera Roll'];
const pad = (n) => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}
function ensureDir(path) {
  let acc = [];
  for (const seg of path) {
    if (!getNode([...acc, seg])) addNode(acc, makeFolder(seg));
    acc = [...acc, seg];
  }
}
const blobToDataURL = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });

export function open() {
  const win = createWindow({ title: 'Camera', icon: I.camera, appId: 'camera', w: 820, h: 560, minW: 480, minH: 340 });
  win.body.innerHTML = `
    <div class="cam">
      <video class="cam-video" playsinline muted></video>
      <div class="cam-flash"></div>
      <div class="cam-msg hidden"></div>
      <div class="cam-count hidden"></div>
      <div class="cam-rec hidden"><span class="dot"></span><span class="cam-rectime">00:00</span></div>
      <div class="cam-top">
        <button class="cam-tb" data-a="mirror" title="Mirror">⇋</button>
        <button class="cam-tb" data-a="timer" title="Photo timer">⏱ <span class="cam-tv">Off</span></button>
        <button class="cam-tb" data-a="switch" title="Change camera">${I.restart}</button>
      </div>
      <div class="cam-side">
        <button class="cam-mode" data-m="video" title="Take video">${I.videofile}</button>
        <button class="cam-shutter" title="Take photo (Space)"></button>
        <button class="cam-mode sel" data-m="photo" title="Take photo">${I.cam}</button>
        <button class="cam-last" title="Open Camera Roll"></button>
      </div>
    </div>`;

  const root = win.body.querySelector('.cam');
  const video = root.querySelector('.cam-video');
  const msg = root.querySelector('.cam-msg');
  const shutter = root.querySelector('.cam-shutter');
  const last = root.querySelector('.cam-last');
  const countEl = root.querySelector('.cam-count');
  const recEl = root.querySelector('.cam-rec');

  let stream = null, devices = [], devIdx = 0, mode = 'photo', mirror = true, timerSecs = 0;
  let recorder = null, chunks = [], recStart = 0, recTick = null;

  async function start() {
    stop();
    msg.classList.add('hidden');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('This browser can\'t use the camera here.', 'Open the PC over https:// or http://localhost to allow camera access.', '0xA00F4271');
      return;
    }
    try {
      const constraints = { video: devices[devIdx] ? { deviceId: { exact: devices[devIdx].deviceId } } : { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: mode === 'video' };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play().catch(() => {});
      devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      root.querySelector('[data-a="switch"]').classList.toggle('hidden', devices.length < 2);
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') showError('It looks like you\'ve blocked access to your camera.', 'Allow camera access for this site in your browser, then try again.', '0xA00F424F');
      else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') showError('We can\'t find your camera', 'Check that it\'s connected and installed properly, that it isn\'t being blocked by antivirus software, and that your camera drivers are up-to-date.', '0xA00F4244 (0xC00D36D5)');
      else if (mode === 'video' && e.name === 'NotReadableError') { mode = 'photo'; start(); }
      else showError('Something went wrong', e.message || String(e), '0xA00F4292');
    }
  }
  function stop() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  function showError(title, body, code) {
    msg.innerHTML = `<div class="cm-ic">${I.cam}</div><h2>${title}</h2><p>${body}</p><p class="cm-code">If you need it, here's the error code: ${code}</p><button class="btn primary cm-retry">Try again</button>`;
    msg.classList.remove('hidden');
    msg.querySelector('.cm-retry').addEventListener('click', start);
  }

  function applyMirror() { video.style.transform = mirror ? 'scaleX(-1)' : ''; }
  applyMirror();

  function refreshLast() {
    const roll = getNode(ROLL);
    const items = roll ? roll.children.filter(c => c.type === 'file') : [];
    const item = items[items.length - 1];
    last.classList.toggle('empty', !item);
    last.style.backgroundImage = item && item.kind === 'img' ? `url("${item.content}")` : '';
    last.innerHTML = item && item.kind === 'video' ? I.play : '';
    last.dataset.name = item ? item.name : '';
  }

  async function takePhoto() {
    if (!stream || !video.videoWidth) return;
    if (timerSecs) {
      for (let s = timerSecs; s > 0; s--) {
        countEl.textContent = s; countEl.classList.remove('hidden');
        playSound('click', true);
        await new Promise(r => setTimeout(r, 1000));
      }
      countEl.classList.add('hidden');
    }
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    const ctx = c.getContext('2d');
    if (mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0);
    const data = c.toDataURL('image/jpeg', 0.9);
    ensureDir(ROLL);
    const node = addNode(ROLL, makeFile(`WIN_${stamp()}_Pro.jpg`, 'img', data));
    playSound('shutter', true);
    root.classList.remove('flashing'); void root.offsetWidth; root.classList.add('flashing');
    refreshLast();
    return node;
  }

  async function toggleRecording() {
    if (recorder) { recorder.stop(); return; }
    if (!stream) return;
    if (!stream.getAudioTracks().length && mode === 'video') { /* fine: silent video */ }
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!window.MediaRecorder || !type) { msgDialog('Camera', 'This browser can\'t record video.', 'error'); return; }
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: type });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      clearInterval(recTick);
      recEl.classList.add('hidden');
      shutter.classList.remove('recording');
      const blob = new Blob(chunks, { type: recorder.mimeType });
      recorder = null;
      const data = await blobToDataURL(blob);
      ensureDir(ROLL);
      addNode(ROLL, makeFile(`WIN_${stamp()}_Pro.${type.includes('mp4') ? 'mp4' : 'webm'}`, 'video', data));
      refreshLast();
      notify('Camera', 'Video saved to Camera Roll.', I.camera, { silent: true, onClick: () => launch('explorer', { path: ROLL }) });
    };
    recorder.start(500);
    recStart = Date.now();
    recEl.classList.remove('hidden');
    shutter.classList.add('recording');
    recTick = setInterval(() => { const s = Math.floor((Date.now() - recStart) / 1000); root.querySelector('.cam-rectime').textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; }, 250);
  }

  shutter.addEventListener('click', () => (mode === 'photo' ? takePhoto() : toggleRecording()));
  root.querySelectorAll('.cam-mode').forEach(b => b.addEventListener('click', () => {
    if (recorder) return;
    const m = b.dataset.m;
    if (m === mode) { shutter.click(); return; }
    mode = m;
    root.querySelectorAll('.cam-mode').forEach(x => x.classList.toggle('sel', x === b));
    shutter.classList.toggle('video', mode === 'video');
    shutter.title = mode === 'video' ? 'Take video (Space)' : 'Take photo (Space)';
    start();
  }));
  root.querySelector('[data-a="mirror"]').addEventListener('click', () => { mirror = !mirror; applyMirror(); });
  root.querySelector('[data-a="timer"]').addEventListener('click', () => {
    timerSecs = timerSecs === 0 ? 2 : timerSecs === 2 ? 5 : timerSecs === 5 ? 10 : 0;
    root.querySelector('.cam-tv').textContent = timerSecs ? `${timerSecs}s` : 'Off';
  });
  root.querySelector('[data-a="switch"]').addEventListener('click', () => { devIdx = (devIdx + 1) % Math.max(1, devices.length); start(); });
  last.addEventListener('click', () => {
    if (!last.dataset.name) { launch('explorer', { path: ROLL }); return; }
    const p = [...ROLL, last.dataset.name];
    launch(getNode(p)?.kind === 'video' ? 'mediaplayer' : 'photos', { path: p });
  });

  const onKey = (e) => {
    if (document.querySelector('.window.active') !== win.el) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); shutter.click(); }
  };
  document.addEventListener('keydown', onKey);
  win.onclose(() => { if (recorder) recorder.stop(); stop(); document.removeEventListener('keydown', onKey); clearInterval(recTick); });

  refreshLast();
  start();
  return win;
}

/* PrintScreen / Win+PrintScreen: capture this tab into Pictures\Screenshots */
export async function screenshot() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    notify('Screenshot', 'This browser can\'t take screenshots of the page.', I.warning);
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' });
  } catch { return; }
  const v = document.createElement('video');
  v.srcObject = stream; v.muted = true;
  await v.play();
  await new Promise(r => setTimeout(r, 250));
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  stream.getTracks().forEach(t => t.stop());
  const dir = [...KNOWN.pictures, 'Screenshots'];
  ensureDir(dir);
  const n = (getNode(dir).children.length || 0) + 1;
  const node = addNode(dir, makeFile(`Screenshot (${n}).png`, 'img', c.toDataURL('image/png')));
  playSound('shutter', true);
  notify('Screenshot saved', `Saved to Pictures\\Screenshots\\${node.name}`, I.photos, { onClick: () => launch('photos', { path: [...dir, node.name] }) });
}
