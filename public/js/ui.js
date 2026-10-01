/* UI primitives: context menu, modal dialogs, toasts/notifications, flyout manager. */
import { I } from './icons.js';

/* ---------- Flyout manager ---------- */
let openFlyoutEl = null;
let anchorEl = null;
let justClosed = 0;

export function showFlyout(el, anchor = null) {
  if (openFlyoutEl === el) { hideFlyout(); return false; }
  hideFlyout();
  openFlyoutEl = el;
  anchorEl = anchor;
  el.classList.add('open');
  if (anchor) anchor.classList.add('open');
  return true;
}
export function hideFlyout() {
  if (!openFlyoutEl) return;
  openFlyoutEl.classList.remove('open');
  if (anchorEl) anchorEl.classList.remove('open');
  openFlyoutEl = null;
  anchorEl = null;
  justClosed = Date.now();
}
export function flyoutJustClosed() { return Date.now() - justClosed < 220; }
export function getOpenFlyout() { return openFlyoutEl; }

document.addEventListener('pointerdown', (e) => {
  if (!openFlyoutEl) return;
  if (openFlyoutEl.contains(e.target)) return;
  if (anchorEl && anchorEl.contains(e.target)) return;
  hideFlyout();
}, true);

/* ---------- Context menu ---------- */
const ctxEl = document.getElementById('context-menu');
let openSubmenus = [];

export function hideContextMenu() {
  ctxEl.classList.add('hidden');
  ctxEl.innerHTML = '';
  openSubmenus.forEach(s => s.remove());
  openSubmenus = [];
}

function buildItems(container, items, x, y) {
  for (const it of items) {
    if (it === '-') { const sep = document.createElement('div'); sep.className = 'ctx-sep'; container.appendChild(sep); continue; }
    const row = document.createElement('div');
    row.className = 'ctx-item' + (it.disabled ? ' disabled' : '');
    const icon = it.icon ? `<span class="ci-icon">${it.icon}</span>` : '<span class="ci-icon"></span>';
    row.innerHTML = `${icon}<span>${it.label}</span>` +
      (it.checked ? '<span class="ci-check">✓</span>' : '') +
      (it.submenu ? '<span class="ci-sub-arrow">▶</span>' : '');
    if (it.submenu) {
      row.addEventListener('pointerenter', () => {
        openSubmenus.forEach(s => s.remove()); openSubmenus = [];
        const sub = document.createElement('div');
        sub.className = 'ctx-submenu';
        buildItems(sub, it.submenu);
        document.body.appendChild(sub);
        const r = row.getBoundingClientRect();
        const sr = sub.getBoundingClientRect();
        let sx = r.right - 4, sy = r.top - 5;
        if (sx + sr.width > innerWidth) sx = r.left - sr.width + 4;
        if (sy + sr.height > innerHeight) sy = innerHeight - sr.height - 4;
        sub.style.left = `${sx}px`; sub.style.top = `${sy}px`;
        openSubmenus.push(sub);
      });
    } else {
      row.addEventListener('pointerenter', () => { openSubmenus.forEach(s => s.remove()); openSubmenus = []; });
      if (!it.disabled && it.action) row.addEventListener('click', () => { hideContextMenu(); it.action(); });
    }
    container.appendChild(row);
  }
}

export function contextMenu(x, y, items) {
  hideContextMenu();
  ctxEl.innerHTML = '';
  buildItems(ctxEl, items);
  ctxEl.classList.remove('hidden');
  const r = ctxEl.getBoundingClientRect();
  let px = x, py = y;
  if (x + r.width > innerWidth) px = Math.max(0, x - r.width);
  if (y + r.height > innerHeight - 40) py = Math.max(0, y - r.height);
  ctxEl.style.left = `${px}px`;
  ctxEl.style.top = `${py}px`;
}

document.addEventListener('pointerdown', (e) => {
  if (!ctxEl.classList.contains('hidden') && !ctxEl.contains(e.target) && !openSubmenus.some(s => s.contains(e.target))) hideContextMenu();
}, true);
window.addEventListener('blur', hideContextMenu);

/* ---------- Modal dialogs ---------- */
const dlgLayer = document.getElementById('dialog-layer');

function showDialog({ title, bodyHTML, buttons = [{ label: 'OK', primary: true, value: true }], closeable = true }) {
  return new Promise((resolve) => {
    dlgLayer.classList.remove('hidden');
    dlgLayer.innerHTML = '';
    const dlg = document.createElement('div');
    dlg.className = 'dlg';
    dlg.innerHTML = `
      <div class="dlg-title">${title}</div>
      <div class="dlg-body">${bodyHTML}</div>
      <div class="dlg-footer"></div>`;
    const footer = dlg.querySelector('.dlg-footer');
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'btn' + (b.primary ? ' primary' : '');
      btn.textContent = b.label;
      btn.addEventListener('click', () => { close(); resolve(b.value); });
      footer.appendChild(btn);
    }
    dlgLayer.appendChild(dlg);
    function close() { dlgLayer.classList.add('hidden'); dlgLayer.innerHTML = ''; }
    if (closeable) dlgLayer.addEventListener('pointerdown', function onOuter(e) {
      if (e.target === dlgLayer) { dlgLayer.removeEventListener('pointerdown', onOuter); close(); resolve(null); }
    });
    dlg.__close = close;
    dlgLayer.__dialog = dlg;
  });
}

export function msgDialog(title, message) {
  return showDialog({ title, bodyHTML: `<div class="selectable">${message}</div>` });
}
export function confirmDialog(title, message, yesLabel = 'Yes', noLabel = 'No') {
  return showDialog({
    title, bodyHTML: `<div>${message}</div>`,
    buttons: [{ label: yesLabel, primary: true, value: true }, { label: noLabel, value: false }]
  });
}
/* input dialog with live value capture */
export function promptDialog(title, label, value = '', placeholder = '') {
  return new Promise((resolve) => {
    dlgLayer.classList.remove('hidden');
    dlgLayer.innerHTML = '';
    const dlg = document.createElement('div');
    dlg.className = 'dlg';
    dlg.innerHTML = `
      <div class="dlg-title">${title}</div>
      <div class="dlg-body"><label>${label}</label><input type="text" value="${String(value).replace(/"/g, '&quot;')}" placeholder="${placeholder}" spellcheck="false"></div>
      <div class="dlg-footer"></div>`;
    const input = dlg.querySelector('input');
    const footer = dlg.querySelector('.dlg-footer');
    const finish = (val) => { dlgLayer.classList.add('hidden'); dlgLayer.innerHTML = ''; resolve(val); };
    const okBtn = document.createElement('button');
    okBtn.className = 'btn primary'; okBtn.textContent = 'OK';
    okBtn.addEventListener('click', () => finish(input.value.trim()));
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn'; cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => finish(null));
    footer.append(okBtn, cancelBtn);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(input.value.trim());
      if (e.key === 'Escape') finish(null);
    });
    dlgLayer.appendChild(dlg);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/* ---------- Notifications ---------- */
const notifs = [];
const notifListeners = [];

export function getNotifs() { return notifs; }
export function onNotif(cb) { notifListeners.push(cb); }
export function clearNotifs() { notifs.length = 0; notifListeners.forEach(cb => cb()); }

export function notify(title, body = '', icon = I.windows) {
  const n = { title, body, icon, time: Date.now() };
  notifs.unshift(n);
  if (notifs.length > 30) notifs.pop();
  notifListeners.forEach(cb => cb());

  const toasts = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span class="t-icon">${icon}</span><div><div class="t-title">${title}</div>${body ? `<div class="t-body">${body}</div>` : ''}</div><span class="t-x">✕</span>`;
  t.querySelector('.t-x').addEventListener('click', () => dismiss());
  const dismiss = () => { t.classList.add('out'); setTimeout(() => t.remove(), 220); };
  toasts.appendChild(t);
  setTimeout(dismiss, 4600);
}

/* clamp helper */
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
