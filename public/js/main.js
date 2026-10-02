/* Boot sequence: boot → (first-run setup) → lock → sign-in → desktop. Also lock / sleep / sign out / shut down / restart. */
import { initFS, requestPersistence, onFSChange } from './fs.js';
import { settings, applySettings, updateSettings, checkPassword, hashPassword, userInitial, onSettingsChange, ACCENTS } from './settings.js';
import { initDesktop } from './desktop.js';
import { initTaskbar, formatTime } from './taskbar.js';
import { initShell } from './shell.js';
import { notify, esc, contextMenu, hideFlyout, hideContextMenu } from './ui.js';
import { closeAll } from './wm.js';
import { launch } from './apps/registry.js';
import { initClockService } from './apps/clock.js';
import { playSound } from './sound.js';
import { I } from './icons.js';

const $ = (id) => document.getElementById(id);
const lock = $('lock-screen');
const q = (sel) => lock.querySelector(sel);
let desktopApi = null;
let signedInOnce = false;
let busy = false;     /* a power transition is running */

/* ---------------- desktop visibility ---------------- */
function showDesktop() {
  $('desktop-root').classList.remove('hidden');
  $('taskbar').classList.remove('hidden');
  desktopApi && desktopApi.refresh();
}
function hideDesktop() {
  hideFlyout(); hideContextMenu();
  $('desktop-root').classList.add('hidden');
  $('taskbar').classList.add('hidden');
}

/* ---------------- lock screen ---------------- */
function renderLockUser() {
  q('.avatar').textContent = userInitial();
  q('.username').textContent = settings.userName;
  const hasPw = !!settings.passwordHash;
  q('.lock-pw').classList.toggle('hidden', !hasPw);
  $('signin-btn').classList.toggle('hidden', hasPw);
  q('.lock-err').classList.add('hidden');
  q('.lock-hint2').classList.add('hidden');
  q('.ls-net').innerHTML = navigator.onLine && !settings.airplane ? I.wifi : I.offline;
  q('.ls-power').innerHTML = I.power;
}

function lockScreen(showLogin = false) {
  hideDesktop();
  renderLockUser();
  lock.classList.remove('hidden', 'show-login');
  q('.lock-login').classList.add('hidden');
  q('.lock-pw-input').value = '';
  updateLockClock();
  if (showLogin) toLogin();
}

function toLogin() {
  if (lock.classList.contains('show-login')) return;
  lock.classList.add('show-login');
  q('.lock-login').classList.remove('hidden');
  setTimeout(() => (settings.passwordHash ? q('.lock-pw-input') : $('signin-btn')).focus(), 60);
}

function updateLockClock() {
  if (lock.classList.contains('hidden')) return;
  const now = new Date();
  q('.lock-time').textContent = formatTime(now, false).replace(/\s?[AP]M$/, '');
  q('.lock-date').textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
setInterval(updateLockClock, 1000);

function initLockHandlers() {
  lock.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.lock-status')) return;
    toLogin();
  });
  document.addEventListener('keydown', (e) => {
    if (lock.classList.contains('hidden') || busy) return;
    if (!lock.classList.contains('show-login')) { e.preventDefault(); toLogin(); return; }
    if (e.key === 'Escape') { lock.classList.remove('show-login'); q('.lock-login').classList.add('hidden'); }
  });

  $('signin-btn').addEventListener('click', (e) => { e.stopPropagation(); signIn(); });
  q('.lock-pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = q('.lock-pw-input').value;
    /* request full screen while we still have the user gesture */
    maybeFullscreen();
    if (await checkPassword(pw)) { signIn(true); return; }
    playSound('error');
    q('.lock-err').textContent = 'The password is incorrect. Try again.';
    q('.lock-err').classList.remove('hidden');
    if (settings.passwordHint) {
      q('.lock-hint2').textContent = `Hint: ${settings.passwordHint}`;
      q('.lock-hint2').classList.remove('hidden');
    }
    q('.lock-pw-input').select();
  });

  q('.ls-power').addEventListener('click', (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left - 150, r.top - 110, [
      { label: 'Sleep', icon: I.sleep, action: () => fire('sleep') },
      { label: 'Shut down', icon: I.power, action: () => fire('shutdown') },
      { label: 'Restart', icon: I.restart, action: () => fire('restart') },
    ]);
  });
}

function maybeFullscreen() {
  if (settings.fullscreenOnSignIn && !document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => navigator.keyboard?.lock?.().catch(() => {}))
      .catch(() => {});
  }
}

function signIn(alreadyFullscreen = false) {
  if (busy) return;
  if (!alreadyFullscreen) maybeFullscreen();
  busy = true;
  const welcome = document.createElement('div');
  welcome.className = 'lock-welcome';
  welcome.innerHTML = `<div class="spinner"><span></span><span></span><span></span><span></span><span></span><span></span></div><div class="wtext">Welcome</div>`;
  lock.appendChild(welcome);
  playSound('logon');
  setTimeout(() => {
    lock.classList.add('hidden');
    lock.classList.remove('show-login');
    welcome.remove();
    busy = false;
    showDesktop();
    if (!signedInOnce) {
      signedInOnce = true;
      afterFirstSignIn();
    }
  }, 1300);
}

function afterFirstSignIn() {
  for (const id of settings.startupApps || []) setTimeout(() => launch(id), 400);
  if (!localStorage.getItem('webwin-welcomed')) {
    try { localStorage.setItem('webwin-welcomed', '1'); } catch { /* ignore */ }
    setTimeout(() => {
      notify('Welcome to Windows 10 Web', 'Press the Windows key (or Ctrl+Esc) for Start, Win+E for File Explorer, Alt+Tab to switch apps. Click to read the tips.', I.start,
        { onClick: () => launch('notepad', { path: ['Users', 'User', 'Desktop', 'Read Me.txt'] }) });
    }, 900);
  }
}

/* ---------------- boot ---------------- */
function boot() {
  busy = true;
  hideDesktop();
  const bootEl = $('boot-screen');
  bootEl.classList.remove('hidden');
  setTimeout(() => {
    bootEl.classList.add('hidden');
    busy = false;
    if (!settings.setupDone) runSetup();
    else lockScreen();
  }, 2600);
}

/* ---------------- first-run setup (OOBE) ---------------- */
function runSetup() {
  const el = $('oobe');
  el.classList.remove('hidden');
  const data = { name: settings.userName === 'User' ? '' : settings.userName, pw: '', hint: '', theme: settings.theme, accent: settings.accent };

  const steps = [
    () => `
      <div class="oobe-side">${I.user.replace('<svg', '<svg width="120" height="120"')}</div>
      <div class="oobe-main">
        <h1>Who's going to use this PC?</h1>
        <p>What name do you want to use?</p>
        <input class="oobe-in" id="oobe-name" maxlength="32" placeholder="User name" value="${esc(data.name)}" spellcheck="false">
        <div class="oobe-err"></div>
      </div>`,
    () => `
      <div class="oobe-side">${I.lock.replace('<svg', '<svg width="120" height="120"')}</div>
      <div class="oobe-main">
        <h1>Create a super memorable password</h1>
        <p>Make sure to pick something you'll absolutely remember. Leave it empty if you don't want a password.</p>
        <input class="oobe-in" id="oobe-pw" type="password" placeholder="Enter password" value="${esc(data.pw)}">
        <input class="oobe-in" id="oobe-pw2" type="password" placeholder="Confirm password" value="${esc(data.pw)}">
        <input class="oobe-in" id="oobe-hint" placeholder="Password hint (optional)" value="${esc(data.hint)}">
        <div class="oobe-err"></div>
      </div>`,
    () => `
      <div class="oobe-side">${I.paint.replace('<svg', '<svg width="120" height="120"')}</div>
      <div class="oobe-main">
        <h1>Make it yours</h1>
        <p>Pick a mode and a color. You can change these any time in Settings.</p>
        <div class="oobe-modes">
          <button class="oobe-mode light ${data.theme === 'light' ? 'sel' : ''}" data-t="light"><span></span>Light</button>
          <button class="oobe-mode dark ${data.theme === 'dark' ? 'sel' : ''}" data-t="dark"><span></span>Dark</button>
        </div>
        <div class="oobe-accents">${ACCENTS.slice(0, 14).map(c => `<button class="oobe-acc ${c === data.accent ? 'sel' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
      </div>`,
  ];
  let step = 0;

  function render() {
    el.innerHTML = `
      <div class="oobe-card">
        <div class="oobe-steps">${['Account', 'Password', 'Personalize'].map((s, i) => `<span class="${i === step ? 'cur' : i < step ? 'done' : ''}">${s}</span>`).join('')}</div>
        <div class="oobe-content">${steps[step]()}</div>
        <div class="oobe-foot">
          ${step > 0 ? '<button class="btn oobe-back">Back</button>' : '<span></span>'}
          <button class="btn primary oobe-next">${step === steps.length - 1 ? 'Finish' : 'Next'}</button>
        </div>
      </div>`;
    el.querySelector('.oobe-next').addEventListener('click', next);
    el.querySelector('.oobe-back')?.addEventListener('click', () => { collect(); step--; render(); });
    el.querySelectorAll('.oobe-mode').forEach(b => b.addEventListener('click', () => {
      data.theme = b.dataset.t; updateSettings({ theme: data.theme });
      el.querySelectorAll('.oobe-mode').forEach(x => x.classList.toggle('sel', x === b));
    }));
    el.querySelectorAll('.oobe-acc').forEach(b => b.addEventListener('click', () => {
      data.accent = b.dataset.c; updateSettings({ accent: data.accent });
      el.querySelectorAll('.oobe-acc').forEach(x => x.classList.toggle('sel', x === b));
    }));
    el.querySelectorAll('input').forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); }));
    setTimeout(() => el.querySelector('input')?.focus(), 50);
  }

  function collect() {
    if (step === 0) data.name = el.querySelector('#oobe-name').value.trim();
    if (step === 1) { data.pw = el.querySelector('#oobe-pw').value; data.hint = el.querySelector('#oobe-hint').value.trim(); }
  }

  async function next() {
    const err = el.querySelector('.oobe-err');
    collect();
    if (step === 0) {
      if (!data.name) { err.textContent = 'Please enter a name.'; return; }
      if (/[\\/:*?"<>|]/.test(data.name)) { err.textContent = 'A user name can\'t contain \\ / : * ? " < > |'; return; }
    }
    if (step === 1 && data.pw !== el.querySelector('#oobe-pw2').value) { err.textContent = 'The passwords don\'t match.'; return; }
    if (step < steps.length - 1) { step++; render(); return; }

    /* finish — request full screen while this click still counts as a user gesture */
    maybeFullscreen();
    updateSettings({
      userName: data.name,
      passwordHash: data.pw ? await hashPassword(data.pw) : null,
      passwordHint: data.hint || null,
      setupDone: true,
    });
    el.innerHTML = `<div class="oobe-final"><div class="of-text">Hi.</div><div class="of-sub">We're getting everything ready for you</div><div class="spinner"><span></span><span></span><span></span><span></span><span></span><span></span></div></div>`;
    const texts = ['Hi.', 'We\'re setting things up for you', 'This won\'t take long', 'Let\'s start'];
    let i = 0;
    const t = setInterval(() => { i++; if (texts[i]) el.querySelector('.of-text').textContent = texts[i]; }, 1100);
    setTimeout(() => {
      clearInterval(t);
      el.classList.add('hidden');
      el.innerHTML = '';
      renderLockUser();
      signIn(true);
    }, 4600);
  }
  render();
}

/* ---------------- power flows ---------------- */
const fire = (name) => window.dispatchEvent(new CustomEvent('webwin:' + name));

function fullscreenText(text, fade = true) {
  const sd = $('shutdown-screen');
  sd.classList.remove('hidden');
  sd.classList.toggle('fading', fade);
  sd.innerHTML = `<div class="spinner"><span></span><span></span><span></span><span></span><span></span><span></span></div><div class="sd-text" style="margin-top:40px">${esc(text)}</div>`;
  return sd;
}

async function leaveSession(kind) {
  if (busy) return false;
  const wasActive = !$('taskbar').classList.contains('hidden');
  if (wasActive) {
    const ok = await closeAll();
    if (!ok) {
      notify('Windows', `An app prevented ${kind === 'signout' ? 'signing out' : kind === 'restart' ? 'restarting' : 'shutting down'}. Save your work and try again.`, I.warning, { sound: 'warn' });
      return false;
    }
  }
  return true;
}

function initPowerFlows() {
  window.addEventListener('webwin:shutdown', async () => {
    if (!(await leaveSession('shutdown'))) return;
    busy = true;
    hideDesktop(); lock.classList.add('hidden');
    playSound('shutdown');
    const sd = fullscreenText('Shutting down');
    setTimeout(() => {
      sd.classList.remove('fading');
      sd.innerHTML = `<div class="sd-text">It's now safe to turn off your computer.</div><div class="sd-sub">(click anywhere or press a key to turn it back on)</div>`;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      const wake = () => {
        sd.removeEventListener('click', wake); document.removeEventListener('keydown', wake);
        sd.classList.add('hidden');
        signedInOnce = false;
        busy = false;
        boot();
      };
      sd.addEventListener('click', wake);
      setTimeout(() => document.addEventListener('keydown', wake), 300);
    }, 2200);
  });

  window.addEventListener('webwin:restart', async () => {
    if (!(await leaveSession('restart'))) return;
    busy = true;
    hideDesktop(); lock.classList.add('hidden');
    playSound('shutdown');
    const sd = fullscreenText('Restarting');
    setTimeout(() => {
      sd.classList.add('hidden');
      signedInOnce = false;
      busy = false;
      boot();
    }, 2200);
  });

  window.addEventListener('webwin:signout', async () => {
    if (!(await leaveSession('signout'))) return;
    busy = true;
    hideDesktop();
    const sd = fullscreenText('Signing out', false);
    sd.style.background = 'var(--accent)';
    setTimeout(() => {
      sd.classList.add('hidden'); sd.style.background = '';
      signedInOnce = false;
      busy = false;
      lockScreen(true);
    }, 1400);
  });

  window.addEventListener('webwin:lock', () => { if (!busy) lockScreen(); });

  window.addEventListener('webwin:sleep', () => {
    if (busy) return;
    const sessionWasActive = !$('taskbar').classList.contains('hidden');
    hideFlyout(); hideContextMenu();
    const sl = $('sleep-screen');
    sl.classList.remove('hidden');
    sl.classList.add('entering');
    let armed = false;
    setTimeout(() => { armed = true; }, 900);
    const wake = () => {
      if (!armed) return;
      sl.removeEventListener('pointerdown', wake); document.removeEventListener('keydown', wake, true);
      sl.classList.remove('entering');
      sl.classList.add('hidden');
      if (sessionWasActive && (settings.requireSignIn || settings.passwordHash)) lockScreen();
      else if (sessionWasActive) showDesktop();
    };
    sl.addEventListener('pointerdown', wake);
    document.addEventListener('keydown', wake, true);
  });
}

/* ---------------- misc ---------------- */
/* prevent the browser menu everywhere except text fields & iframes */
document.addEventListener('contextmenu', (e) => {
  if ((e.target.tagName === 'INPUT' && e.target.type !== 'range') || e.target.tagName === 'TEXTAREA') return;
  e.preventDefault();
});

/* stop the browser from opening files dropped outside a drop zone */
window.addEventListener('dragover', (e) => { if (!e.defaultPrevented) e.preventDefault(); });
window.addEventListener('drop', (e) => { if (!e.defaultPrevented) e.preventDefault(); });

/* small-screen guard */
function checkSize() {
  let el = $('too-small');
  if (innerWidth < 660 && !el) {
    el = document.createElement('div');
    el.id = 'too-small';
    el.innerHTML = 'This Windows needs a bigger window 🙂<br>Rotate your device or make the browser wider.';
    document.body.appendChild(el);
  } else if (innerWidth >= 660 && el) el.remove();
}
window.addEventListener('resize', checkSize);
checkSize();

/* ---------- GO ---------- */
await initFS();
if (!localStorage.getItem('webwin-installed')) { try { localStorage.setItem('webwin-installed', String(Date.now())); } catch { /* ignore */ } }
requestPersistence();
applySettings();
desktopApi = initDesktop();
initTaskbar();
initShell();
initLockHandlers();
initPowerFlows();
initClockService();

/* wallpaper may come from a picture in the file system */
onFSChange(() => { if (settings.wallpaper === 'picture') applySettings(); });
onSettingsChange((s, patch) => { if (patch && ('userName' in patch || 'passwordHash' in patch)) renderLockUser(); });

if (location.hash === '#skip') {
  /* dev fast-path: skip boot, setup & lock */
  if (!settings.setupDone) updateSettings({ setupDone: true });
  signedInOnce = true;
  showDesktop();
} else {
  boot();
}

