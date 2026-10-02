/* Shell: global keyboard shortcuts, Alt+Tab switcher, Ctrl+Alt+Del screen, Shut Down dialog, winver. */
import { launch, APPS } from './apps/registry.js';
import { getFocused, minimizeAll, keySnap, mruList, thumbnailFor, appWindows } from './wm.js';
import { toggleStart, isStartOpen } from './startmenu.js';
import { toggleTaskView, toggleActionCenter, focusSearch, toggleFullscreen } from './taskbar.js';
import { mountDialog, esc, contextMenu, hideFlyout, isDialogOpen, dialog } from './ui.js';
import { settings } from './settings.js';
import { I } from './icons.js';

const fire = (name) => window.dispatchEvent(new CustomEvent('webwin:' + name));
const sessionActive = () => !document.getElementById('taskbar').classList.contains('hidden') &&
  document.getElementById('lock-screen').classList.contains('hidden') && !document.querySelector('.fullscreen-overlay:not(.hidden)');

/* ---------------- winver ---------------- */
export function showWinver() {
  dialog({
    title: 'About Windows',
    width: 470,
    bodyHTML: `
      <div class="winver">
        <div class="wv-logo">${I.windows.replace('<svg', '<svg width="54" height="54" style="color:#0078d7"')}<span>Windows 10</span></div>
        <hr>
        <div>Windows 10 Web Edition<br>Version 22H2 (OS Build 19045.web)<br>A from-scratch re-creation that runs entirely in your browser.</div>
        <p>Windows 10 Web is not affiliated with Microsoft. Built with plain HTML, CSS and JavaScript.</p>
        <p>This product is licensed to:<br><b>${esc(settings.userName)}</b></p>
      </div>`,
    cancelValue: true,
  });
}

/* ---------------- Shut Down Windows dialog (Alt+F4 on the desktop) ---------------- */
export function showShutdownDialog() {
  const dlg = document.createElement('div');
  dlg.className = 'dlg sd-dlg';
  dlg.innerHTML = `
    <div class="dlg-title">Shut Down Windows</div>
    <div class="sd-banner">${I.windows.replace('<svg', '<svg width="36" height="36"')}<span>Windows 10</span></div>
    <div class="dlg-body"><div class="dlg-msg">
      <label>What do you want the computer to do?</label>
      <select class="set-select sd-what">
        <option value="signout">Sign out</option>
        <option value="sleep">Sleep</option>
        <option value="shutdown" selected>Shut down</option>
        <option value="restart">Restart</option>
      </select>
      <div class="sd-desc"></div>
    </div></div>
    <div class="dlg-footer"><button class="btn primary">OK</button><button class="btn">Cancel</button></div>`;
  const sel = dlg.querySelector('.sd-what');
  const desc = dlg.querySelector('.sd-desc');
  const DESC = {
    signout: 'Closes all apps and signs you out.',
    sleep: 'The PC stays on but uses low power. Apps stay open so when the PC wakes up, you\'re instantly back to where you left off.',
    shutdown: 'Closes all apps and turns off the PC.',
    restart: 'Closes all apps, turns off the PC, and then turns it on again.',
  };
  const upd = () => { desc.textContent = DESC[sel.value]; };
  sel.addEventListener('change', upd); upd();
  let close;
  const ok = () => { const v = sel.value; close(); fire(v); };
  close = mountDialog(dlg, { onCancel: () => close(), onEnter: ok });
  const [okBtn, cancelBtn] = dlg.querySelectorAll('.dlg-footer .btn');
  okBtn.addEventListener('click', ok);
  cancelBtn.addEventListener('click', () => close());
  setTimeout(() => sel.focus(), 30);
}

/* ---------------- Ctrl+Alt+Del security screen ---------------- */
export function showSecurityScreen() {
  if (document.getElementById('sas-screen')) return;
  const el = document.createElement('div');
  el.id = 'sas-screen';
  el.className = 'fullscreen-overlay';
  el.innerHTML = `
    <div class="sas-list">
      <button data-a="lock">Lock</button>
      <button data-a="switch">Switch user</button>
      <button data-a="signout">Sign out</button>
      <button data-a="password">Change a password</button>
      <button data-a="taskmgr">Task Manager</button>
    </div>
    <button class="btn sas-cancel">Cancel</button>
    <div class="sas-icons"><span>${I.wifi}</span><span class="sas-power" title="Power">${I.power}</span></div>`;
  document.body.appendChild(el);
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  el.querySelector('.sas-cancel').addEventListener('click', close);
  el.querySelectorAll('.sas-list button').forEach(b => b.addEventListener('click', () => {
    close();
    const a = b.dataset.a;
    if (a === 'lock' || a === 'switch') fire('lock');
    else if (a === 'signout') fire('signout');
    else if (a === 'taskmgr') launch('taskmgr');
    else if (a === 'password') launch('settings', { page: 'accounts' });
  }));
  el.querySelector('.sas-power').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left - 120, r.top - 110, [
      { label: 'Sleep', action: () => { close(); fire('sleep'); } },
      { label: 'Shut down', action: () => { close(); fire('shutdown'); } },
      { label: 'Restart', action: () => { close(); fire('restart'); } },
    ]);
  });
}

/* ---------------- Win+X quick link menu ---------------- */
function quickLinkMenu() {
  contextMenu(4, innerHeight - 40 - 420, [
    { label: 'Apps and Features', action: () => launch('settings', { page: 'apps' }) },
    { label: 'System', action: () => launch('settings', { page: 'about' }) },
    { label: 'Task Manager', action: () => launch('taskmgr') },
    { label: 'Settings', action: () => launch('settings') },
    { label: 'File Explorer', action: () => launch('explorer') },
    { label: 'Search', action: () => focusSearch() },
    { label: 'Run', action: () => launch('run') },
    '-',
    { label: 'Command Prompt', action: () => launch('terminal') },
    '-',
    { label: 'Shut down or sign out', submenu: [
      { label: 'Sign out', action: () => fire('signout') },
      { label: 'Sleep', action: () => fire('sleep') },
      { label: 'Shut down', action: () => fire('shutdown') },
      { label: 'Restart', action: () => fire('restart') },
    ] },
    { label: 'Desktop', action: minimizeAll },
  ]);
}

/* ---------------- Alt+Tab ---------------- */
let switcher = null;   /* { el, wins, idx } */
function openSwitcher(dir) {
  const wins = mruList();
  if (!wins.length) return;
  const el = document.createElement('div');
  el.id = 'alttab';
  document.body.appendChild(el);
  switcher = { el, wins, idx: wins.length > 1 ? (dir > 0 ? 1 : wins.length - 1) : 0 };
  renderSwitcher();
}
function renderSwitcher() {
  const { el, wins, idx } = switcher;
  el.innerHTML = '<div class="at-row"></div>';
  const row = el.firstChild;
  wins.forEach((w, i) => {
    const card = document.createElement('div');
    card.className = 'at-card' + (i === idx ? ' sel' : '');
    card.innerHTML = `<div class="at-title"><span class="at-ic">${w.opts.icon || ''}</span><span>${esc(w.title)}</span></div><div class="at-thumb"></div>`;
    card.querySelector('.at-thumb').appendChild(thumbnailFor(w, 220, 140));
    card.addEventListener('pointerdown', (e) => { e.preventDefault(); switcher.idx = i; commitSwitcher(); });
    row.appendChild(card);
  });
}
function stepSwitcher(dir) {
  switcher.idx = (switcher.idx + dir + switcher.wins.length) % switcher.wins.length;
  switcher.el.querySelectorAll('.at-card').forEach((c, i) => c.classList.toggle('sel', i === switcher.idx));
}
function commitSwitcher() {
  if (!switcher) return;
  const w = switcher.wins[switcher.idx];
  switcher.el.remove();
  switcher = null;
  if (w) w.focus();
}
function cancelSwitcher() { if (switcher) { switcher.el.remove(); switcher = null; } }

/* ---------------- keyboard ---------------- */
export function initShell() {
  let metaDown = false, metaCombo = false;

  document.addEventListener('keydown', (e) => {
    if (!sessionActive()) return;
    const k = e.key;
    const lower = k.length === 1 ? k.toLowerCase() : k;

    /* Alt+Tab (works for real in full screen with keyboard lock) and Alt+` as an in-browser fallback */
    if (e.altKey && (k === 'Tab' || k === '`')) {
      e.preventDefault();
      if (!switcher) openSwitcher(e.shiftKey ? -1 : 1);
      else stepSwitcher(e.shiftKey ? -1 : 1);
      return;
    }
    if (switcher) {
      if (k === 'Escape') { e.preventDefault(); cancelSwitcher(); }
      else if (k === 'ArrowRight') { e.preventDefault(); stepSwitcher(1); }
      else if (k === 'ArrowLeft') { e.preventDefault(); stepSwitcher(-1); }
      else if (k === 'Enter') { e.preventDefault(); commitSwitcher(); }
      return;
    }

    if (k === 'Meta' || k === 'OS') { metaDown = true; metaCombo = false; return; }

    if (e.metaKey || metaDown) {
      metaCombo = true;
      const actions = {
        d: () => minimizeAll(), m: () => minimizeAll(), e: () => launch('explorer'), r: () => launch('run'), i: () => launch('settings'),
        l: () => fire('lock'), a: () => toggleActionCenter(), s: () => focusSearch(), q: () => focusSearch(), x: () => quickLinkMenu(),
        Tab: () => toggleTaskView(), Pause: () => launch('settings', { page: 'about' }),
        ArrowUp: () => keySnap(getFocused(), 'up'), ArrowDown: () => keySnap(getFocused(), 'down'),
        ArrowLeft: () => keySnap(getFocused(), 'left'), ArrowRight: () => keySnap(getFocused(), 'right'),
      };
      const fn = actions[lower] || actions[k];
      if (fn) { e.preventDefault(); hideFlyout(); fn(); return; }
      if (/^[1-9]$/.test(k)) {
        e.preventDefault();
        const id = settings.pinned[+k - 1];
        if (id && APPS[id]) {
          const ws = appWindows(id);
          if (ws.length) { const w = ws[0]; w === getFocused() && !w.minimized ? w.minimize() : w.focus(); }
          else launch(id);
        }
        return;
      }
    }

    if (e.altKey && k === 'F4') {
      e.preventDefault();
      if (isDialogOpen()) return;
      const w = getFocused();
      if (w) w.close(); else showShutdownDialog();
      return;
    }
    if (e.ctrlKey && e.shiftKey && k === 'Escape') { e.preventDefault(); launch('taskmgr'); return; }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && k === 'Escape') { e.preventDefault(); e.stopPropagation(); toggleStart(null); return; }
    if (e.ctrlKey && e.altKey && (k === 'Delete' || k === 'End')) { e.preventDefault(); showSecurityScreen(); return; }
    if (k === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
    if (k === 'PrintScreen') { e.preventDefault(); import('./apps/camera.js').then(m => m.screenshot && m.screenshot()); return; }

    /* typing while Start is open goes to search, like Windows */
    if (isStartOpen() && k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && k !== ' ') {
      e.preventDefault();
      toggleStart(false);
      focusSearch(k);
    }
  }, true);

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Meta' || e.key === 'OS') {
      const tap = metaDown && !metaCombo;
      metaDown = false;
      if (tap && sessionActive()) toggleStart(null);
    }
    if (e.key === 'Alt' && switcher) commitSwitcher();
  }, true);
  window.addEventListener('blur', () => { metaDown = false; if (switcher) commitSwitcher(); });
}
