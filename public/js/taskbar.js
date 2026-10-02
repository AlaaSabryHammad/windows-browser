/* Taskbar: start, search, task view, app buttons (+previews), tray (real network/battery/volume), clock/calendar, action center. */
import { APPS, launch } from './apps/registry.js';
import { on as onWm, windowList, mruList, appWindows, getFocused, minimizeAll, thumbnailFor } from './wm.js';
import { showFlyout, hideFlyout, getOpenFlyout, contextMenu, notify, getNotifs, clearNotifs, dismissNotif, onNotif, esc, timeAgo } from './ui.js';
import { settings, updateSettings, onSettingsChange } from './settings.js';
import { initStartMenu, toggleStart, isStartOpen } from './startmenu.js';
import { walk, ROOT } from './fs.js';
import { iconFor, openPath } from './fileops.js';
import { playSound } from './sound.js';
import { I } from './icons.js';

export function formatTime(d, seconds = settings.clockSeconds) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: !settings.clock24 });
}

export const SETTINGS_SEARCH = [
  { name: 'Change desktop background', page: 'personalization', keys: 'wallpaper background picture theme' },
  { name: 'Choose your accent color', page: 'personalization', keys: 'color accent dark light mode transparency' },
  { name: 'Display settings', page: 'system', keys: 'display resolution brightness night light screen' },
  { name: 'Sound settings', page: 'system', keys: 'sound volume audio mute' },
  { name: 'Storage', page: 'storage', keys: 'storage disk space drive' },
  { name: 'Battery', page: 'system', keys: 'battery power' },
  { name: 'About your PC', page: 'about', keys: 'about pc name specs version processor ram system info winver' },
  { name: 'Your info', page: 'accounts', keys: 'account user name profile' },
  { name: 'Sign-in options', page: 'accounts', keys: 'password sign in pin lock' },
  { name: 'Date & time', page: 'time', keys: 'date time clock 24 hour format' },
  { name: 'Startup apps', page: 'apps', keys: 'startup apps launch boot' },
  { name: 'Taskbar settings', page: 'personalization', keys: 'taskbar search box' },
  { name: 'Windows Update', page: 'update', keys: 'update upgrade reset recovery' },
  { name: 'Focus assist', page: 'system', keys: 'focus assist notifications do not disturb' },
];

let api = {};
export const openTaskView = () => api.openTaskView && api.openTaskView();
export const toggleTaskView = () => api.toggleTaskView && api.toggleTaskView();
export const toggleActionCenter = () => api.toggleActionCenter && api.toggleActionCenter();
export const focusSearch = (text) => api.focusSearch && api.focusSearch(text);
export const toggleFullscreen = () => api.toggleFullscreen && api.toggleFullscreen();

export function initTaskbar() {
  initStartMenu();
  const tb = document.getElementById('taskbar');
  tb.innerHTML = `
    <div class="tb-start" title="Start">${I.start}</div>
    <div class="tb-search" title="Search">${I.search}<input type="text" placeholder="Type here to search" spellcheck="false"></div>
    <div class="tb-taskview" title="Task View">${I.taskview}</div>
    <div id="tb-apps"></div>
    <div id="tb-tray">
      <div class="tb-tray-item tray-hidden" title="Show hidden icons">${I.chevUp}</div>
      <div class="tb-tray-item tray-bat hidden" title="Battery"></div>
      <div class="tb-tray-item tray-net" title="Network"></div>
      <div class="tb-tray-item tray-vol" title="Speakers"></div>
      <div class="tb-tray-item tray-eng" title="Input language">ENG</div>
      <div class="tb-tray-item tray-clock" id="tb-clock"><span class="t"></span><span class="d"></span></div>
      <div class="tb-tray-item tray-notif" title="Notifications">${I.bell}<span class="badge hidden"></span></div>
      <div id="tb-showdesktop" title="Show desktop"></div>
    </div>`;

  /* ---------------- search box style ---------------- */
  const searchBox = tb.querySelector('.tb-search');
  function applySearchMode() {
    searchBox.classList.toggle('icon-only', settings.searchMode === 'icon');
    searchBox.classList.toggle('hidden', settings.searchMode === 'hidden');
  }
  applySearchMode();

  /* ---------------- clock ---------------- */
  const clockEl = tb.querySelector('#tb-clock');
  const timeEl = clockEl.querySelector('.t');
  const dateEl = clockEl.querySelector('.d');
  function tick() {
    const now = new Date();
    timeEl.textContent = formatTime(now);
    dateEl.textContent = now.toLocaleDateString('en-US');
    clockEl.title = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (cal.classList.contains('open')) {
      cal.querySelector('.cal-time').textContent = formatTime(now, true);
    }
  }

  /* ---------------- calendar flyout ---------------- */
  const cal = document.createElement('div');
  cal.id = 'calendar-panel';
  cal.className = 'flyout';
  cal.innerHTML = `
    <div class="cal-top"><div class="cal-time"></div><div class="cal-date"></div></div>
    <div class="cal-grid">
      <div class="cal-head"><span class="cal-month"></span>
        <div class="cal-nav"><button class="c-prev">˄</button><button class="c-next">˅</button></div>
      </div>
      <table class="cal-table"><thead><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr></thead><tbody></tbody></table>
    </div>
    <div class="cal-foot"><button class="flyout-linkbtn cal-settings">Date and time settings</button><button class="flyout-linkbtn cal-alarms">Alarms &amp; Clock</button></div>`;
  document.body.appendChild(cal);
  let calOffset = 0;
  function renderCal() {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + calOffset, 1);
    cal.querySelector('.cal-time').textContent = formatTime(now, true);
    cal.querySelector('.cal-date').textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    cal.querySelector('.cal-month').textContent = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const first = d.getDay();
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const prevDays = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
    let rows = '', day = 1 - first;
    for (let r = 0; r < 6; r++) {
      rows += '<tr>';
      for (let c = 0; c < 7; c++) {
        const cellDate = new Date(d.getFullYear(), d.getMonth(), day);
        const isToday = cellDate.toDateString() === now.toDateString();
        const dim = day < 1 || day > days;
        const label = day < 1 ? prevDays + day : day > days ? day - days : day;
        rows += `<td class="${dim ? 'dim' : ''} ${isToday ? 'today' : ''}"><span>${label}</span></td>`;
        day++;
      }
      rows += '</tr>';
    }
    cal.querySelector('tbody').innerHTML = rows;
  }
  cal.querySelector('.c-prev').addEventListener('click', (e) => { e.stopPropagation(); calOffset--; renderCal(); });
  cal.querySelector('.c-next').addEventListener('click', (e) => { e.stopPropagation(); calOffset++; renderCal(); });
  cal.querySelector('.cal-settings').addEventListener('click', () => { hideFlyout(); launch('settings', { page: 'time' }); });
  cal.querySelector('.cal-alarms').addEventListener('click', () => { hideFlyout(); launch('clock'); });
  clockEl.addEventListener('click', () => { calOffset = 0; renderCal(); showFlyout(cal, clockEl); });
  tick();
  setInterval(tick, 1000);

  /* ---------------- network (real status from the browser) ---------------- */
  const netItem = tb.querySelector('.tray-net');
  const netPanel = document.createElement('div');
  netPanel.id = 'tray-network';
  netPanel.className = 'flyout tray-panel';
  document.body.appendChild(netPanel);
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  function netState() {
    if (settings.airplane) return { icon: I.airplane, label: 'Airplane mode', sub: 'On', online: false };
    if (!navigator.onLine) return { icon: I.offline, label: 'Not connected', sub: 'No connections available', online: false };
    const eth = conn && conn.type === 'ethernet';
    return { icon: eth ? I.ethernet : I.wifi, label: eth ? 'Ethernet' : 'Network', sub: 'Connected, secured', online: true };
  }
  function renderNet() {
    const st = netState();
    netItem.innerHTML = st.icon;
    netItem.title = `${st.label}\n${st.online ? 'Internet access' : st.sub}`;
    const details = conn && st.online ? `<div class="net-detail">Speed: ~${conn.downlink ?? '?'} Mbps · Latency: ${conn.rtt ?? '?'} ms · ${String(conn.effectiveType || '').toUpperCase()}</div>` : '';
    netPanel.innerHTML = `
      <div class="net-item main">${st.icon}<div><div>${st.label}</div><div class="connected">${st.sub}</div>${details}</div></div>
      <div class="net-tiles">
        <button class="ac-tile ${st.online ? 'on' : ''}" data-n="net">${I.wifi}<span>${st.online ? 'Connected' : 'Network'}</span></button>
        <button class="ac-tile ${settings.airplane ? 'on' : ''}" data-n="air">${I.airplane}<span>Airplane mode</span></button>
      </div>
      <div class="net-footer"><button class="flyout-linkbtn net-settings">Network &amp; Internet settings</button></div>`;
    netPanel.querySelector('.net-settings').addEventListener('click', () => { hideFlyout(); launch('settings', { page: 'system' }); });
    netPanel.querySelector('[data-n="air"]').addEventListener('click', () => updateSettings({ airplane: !settings.airplane }));
  }
  renderNet();
  netItem.addEventListener('click', () => { renderNet(); showFlyout(netPanel, netItem); });
  window.addEventListener('online', () => { renderNet(); notify('Network', 'You\'re connected to the Internet.', I.wifi, { silent: true }); });
  window.addEventListener('offline', () => { renderNet(); notify('Network', 'No Internet access. Check your connection.', I.offline); });
  if (conn && conn.addEventListener) conn.addEventListener('change', renderNet);

  /* ---------------- volume ---------------- */
  const volItem = tb.querySelector('.tray-vol');
  const volPanel = document.createElement('div');
  volPanel.id = 'tray-volume';
  volPanel.className = 'flyout tray-panel';
  volPanel.innerHTML = `<div class="vol-head">Speakers (Web Audio)</div><div class="vol-row"><button class="vol-mute" title="Mute"></button><input type="range" min="0" max="100"><span class="vol-val"></span></div>`;
  document.body.appendChild(volPanel);
  const volSlider = volPanel.querySelector('input');
  const muteBtn = volPanel.querySelector('.vol-mute');
  function renderVol() {
    const muted = settings.muted || settings.volume === 0;
    volItem.innerHTML = muted ? I.mute : I.volume;
    volItem.title = `Speakers: ${muted ? 'Muted' : settings.volume + '%'}`;
    muteBtn.innerHTML = muted ? I.mute : I.volume;
    volSlider.value = settings.volume;
    volPanel.querySelector('.vol-val').textContent = settings.volume;
  }
  renderVol();
  volSlider.addEventListener('input', () => updateSettings({ volume: +volSlider.value, muted: false }));
  volSlider.addEventListener('change', () => playSound('ding', true));
  muteBtn.addEventListener('click', () => updateSettings({ muted: !settings.muted }));
  volItem.addEventListener('click', () => showFlyout(volPanel, volItem));
  volItem.addEventListener('wheel', (e) => { e.preventDefault(); updateSettings({ volume: Math.max(0, Math.min(100, settings.volume + (e.deltaY < 0 ? 2 : -2))), muted: false }); }, { passive: false });

  /* ---------------- battery (real, when the device has one) ---------------- */
  const batItem = tb.querySelector('.tray-bat');
  const batPanel = document.createElement('div');
  batPanel.id = 'tray-battery';
  batPanel.className = 'flyout tray-panel';
  document.body.appendChild(batPanel);
  const batSvg = (level, charging) => `<svg viewBox="0 0 24 24"><rect x="2.5" y="7.5" width="17" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="20" y="10.2" width="2" height="3.6" rx="0.6" fill="currentColor"/><rect x="4.2" y="9.2" width="${Math.max(0.8, 13.6 * level)}" height="5.6" fill="${level < 0.15 && !charging ? '#e81123' : 'currentColor'}"/>${charging ? '<path d="M12.2 5.5 L8.5 12.6 H11.4 L10.4 18.5 L14.6 11 H11.7 Z" fill="#ffd54f" stroke="#222" stroke-width=".6"/>' : ''}</svg>`;
  if (navigator.getBattery) {
    navigator.getBattery().then(b => {
      let warned = false;
      const upd = () => {
        const pct = Math.round(b.level * 100);
        const desktop = b.charging && b.level === 1 && b.chargingTime === 0;
        batItem.classList.toggle('hidden', desktop);
        batItem.innerHTML = batSvg(b.level, b.charging);
        const rem = !b.charging && isFinite(b.dischargingTime) ? `${Math.floor(b.dischargingTime / 3600)} hr ${Math.floor(b.dischargingTime % 3600 / 60)} min remaining` : b.charging ? (pct === 100 ? 'Fully charged' : 'Charging') : '';
        batItem.title = `${pct}% ${rem ? '— ' + rem : ''}`;
        batPanel.innerHTML = `<div class="bat-row">${batSvg(b.level, b.charging)}<div><div class="bat-pct">${pct}%</div><div class="bat-sub">${rem || (b.charging ? 'Plugged in' : 'On battery')}</div></div></div>
          <div class="net-footer"><button class="flyout-linkbtn bat-settings">Battery settings</button></div>`;
        batPanel.querySelector('.bat-settings').addEventListener('click', () => { hideFlyout(); launch('settings', { page: 'system' }); });
        if (!b.charging && pct <= 10 && !warned) { warned = true; notify('Battery', `Your battery is running low (${pct}%). Plug in your PC.`, I.battery, { sound: 'warn' }); }
        if (b.charging) warned = false;
      };
      upd();
      ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach(ev => b.addEventListener(ev, upd));
    }).catch(() => {});
  }
  batItem.addEventListener('click', () => showFlyout(batPanel, batItem));

  /* ---------------- language ---------------- */
  const engItem = tb.querySelector('.tray-eng');
  const engPanel = document.createElement('div');
  engPanel.id = 'tray-eng';
  engPanel.className = 'flyout tray-panel';
  const LANGS = [['ENG', 'English (United States)', 'US keyboard'], ['ARA', 'العربية (مصر)', 'Arabic (101) keyboard'], ['FRA', 'Français (France)', 'French keyboard']];
  let lang = localStorage.getItem('webwin-lang') || 'ENG';
  function renderEng() {
    engItem.textContent = lang;
    engPanel.innerHTML = LANGS.map(([code, name, kb]) => `<div class="eng-opt ${code === lang ? 'sel' : ''}" data-c="${code}"><b>${code}</b><div><div>${name}</div><div class="eng-kb">${kb}</div></div></div>`).join('') +
      `<div class="net-footer"><button class="flyout-linkbtn">Language preferences</button></div>`;
    engPanel.querySelectorAll('.eng-opt').forEach(o => o.addEventListener('click', () => {
      lang = o.dataset.c; try { localStorage.setItem('webwin-lang', lang); } catch { /* ignore */ }
      renderEng(); hideFlyout();
    }));
    engPanel.querySelector('.flyout-linkbtn').addEventListener('click', () => { hideFlyout(); launch('settings', { page: 'time' }); });
  }
  renderEng();
  engItem.addEventListener('click', () => showFlyout(engPanel, engItem));

  /* ---------------- hidden icons ---------------- */
  const hidItem = tb.querySelector('.tray-hidden');
  const hidPanel = document.createElement('div');
  hidPanel.id = 'tray-hidden';
  hidPanel.className = 'flyout tray-panel';
  hidPanel.innerHTML = `<span class="hid-ic" data-h="cloud" title="OneDrive — Up to date">${I.cloud}</span><span class="hid-ic" data-h="shield" title="Windows Security — No actions needed">${I.shield}</span><span class="hid-ic" data-h="tm" title="Task Manager">${I.taskmgr}</span>`;
  document.body.appendChild(hidPanel);
  hidPanel.querySelector('[data-h="cloud"]').addEventListener('click', () => { hideFlyout(); notify('OneDrive', 'Your files are up to date — they live right here in this browser.', I.cloud); });
  hidPanel.querySelector('[data-h="shield"]').addEventListener('click', () => { hideFlyout(); launch('settings', { page: 'update' }); });
  hidPanel.querySelector('[data-h="tm"]').addEventListener('click', () => { hideFlyout(); launch('taskmgr'); });
  hidItem.addEventListener('click', () => showFlyout(hidPanel, hidItem));

  /* ---------------- action center ---------------- */
  const ac = document.createElement('div');
  ac.id = 'action-center';
  ac.className = 'flyout';
  ac.innerHTML = `
    <div class="ac-header"><span>Notifications</span><button class="ac-clear">Clear all notifications</button></div>
    <div class="ac-notifs"></div>
    <div class="ac-quick">
      <div class="ac-tiles"></div>
      <div class="ac-bright">${I.sun}<input type="range" min="30" max="100"><span class="b-val"></span></div>
    </div>`;
  document.body.appendChild(ac);

  const notifItem = tb.querySelector('.tray-notif');
  const badge = notifItem.querySelector('.badge');
  function renderNotifs() {
    const list = ac.querySelector('.ac-notifs');
    const items = getNotifs();
    badge.classList.toggle('hidden', items.length === 0);
    badge.textContent = items.length;
    notifItem.innerHTML = (settings.dnd ? I.focus : I.bell) + '<span class="badge ' + (items.length ? '' : 'hidden') + '">' + items.length + '</span>';
    list.innerHTML = '';
    if (!items.length) { list.innerHTML = `<div class="ac-empty">No new notifications</div>`; return; }
    for (const n of items) {
      const card = document.createElement('div');
      card.className = 'ac-card' + (n.onClick ? ' clickable' : '');
      card.innerHTML = `<span class="t-icon">${n.icon}</span><div class="ac-c"><div class="t-title">${esc(n.title)}</div><div class="t-body">${esc(n.body)}</div><div class="t-time">${timeAgo(n.time)}</div></div><span class="ac-x">✕</span>`;
      card.querySelector('.ac-x').addEventListener('click', (e) => { e.stopPropagation(); dismissNotif(n); });
      if (n.onClick) card.addEventListener('click', () => { hideFlyout(); dismissNotif(n); n.onClick(); });
      list.appendChild(card);
    }
  }
  onNotif(renderNotifs);
  renderNotifs();
  ac.querySelector('.ac-clear').addEventListener('click', () => clearNotifs());
  notifItem.addEventListener('click', () => { renderNotifs(); renderTiles(); showFlyout(ac, notifItem); });

  async function toggleFullscreenImpl() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        try { await navigator.keyboard?.lock?.(); } catch { /* not supported */ }
      }
    } catch { notify('Full screen', 'Your browser blocked full screen. Press F11 instead.', I.fullscreen); }
  }
  document.addEventListener('fullscreenchange', () => renderTiles());

  function renderTiles() {
    const tiles = [
      { k: 'net', icon: netState().icon, label: netState().online ? 'Network' : 'Not connected', on: netState().online, act: () => { hideFlyout(); renderNet(); showFlyout(netPanel, netItem); } },
      { k: 'night', icon: I.moon, label: 'Night light', on: settings.nightlight, act: () => updateSettings({ nightlight: !settings.nightlight }) },
      { k: 'air', icon: I.airplane, label: 'Airplane mode', on: settings.airplane, act: () => updateSettings({ airplane: !settings.airplane }) },
      { k: 'focus', icon: I.focus, label: 'Focus assist', on: settings.dnd, act: () => updateSettings({ dnd: !settings.dnd }) },
      { k: 'full', icon: I.fullscreen, label: 'Full screen', on: !!document.fullscreenElement, act: toggleFullscreenImpl },
      { k: 'dark', icon: I.contrast, label: 'Dark mode', on: settings.theme === 'dark', act: () => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }) },
      { k: 'mute', icon: settings.muted ? I.mute : I.volume, label: settings.muted ? 'Muted' : 'Sound', on: !settings.muted, act: () => updateSettings({ muted: !settings.muted }) },
      { k: 'settings', icon: I.settings, label: 'All settings', on: false, act: () => { hideFlyout(); launch('settings'); } },
    ];
    const box = ac.querySelector('.ac-tiles');
    box.innerHTML = '';
    for (const t of tiles) {
      const b = document.createElement('button');
      b.className = 'ac-tile' + (t.on ? ' on' : '');
      b.innerHTML = `${t.icon}<span>${t.label}</span>`;
      b.addEventListener('click', () => { t.act(); setTimeout(renderTiles, 50); });
      box.appendChild(b);
    }
    const bSlider = ac.querySelector('.ac-bright input');
    bSlider.value = settings.brightness;
    ac.querySelector('.b-val').textContent = settings.brightness;
  }
  renderTiles();
  const bSlider = ac.querySelector('.ac-bright input');
  bSlider.addEventListener('input', () => { ac.querySelector('.b-val').textContent = bSlider.value; updateSettings({ brightness: +bSlider.value }); });

  /* ---------------- search panel ---------------- */
  const sp = document.createElement('div');
  sp.id = 'search-panel';
  sp.className = 'flyout';
  sp.innerHTML = `<div class="sp-body"></div><div class="sp-input-row">${I.search}<input type="text" placeholder="Type here to search" spellcheck="false"></div>`;
  document.body.appendChild(sp);
  const searchInput = tb.querySelector('.tb-search input');
  const panelInput = sp.querySelector('.sp-input-row input');
  const spBody = sp.querySelector('.sp-body');
  let spIndex = 0;
  let spActions = [];

  function searchFiles(q) {
    const out = [];
    walk((node, path) => {
      if (node.name.toLowerCase().includes(q)) out.push({ node, path });
      return out.length < 8;
    }, ROOT());
    return out;
  }

  function renderSearch() {
    const raw = (settings.searchMode === 'box' ? searchInput : panelInput).value;
    const q = raw.trim().toLowerCase();
    spActions = [];
    let html = '';
    const add = (section, items) => {
      if (!items.length) return;
      html += `<div class="sp-section-title">${section}</div>`;
      for (const it of items) {
        const i = spActions.length;
        spActions.push(it.action);
        html += `<div class="sp-result" data-i="${i}">${it.icon}<span class="spr-text"><span class="spr-name">${esc(it.name)}</span>${it.sub ? `<span class="spr-sub">${esc(it.sub)}</span>` : ''}</span></div>`;
      }
    };
    if (!q) {
      add('Top apps', Object.values(APPS).filter(a => !a.hidden).slice(0, 8).map(a => ({ icon: a.icon, name: a.name, action: () => launch(a.id) })));
      const recent = [];
      walk((node, path) => { if (node.type === 'file') recent.push({ node, path }); }, ROOT());
      recent.sort((a, b) => (b.node.modified || 0) - (a.node.modified || 0));
      add('Recent', recent.slice(0, 4).map(f => ({ icon: iconFor(f.node), name: f.node.name, sub: 'C:\\' + f.path.slice(0, -1).join('\\'), action: () => openPath(f.path) })));
    } else {
      const apps = Object.values(APPS).filter(a => a.name.toLowerCase().includes(q) || a.id.includes(q)).map(a => ({ icon: a.icon, name: a.name, sub: 'App', action: () => launch(a.id) }));
      const sets = SETTINGS_SEARCH.filter(s => s.name.toLowerCase().includes(q) || s.keys.includes(q)).slice(0, 4).map(s => ({ icon: I.settings, name: s.name, sub: 'Settings', action: () => launch('settings', { page: s.page }) }));
      const files = searchFiles(q).map(f => ({ icon: iconFor(f.node), name: f.node.name, sub: 'C:\\' + f.path.slice(0, -1).join('\\'), action: () => openPath(f.path) }));
      add('Best match', [...apps, ...sets, ...files].slice(0, 1));
      const rest = [...apps, ...sets, ...files].slice(1);
      add('Apps', rest.filter(r => r.sub === 'App'));
      add('Settings', rest.filter(r => r.sub === 'Settings'));
      add(`Documents & folders`, rest.filter(r => r.sub !== 'App' && r.sub !== 'Settings'));
      add('Search the web', [{ icon: I.globe, name: `${raw.trim()} - See web results`, action: () => launch('edge', { url: 'https://www.bing.com/search?q=' + encodeURIComponent(raw.trim()) }) }]);
    }
    spBody.innerHTML = html || '<div class="sp-empty">Nothing found</div>';
    spIndex = 0;
    paintSearchSel();
    spBody.querySelectorAll('.sp-result').forEach(r => r.addEventListener('click', () => runSearch(+r.dataset.i)));
  }
  function paintSearchSel() { spBody.querySelectorAll('.sp-result').forEach(r => r.classList.toggle('best', +r.dataset.i === spIndex)); }
  function runSearch(i) {
    const act = spActions[i];
    hideFlyout();
    searchInput.value = ''; panelInput.value = '';
    searchInput.blur(); panelInput.blur();
    if (act) act();
  }
  function onSearchKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(spIndex); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); spIndex = Math.min(spActions.length - 1, spIndex + 1); paintSearchSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); spIndex = Math.max(0, spIndex - 1); paintSearchSel(); }
    else if (e.key === 'Escape') { searchInput.value = ''; panelInput.value = ''; hideFlyout(); e.target.blur(); }
  }
  function openSearch(text = null) {
    sp.classList.toggle('with-input', settings.searchMode !== 'box');
    const input = settings.searchMode === 'box' ? searchInput : panelInput;
    if (text != null) input.value = text;
    renderSearch();
    if (getOpenFlyout() !== sp) showFlyout(sp, searchBox);
    input.focus();
    if (text == null) input.select();
  }
  searchInput.addEventListener('focus', () => { if (getOpenFlyout() !== sp) openSearch(); });
  searchInput.addEventListener('input', renderSearch);
  searchInput.addEventListener('keydown', onSearchKey);
  panelInput.addEventListener('input', renderSearch);
  panelInput.addEventListener('keydown', onSearchKey);
  searchBox.addEventListener('click', () => { if (settings.searchMode !== 'box') { if (getOpenFlyout() === sp) hideFlyout(); else openSearch(); } });

  /* ---------------- task view ---------------- */
  const tv = document.getElementById('taskview-overlay');
  function renderTaskView() {
    tv.innerHTML = '';
    const wins = mruList();
    const grid = document.createElement('div');
    grid.className = 'tv-grid';
    if (!wins.length) grid.innerHTML = `<div class="tv-empty">No open windows — launch something from the Start menu 🙂</div>`;
    for (const w of wins) {
      const card = document.createElement('div');
      card.className = 'tv-card';
      const title = document.createElement('div');
      title.className = 'tv-title';
      title.innerHTML = `<span class="tv-ic">${w.opts.icon || ''}</span><span>${esc(w.title)}</span>`;
      card.appendChild(title);
      const thumb = document.createElement('div');
      thumb.className = 'tv-thumb';
      thumb.appendChild(thumbnailFor(w, 260, 160));
      card.appendChild(thumb);
      const x = document.createElement('button');
      x.className = 'tv-close'; x.textContent = '✕'; x.title = 'Close';
      x.addEventListener('click', async (e) => { e.stopPropagation(); await w.close(); renderTaskView(); });
      card.appendChild(x);
      card.addEventListener('click', () => { closeTaskView(); w.focus(); });
      grid.appendChild(card);
    }
    tv.appendChild(grid);
    const tl = document.createElement('div');
    tl.className = 'tv-timeline';
    tl.innerHTML = `<div class="tv-desktops"><div class="tv-desk current">Desktop 1</div><div class="tv-desk new">+ New desktop</div></div>`;
    tl.querySelector('.tv-desk.new').addEventListener('click', () => notify('Task View', 'Virtual desktops are on the roadmap. For now, enjoy the one you have!', I.taskview));
    tv.appendChild(tl);
  }
  function openTaskViewImpl() { hideFlyout(); renderTaskView(); tv.classList.add('open'); }
  function closeTaskView() { tv.classList.remove('open'); setTimeout(() => { if (!tv.classList.contains('open')) tv.innerHTML = ''; }, 250); }
  const toggleTV = () => (tv.classList.contains('open') ? closeTaskView() : openTaskViewImpl());
  tb.querySelector('.tb-taskview').addEventListener('click', toggleTV);
  tv.addEventListener('click', (e) => { if (e.target === tv || e.target.classList.contains('tv-grid')) closeTaskView(); });

  /* ---------------- start button & show desktop ---------------- */
  const startBtn = tb.querySelector('.tb-start');
  startBtn.addEventListener('click', () => toggleStart(null, startBtn));
  startBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    contextMenu(e.clientX, e.clientY - 300, [
      { label: 'Task Manager', action: () => launch('taskmgr') },
      { label: 'Settings', action: () => launch('settings') },
      { label: 'File Explorer', action: () => launch('explorer') },
      { label: 'Search', action: () => openSearch() },
      { label: 'Run', action: () => launch('run') },
      '-',
      { label: 'Shut down or sign out', submenu: [
        { label: 'Sign out', action: () => window.dispatchEvent(new CustomEvent('webwin:signout')) },
        { label: 'Sleep', action: () => window.dispatchEvent(new CustomEvent('webwin:sleep')) },
        { label: 'Shut down', action: () => window.dispatchEvent(new CustomEvent('webwin:shutdown')) },
        { label: 'Restart', action: () => window.dispatchEvent(new CustomEvent('webwin:restart')) },
      ] },
      { label: 'Desktop', action: minimizeAll },
    ]);
  });
  const showDesk = document.getElementById('tb-showdesktop');
  showDesk.addEventListener('click', minimizeAll);
  /* peek at the desktop while hovering */
  let peekT = null;
  showDesk.addEventListener('pointerenter', () => { peekT = setTimeout(() => document.body.classList.add('peek'), 500); });
  showDesk.addEventListener('pointerleave', () => { clearTimeout(peekT); document.body.classList.remove('peek'); });
  showDesk.addEventListener('click', () => { clearTimeout(peekT); document.body.classList.remove('peek'); });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.ctrlKey || e.defaultPrevented) return;
    if (tv.classList.contains('open')) closeTaskView();
    else if (getOpenFlyout()) hideFlyout();
  });

  /* taskbar background menu */
  tb.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.tb-appbtn, .tb-start')) return;
    e.preventDefault();
    contextMenu(e.clientX, e.clientY - 260, [
      { label: 'Search', submenu: [
        { label: 'Hidden', checked: settings.searchMode === 'hidden', action: () => updateSettings({ searchMode: 'hidden' }) },
        { label: 'Show search icon', checked: settings.searchMode === 'icon', action: () => updateSettings({ searchMode: 'icon' }) },
        { label: 'Show search box', checked: settings.searchMode === 'box', action: () => updateSettings({ searchMode: 'box' }) },
      ] },
      '-',
      { label: 'Show the desktop', action: minimizeAll },
      { label: 'Task Manager', icon: I.taskmgr, action: () => launch('taskmgr') },
      '-',
      { label: 'Taskbar settings', icon: I.settings, action: () => launch('settings', { page: 'personalization' }) },
    ]);
  });

  /* ---------------- app buttons + previews ---------------- */
  const appsEl = document.getElementById('tb-apps');
  const preview = document.createElement('div');
  preview.id = 'tb-preview';
  document.body.appendChild(preview);
  let previewFor = null, previewShowT = null, previewHideT = null;

  function hidePreview() { preview.classList.remove('open'); previewFor = null; }
  function showPreview(id, btn) {
    const wins = appWindows(id);
    if (!wins.length || getOpenFlyout()) return;
    previewFor = id;
    preview.innerHTML = '';
    for (const w of wins) {
      const card = document.createElement('div');
      card.className = 'pv-card' + (w === getFocused() ? ' active' : '');
      card.innerHTML = `<div class="pv-title"><span class="pv-ic">${w.opts.icon || ''}</span><span class="pv-t">${esc(w.title)}</span><button class="pv-x" title="Close">✕</button></div><div class="pv-thumb"></div>`;
      card.querySelector('.pv-thumb').appendChild(thumbnailFor(w, 200, 120));
      card.addEventListener('click', () => { hidePreview(); w.focus(); });
      card.querySelector('.pv-x').addEventListener('click', (e) => { e.stopPropagation(); w.close(); setTimeout(() => { if (appWindows(id).length) showPreview(id, btn); else hidePreview(); }, 200); });
      preview.appendChild(card);
    }
    preview.classList.add('open');
    const r = btn.getBoundingClientRect();
    const pw = preview.offsetWidth;
    preview.style.left = Math.max(4, Math.min(innerWidth - pw - 4, r.left + r.width / 2 - pw / 2)) + 'px';
  }
  preview.addEventListener('pointerenter', () => clearTimeout(previewHideT));
  preview.addEventListener('pointerleave', () => { previewHideT = setTimeout(hidePreview, 300); });

  function syncButtons() {
    const pinned = settings.pinned.filter(id => APPS[id]);
    const running = [...new Set(windowList().map(w => w.opts.appId))].filter(id => APPS[id] && !pinned.includes(id));
    const all = [...pinned, ...running];
    const focused = getFocused();

    appsEl.innerHTML = '';
    for (const id of all) {
      const app = APPS[id];
      const wins = appWindows(id);
      const btn = document.createElement('div');
      btn.className = 'tb-appbtn' +
        (wins.length ? ' running' : '') + (wins.length > 1 ? ' multi' : '') +
        (focused && focused.opts.appId === id ? ' active' : '') +
        (wins.some(w => w.el.classList.contains('flashing')) ? ' flashing' : '');
      btn.title = wins.length ? '' : app.name;
      btn.innerHTML = app.icon;
      btn.addEventListener('click', (e) => {
        hidePreview();
        const ws = appWindows(id);
        if (!ws.length || e.shiftKey) { launch(id); return; }
        if (ws.length === 1) {
          const w = ws[0];
          if (w === getFocused() && !w.minimized) w.minimize(); else w.focus();
          return;
        }
        /* several windows: cycle through them */
        const order = mruList().filter(w => w.opts.appId === id);
        const cur = getFocused();
        if (cur && cur.opts.appId === id) order[order.length - 1].focus();
        else order[0].focus();
      });
      btn.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); launch(id); } });
      btn.addEventListener('pointerenter', () => {
        clearTimeout(previewHideT);
        if (previewFor && previewFor !== id) { showPreview(id, btn); return; }
        previewShowT = setTimeout(() => showPreview(id, btn), 450);
      });
      btn.addEventListener('pointerleave', () => { clearTimeout(previewShowT); previewHideT = setTimeout(hidePreview, 300); });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        hidePreview();
        const ws = appWindows(id);
        const isPinned = settings.pinned.includes(id);
        contextMenu(e.clientX, e.clientY - 140, [
          { label: app.name, icon: app.icon, action: () => launch(id) },
          isPinned
            ? { label: 'Unpin from taskbar', icon: I.pin, action: () => updateSettings({ pinned: settings.pinned.filter(x => x !== id) }) }
            : { label: 'Pin to taskbar', icon: I.pin, action: () => updateSettings({ pinned: [...settings.pinned, id] }) },
          ...(ws.length ? [{ label: ws.length > 1 ? 'Close all windows' : 'Close window', icon: I.x, action: () => ws.forEach(w => w.close()) }] : []),
        ]);
      });
      /* dragging a file over a button brings that app forward, like Windows */
      btn.addEventListener('dragenter', () => { const w = appWindows(id)[0]; if (w) w.focus(); });
      appsEl.appendChild(btn);
    }
  }
  ['open', 'close', 'focus', 'minimize', 'restore', 'title', 'flash'].forEach(ev => onWm(ev, syncButtons));
  syncButtons();

  onSettingsChange((s, patch) => {
    if (!patch) return;
    if ('pinned' in patch) syncButtons();
    if ('searchMode' in patch) applySearchMode();
    if ('clock24' in patch || 'clockSeconds' in patch) tick();
    if ('volume' in patch || 'muted' in patch) renderVol();
    if ('airplane' in patch) {
      renderNet();
      notify('Airplane mode', settings.airplane ? 'Airplane mode is on. Wireless communication is turned off.' : 'Airplane mode is off.', I.airplane, { silent: true });
    }
    if ('dnd' in patch) renderNotifs();
    renderTiles();
  });

  api = {
    openTaskView: openTaskViewImpl,
    toggleTaskView: toggleTV,
    toggleActionCenter: () => { if (getOpenFlyout() === ac) hideFlyout(); else { renderNotifs(); renderTiles(); showFlyout(ac, notifItem); } },
    focusSearch: (text) => openSearch(text),
    toggleFullscreen: toggleFullscreenImpl,
  };
}

export { isStartOpen };
