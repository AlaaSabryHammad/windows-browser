/* Boot sequence: boot → lock → sign-in → desktop. Also shutdown/restart/lock flows. */
import { initFS } from './fs.js';
import { settings, applySettings } from './settings.js';
import { initDesktop } from './desktop.js';
import { initTaskbar } from './taskbar.js';
import { notify } from './ui.js';
import { I } from './icons.js';

const $ = (id) => document.getElementById(id);

function startDesktop() {
  $('desktop-root').classList.remove('hidden');
  $('taskbar').classList.remove('hidden');
}

function lockScreen() {
  const lock = $('lock-screen');
  lock.classList.remove('hidden');
  lock.classList.remove('show-login');
  document.querySelector('.lock-login').classList.add('hidden');
  document.querySelector('.lock-clock').style.display = '';
  document.querySelector('.lock-hint').style.display = '';
}

function boot() {
  const bootEl = $('boot-screen');
  bootEl.classList.remove('hidden');
  setTimeout(() => {
    bootEl.classList.add('hidden');
    lockScreen();
  }, 2600);
}

function initLockHandlers() {
  const lock = $('lock-screen');
  const toLogin = () => {
    if (!lock.classList.contains('show-login')) {
      lock.classList.add('show-login');
      document.querySelector('.lock-login').classList.remove('hidden');
    }
  };
  lock.addEventListener('click', toLogin);
  document.addEventListener('keydown', (e) => {
    if (lock.classList.contains('hidden')) return;
    if (!lock.classList.contains('show-login')) { toLogin(); return; }
    if (e.key === 'Enter' && !document.querySelector('.lock-login').classList.contains('hidden')) signIn();
  });

  function signIn() {
    const welcome = document.createElement('div');
    welcome.className = 'lock-welcome';
    welcome.innerHTML = `<div class="spinner"><span></span><span></span><span></span><span></span><span></span><span></span></div><div class="wtext">Welcome</div>`;
    lock.appendChild(welcome);
    setTimeout(() => {
      lock.classList.add('hidden');
      lock.classList.remove('show-login');
      welcome.remove();
      startDesktop();
      setTimeout(() => {
        notify('Welcome to Windows 10 Web', 'Right-click the desktop, explore the Start menu, drag windows to the edges to snap. Enjoy!', I.start);
      }, 900);
    }, 1300);
  }
  $('signin-btn').addEventListener('click', (e) => { e.stopPropagation(); signIn(); });
}

function initPowerFlows() {
  const shutdown = (restart) => {
    const sd = $('shutdown-screen');
    sd.classList.remove('hidden');
    sd.classList.add('fading');
    sd.innerHTML = `<div class="spinner"><span></span><span></span><span></span><span></span><span></span><span></span></div>
                    <div class="sd-text" style="margin-top:40px">Shutting down…</div>`;
    setTimeout(() => {
      if (restart) {
        sd.classList.add('hidden');
        sd.classList.remove('fading');
        $('desktop-root').classList.add('hidden');
        $('taskbar').classList.add('hidden');
        boot();
      } else {
        sd.classList.remove('fading');
        sd.innerHTML = `<div class="sd-text">It's now safe to turn off your computer.</div>
                        <div class="sd-sub">(or click anywhere to boot it up again)</div>`;
        sd.addEventListener('click', () => {
          sd.classList.add('hidden');
          $('desktop-root').classList.add('hidden');
          $('taskbar').classList.add('hidden');
          boot();
        }, { once: true });
      }
    }, 1800);
  };
  window.addEventListener('webwin:shutdown', () => shutdown(false));
  window.addEventListener('webwin:restart', () => shutdown(true));
  window.addEventListener('webwin:lock', () => {
    hideAllAndLock();
  });

  function hideAllAndLock() {
    $('desktop-root').classList.add('hidden');
    $('taskbar').classList.add('hidden');
    lockScreen();
  }
}

/* prevent default context menu everywhere except text fields & iframes */
document.addEventListener('contextmenu', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.closest('iframe')) return;
  e.preventDefault();
});

/* small-screen guard */
function checkSize() {
  let el = $('too-small');
  if (innerWidth < 660 && !el) {
    el = document.createElement('div');
    el.id = 'too-small';
    el.innerHTML = 'This Windows needs a bigger window 🙂<br>Resize your browser and refresh.';
    document.body.appendChild(el);
  } else if (innerWidth >= 660 && el) el.remove();
}
window.addEventListener('resize', checkSize);
checkSize();

/* ---------- GO ---------- */
initFS();
applySettings();
initDesktop();
initTaskbar();
initLockHandlers();
initPowerFlows();

if (location.hash === '#skip') {
  /* dev fast-path: skip boot & lock */
  $('boot-screen').classList.add('hidden');
  $('lock-screen').classList.add('hidden');
  startDesktop();
} else {
  boot();
}
