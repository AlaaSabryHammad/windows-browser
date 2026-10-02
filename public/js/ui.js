/* UI primitives: context menu, modal dialogs, toasts/notifications, flyout manager. */
import { I } from './icons.js';
import { settings } from './settings.js';
import { playSound } from './sound.js';

/* escape text before putting it into innerHTML */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* ---------- Flyout manager ---------- */
let openFlyoutEl = null;
let anchorEl = null;
let justClosed = 0;
const flyoutListeners = new Set();
export function onFlyoutChange(cb) { flyoutListeners.add(cb); }

export function showFlyout(el, anchor = null) {
  if (openFlyoutEl === el) { hideFlyout(); return false; }
  hideFlyout();
  openFlyoutEl = el;
  anchorEl = anchor;
  el.classList.add('open');
  if (anchor) anchor.classList.add('open');
  flyoutListeners.forEach(cb => cb(el));
  return true;
}
export function hideFlyout() {
  if (!openFlyoutEl) return;
  const el = openFlyoutEl;
  openFlyoutEl.classList.remove('open');
  if (anchorEl) anchorEl.classList.remove('open');
  openFlyoutEl = null;
  anchorEl = null;
  justClosed = Date.now();
  flyoutListeners.forEach(cb => cb(null, el));
}
export function flyoutJustClosed() { return Date.now() - justClosed < 220; }
export function getOpenFlyout() { return openFlyoutEl; }

document.addEventListener('pointerdown', (e) => {
  if (!openFlyoutEl) return;
  if (openFlyoutEl.contains(e.target)) return;
  if (anchorEl && anchorEl.contains(e.target)) return;
  if (e.target.closest('#context-menu, .ctx-submenu, #dialog-layer')) return;
  hideFlyout();
}, true);

/* ---------- Context menu ---------- */
const ctxEl = document.getElementById('context-menu');
let openSubmenus = [];
let ctxRows = [];
let ctxIndex = -1;

export function hideContextMenu() {
  ctxEl.classList.add('hidden');
  ctxEl.innerHTML = '';
  openSubmenus.forEach(s => s.remove());
  openSubmenus = [];
  ctxRows = [];
  ctxIndex = -1;
}
export const isContextMenuOpen = () => !ctxEl.classList.contains('hidden');

function buildItems(container, items) {
  const rows = [];
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { const sep = document.createElement('div'); sep.className = 'ctx-sep'; container.appendChild(sep); continue; }
    const row = document.createElement('div');
    row.className = 'ctx-item' + (it.disabled ? ' disabled' : '') + (it.bold ? ' bold' : '');
    const icon = it.icon ? `<span class="ci-icon">${it.icon}</span>` : '<span class="ci-icon"></span>';
    row.innerHTML = `${icon}<span class="ci-label">${esc(it.label)}</span>` +
      (it.hint ? `<span class="ci-hint">${esc(it.hint)}</span>` : '') +
      (it.checked ? '<span class="ci-check">✓</span>' : '') +
      (it.submenu ? '<span class="ci-sub-arrow">▶</span>' : '');
    const openSub = () => {
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
    };
    if (it.submenu) {
      row.addEventListener('pointerenter', openSub);
      row.addEventListener('click', openSub);
      row._open = openSub;
    } else {
      if (container === ctxEl) row.addEventListener('pointerenter', () => { openSubmenus.forEach(s => s.remove()); openSubmenus = []; });
      if (!it.disabled && it.action) {
        row.addEventListener('click', () => { hideContextMenu(); it.action(); });
        row._act = () => { hideContextMenu(); it.action(); };
      }
    }
    container.appendChild(row);
    if (!it.disabled) rows.push(row);
  }
  return rows;
}

export function contextMenu(x, y, items) {
  hideContextMenu();
  ctxEl.innerHTML = '';
  ctxRows = buildItems(ctxEl, items);
  ctxEl.classList.remove('hidden');
  const r = ctxEl.getBoundingClientRect();
  let px = x, py = y;
  if (x + r.width > innerWidth) px = Math.max(0, x - r.width);
  if (y + r.height > innerHeight - 40) py = Math.max(0, y - r.height);
  ctxEl.style.left = `${px}px`;
  ctxEl.style.top = `${py}px`;
}

/* keyboard navigation for the context menu */
document.addEventListener('keydown', (e) => {
  if (!isContextMenuOpen()) return;
  const move = (d) => {
    if (!ctxRows.length) return;
    ctxRows.forEach(r => r.classList.remove('kb'));
    ctxIndex = (ctxIndex + d + ctxRows.length) % ctxRows.length;
    ctxRows[ctxIndex].classList.add('kb');
  };
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideContextMenu(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(-1); }
  else if (e.key === 'Enter' || e.key === 'ArrowRight') {
    const row = ctxRows[ctxIndex];
    if (!row) return;
    e.preventDefault(); e.stopPropagation();
    if (row._act && e.key === 'Enter') row._act();
    else if (row._open) row._open();
  }
}, true);

document.addEventListener('pointerdown', (e) => {
  if (!ctxEl.classList.contains('hidden') && !ctxEl.contains(e.target) && !openSubmenus.some(s => s.contains(e.target))) hideContextMenu();
}, true);
window.addEventListener('blur', () => { if (!document.activeElement || document.activeElement.tagName !== 'IFRAME') hideContextMenu(); });

/* ---------- Modal dialogs (stackable) ---------- */
const dlgLayer = document.getElementById('dialog-layer');
const DLG_ICONS = { info: I.infoBlue, warn: I.warning, error: I.error, question: I.question };

/* Mount a .dlg element as a modal. onCancel runs on Escape. Returns close(). */
export function mountDialog(dlg, { onCancel = null, onEnter = null } = {}) {
  const back = document.createElement('div');
  back.className = 'dlg-back';
  back.appendChild(dlg);
  dlgLayer.appendChild(back);
  dlgLayer.classList.remove('hidden');
  hideContextMenu();

  /* clicking outside a modal dialog flashes it, like Windows */
  back.addEventListener('pointerdown', (e) => {
    if (e.target !== back) return;
    playSound('ding');
    dlg.classList.remove('flash'); void dlg.offsetWidth; dlg.classList.add('flash');
  });

  /* drag by the title bar */
  const title = dlg.querySelector('.dlg-title');
  if (title) {
    let sx, sy, ox = 0, oy = 0, drag = false;
    title.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      drag = true; sx = e.clientX - ox; sy = e.clientY - oy; title.setPointerCapture(e.pointerId);
    });
    title.addEventListener('pointermove', (e) => {
      if (!drag) return;
      ox = e.clientX - sx; oy = e.clientY - sy;
      dlg.style.transform = `translate(${ox}px, ${oy}px)`;
    });
    title.addEventListener('pointerup', () => { drag = false; });
    const x = document.createElement('button');
    x.className = 'dlg-x'; x.title = 'Close';
    x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5.5 5.5 L18.5 18.5 M18.5 5.5 L5.5 18.5" stroke="currentColor" stroke-width="1.6"/></svg>';
    x.addEventListener('click', () => { if (onCancel) onCancel(); else close(); });
    title.appendChild(x);
  }

  const onKey = (e) => {
    if (dlgLayer.lastElementChild !== back) return;
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); e.stopPropagation(); onCancel(); }
    if (e.key === 'Enter' && onEnter && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); onEnter(); }
  };
  document.addEventListener('keydown', onKey, true);

  function close() {
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    if (!dlgLayer.children.length) dlgLayer.classList.add('hidden');
  }
  return close;
}
export const isDialogOpen = () => dlgLayer.children.length > 0;

/* Generic dialog. buttons: [{label, value, primary}] — resolves with the clicked value (cancel → cancelValue). */
export function dialog({ title, bodyHTML, buttons = [{ label: 'OK', primary: true, value: true }], icon = null, cancelValue = null, width = null }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('div');
    dlg.className = 'dlg';
    if (width) dlg.style.width = width + 'px';
    dlg.innerHTML = `
      <div class="dlg-title">${esc(title)}</div>
      <div class="dlg-body">${icon && DLG_ICONS[icon] ? `<div class="dlg-icon">${DLG_ICONS[icon]}</div>` : ''}<div class="dlg-msg">${bodyHTML}</div></div>
      <div class="dlg-footer"></div>`;
    const footer = dlg.querySelector('.dlg-footer');
    let close;
    const finish = (v) => { close(); resolve(v); };
    let primaryBtn = null;
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'btn' + (b.primary ? ' primary' : '');
      btn.textContent = b.label;
      btn.addEventListener('click', () => finish(b.value));
      footer.appendChild(btn);
      if (b.primary) primaryBtn = btn;
    }
    close = mountDialog(dlg, { onCancel: () => finish(cancelValue) });
    if (icon === 'error') playSound('error');
    else if (icon === 'warn') playSound('warn');
    else if (icon) playSound('ding');
    setTimeout(() => (primaryBtn || footer.querySelector('button'))?.focus(), 30);
  });
}

/* message may contain HTML — escape user-provided parts with esc() */
export function msgDialog(title, message, icon = null) {
  return dialog({ title, bodyHTML: `<div class="selectable">${message}</div>`, icon, cancelValue: true });
}
export function confirmDialog(title, message, yesLabel = 'Yes', noLabel = 'No', icon = null) {
  return dialog({
    title, bodyHTML: `<div>${message}</div>`, icon, cancelValue: false,
    buttons: [{ label: yesLabel, primary: true, value: true }, { label: noLabel, value: false }]
  });
}
/* input dialog */
export function promptDialog(title, label, value = '', placeholder = '', { password = false, validate = null } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('div');
    dlg.className = 'dlg';
    dlg.innerHTML = `
      <div class="dlg-title">${esc(title)}</div>
      <div class="dlg-body"><div class="dlg-msg"><label>${esc(label)}</label><input type="${password ? 'password' : 'text'}" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false"><div class="dlg-err"></div></div></div>
      <div class="dlg-footer"></div>`;
    const input = dlg.querySelector('input');
    const err = dlg.querySelector('.dlg-err');
    const footer = dlg.querySelector('.dlg-footer');
    let close;
    const finish = (val) => { close(); resolve(val); };
    const submit = () => {
      const v = password ? input.value : input.value.trim();
      if (validate) {
        const msg = validate(v);
        if (msg) { err.textContent = msg; playSound('ding'); input.focus(); return; }
      }
      finish(v);
    };
    const okBtn = document.createElement('button');
    okBtn.className = 'btn primary'; okBtn.textContent = 'OK';
    okBtn.addEventListener('click', submit);
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn'; cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => finish(null));
    footer.append(okBtn, cancelBtn);
    close = mountDialog(dlg, { onCancel: () => finish(null), onEnter: submit });
    setTimeout(() => {
      input.focus();
      const dot = value.lastIndexOf('.');
      if (dot > 0 && !password) input.setSelectionRange(0, dot); else input.select();
    }, 30);
  });
}

/* ---------- Notifications ---------- */
const notifs = [];
const notifListeners = new Set();

export function getNotifs() { return notifs; }
export function onNotif(cb) { notifListeners.add(cb); }
export function clearNotifs() { notifs.length = 0; notifListeners.forEach(cb => cb()); }
export function dismissNotif(n) {
  const i = notifs.indexOf(n);
  if (i >= 0) { notifs.splice(i, 1); notifListeners.forEach(cb => cb()); }
}

/* title/body are plain text. opts: { onClick, silent, actions:[{label, action}], sticky } */
export function notify(title, body = '', icon = I.windows, opts = {}) {
  const n = { title, body, icon, time: Date.now(), onClick: opts.onClick || null };
  notifs.unshift(n);
  if (notifs.length > 30) notifs.pop();
  notifListeners.forEach(cb => cb());

  /* Focus assist: straight to the action center, no banner, no sound */
  if (settings.dnd && !opts.urgent) return n;
  if (!opts.silent) playSound(opts.sound || 'notify', !!opts.urgent);

  const toasts = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span class="t-icon">${icon}</span><div class="t-content"><div class="t-title">${esc(title)}</div>${body ? `<div class="t-body">${esc(body)}</div>` : ''}<div class="t-actions"></div></div><span class="t-x">✕</span>`;
  const dismiss = () => { t.classList.add('out'); setTimeout(() => t.remove(), 220); };
  t.querySelector('.t-x').addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
  const acts = t.querySelector('.t-actions');
  for (const a of opts.actions || []) {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = a.label;
    b.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); dismissNotif(n); a.action(); });
    acts.appendChild(b);
  }
  if (n.onClick) t.addEventListener('click', () => { dismiss(); dismissNotif(n); n.onClick(); });
  toasts.appendChild(t);
  if (!opts.sticky) setTimeout(dismiss, 5200);
  return n;
}

/* clamp helper */
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* relative time for notifications etc. */
export function timeAgo(t) {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
