/* Taskbar: start, search, task view, app buttons, tray, clock/calendar, action center. */
import { APPS, launch } from './apps/registry.js';
import { on as onWm, windowList, appWindows, getFocused, minimizeAll, thumbnailFor } from './wm.js';
import { showFlyout, hideFlyout, getOpenFlyout, contextMenu, notify, getNotifs, clearNotifs, onNotif } from './ui.js';
import { settings, updateSettings } from './settings.js';
import { initStartMenu, toggleStart } from './startmenu.js';
import { I } from './icons.js';

export function initTaskbar() {
  initStartMenu();
  const tb = document.getElementById('taskbar');
  tb.innerHTML = `
    <div class="tb-start" title="Start">${I.start}</div>
    <div class="tb-search">${I.search}<input type="text" placeholder="Type here to search" spellcheck="false"></div>
    <div class="tb-taskview" title="Task View">${I.taskview}</div>
    <div id="tb-apps"></div>
    <div id="tb-tray">
      <div class="tb-tray-item tray-hidden" title="Hidden icons">${I.chevUp}</div>
      <div class="tb-tray-item tray-net" title="Network">${I.wifi}</div>
      <div class="tb-tray-item tray-vol" title="Volume">${I.volume}</div>
      <div class="tb-tray-item tray-eng" title="Language">ENG</div>
      <div class="tb-tray-item tray-clock" id="tb-clock"><span class="t"></span><span class="d"></span></div>
      <div class="tb-tray-item tray-notif" title="Notifications">${I.bell}<span class="badge hidden"></span></div>
      <div id="tb-showdesktop" title="Show desktop"></div>
    </div>`;

  /* ---------------- clock ---------------- */
  const timeEl = tb.querySelector('#tb-clock .t');
  const dateEl = tb.querySelector('#tb-clock .d');
  function tick() {
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    dateEl.textContent = now.toLocaleDateString('en-US');
    const lt = document.querySelector('#lock-screen .lock-time');
    const ld = document.querySelector('#lock-screen .lock-date');
    if (lt && !document.getElementById('lock-screen').classList.contains('hidden')) {
      lt.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      ld.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }
  }
  tick();
  setInterval(tick, 1000);

  /* ---------------- calendar flyout ---------------- */
  const cal = document.createElement('div');
  cal.id = 'calendar-panel';
  cal.className = 'flyout';
  cal.innerHTML = `
    <div class="cal-top"><div class="cal-time"></div><div class="cal-date"></div></div>
    <div class="cal-grid">
      <div class="cal-head"><span class="cal-month"></span>
        <div class="cal-nav"><button class="c-prev">‹</button><button class="c-next">›</button></div>
      </div>
      <table class="cal-table"><thead><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr></thead><tbody></tbody></table>
    </div>`;
  document.body.appendChild(cal);
  let calOffset = 0;
  function renderCal() {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + calOffset, 1);
    cal.querySelector('.cal-time').textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    cal.querySelector('.cal-date').textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    cal.querySelector('.cal-month').textContent = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const first = d.getDay();
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const prevDays = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
    let rows = '', day = 1 - first, cellDate;
    const today = new Date();
    for (let r = 0; r < 6; r++) {
      rows += '<tr>';
      for (let c = 0; c < 7; c++) {
        cellDate = new Date(d.getFullYear(), d.getMonth(), day);
        const isToday = calOffset === 0 && cellDate.toDateString() === today.toDateString();
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
  tb.querySelector('.tray-clock').addEventListener('click', () => { calOffset = 0; renderCal(); showFlyout(cal, tb.querySelector('.tray-clock')); });

  /* ---------------- tray mini panels ---------------- */
  const netPanel = document.createElement('div');
  netPanel.id = 'tray-network';
  netPanel.className = 'flyout tray-panel';
  netPanel.innerHTML = `
    <div class="net-sec-title">Wi-Fi</div>
    <div class="net-item">${I.wifi}<span>HomeNet-5G</span><span class="connected">Connected, secured</span></div>
    <div class="net-item">${I.wifi}<span>Cafe_Guest</span></div>
    <div class="net-item">${I.wifi}<span>NETGEAR-2.4</span></div>
    <div class="net-footer">
      <button class="flyout-linkbtn net-settings">Network &amp; Internet settings</button>
    </div>`;
  document.body.appendChild(netPanel);
  netPanel.querySelector('.net-settings').addEventListener('click', () => { hideFlyout(); launch('settings'); });
  tb.querySelector('.tray-net').addEventListener('click', () => showFlyout(netPanel, tb.querySelector('.tray-net')));

  const volPanel = document.createElement('div');
  volPanel.id = 'tray-volume';
  volPanel.className = 'flyout tray-panel';
  volPanel.innerHTML = `<div class="vol-row">${I.volume}<input type="range" min="0" max="100" value="72"><span class="vol-val">72</span></div>`;
  document.body.appendChild(volPanel);
  const volSlider = volPanel.querySelector('input');
  volSlider.addEventListener('input', () => volPanel.querySelector('.vol-val').textContent = volSlider.value);
  tb.querySelector('.tray-vol').addEventListener('click', () => showFlyout(volPanel, tb.querySelector('.tray-vol')));

  const engPanel = document.createElement('div');
  engPanel.id = 'tray-eng';
  engPanel.className = 'flyout tray-panel';
  engPanel.innerHTML = `<div class="eng-opt sel">English (United States)</div><div class="eng-opt">العربية (مصر)</div><div class="eng-opt">Keyboard: QWERTY</div>`;
  document.body.appendChild(engPanel);
  engPanel.querySelectorAll('.eng-opt').forEach(o => o.addEventListener('click', () => {
    engPanel.querySelectorAll('.eng-opt').forEach(x => x.classList.remove('sel'));
    o.classList.add('sel');
  }));
  tb.querySelector('.tray-eng').addEventListener('click', () => showFlyout(engPanel, tb.querySelector('.tray-eng')));

  const hidPanel = document.createElement('div');
  hidPanel.id = 'tray-hidden';
  hidPanel.className = 'flyout tray-panel';
  hidPanel.innerHTML = `${I.cloud}${I.shield}`;
  document.body.appendChild(hidPanel);
  tb.querySelector('.tray-hidden').addEventListener('click', () => showFlyout(hidPanel, tb.querySelector('.tray-hidden')));

  /* ---------------- action center ---------------- */
  const ac = document.createElement('div');
  ac.id = 'action-center';
  ac.className = 'flyout';
  ac.innerHTML = `
    <div class="ac-header"><span>Notifications</span><button class="ac-clear">Clear all</button></div>
    <div class="ac-notifs"></div>
    <div class="ac-quick">
      <div class="ac-tiles">
        <button class="ac-tile" data-q="net">${I.wifi}<span>Network</span></button>
        <button class="ac-tile" data-q="night">${I.moon}<span>Night light</span></button>
        <button class="ac-tile" data-q="airplane">${I.play}<span>Airplane</span></button>
        <button class="ac-tile" data-q="settings">${I.settings}<span>All settings</span></button>
      </div>
      <div class="ac-bright">${I.sun}<input type="range" min="30" max="100" value="100"><span class="b-val">100</span></div>
    </div>`;
  document.body.appendChild(ac);

  const badge = tb.querySelector('.tray-notif .badge');
  function renderNotifs() {
    const list = ac.querySelector('.ac-notifs');
    const items = getNotifs();
    badge.classList.toggle('hidden', items.length === 0);
    badge.textContent = items.length;
    list.innerHTML = items.length
      ? items.map(n => `<div class="ac-card"><span class="t-icon">${n.icon}</span><div><div class="t-title">${n.title}</div><div class="t-body">${n.body}</div></div></div>`).join('')
      : `<div class="ac-empty">No new notifications</div>`;
  }
  onNotif(renderNotifs);
  renderNotifs();
  ac.querySelector('.ac-clear').addEventListener('click', () => { clearNotifs(); });
  tb.querySelector('.tray-notif').addEventListener('click', () => showFlyout(ac, tb.querySelector('.tray-notif')));

  const nightTile = ac.querySelector('[data-q="night"]');
  function syncNightTile() {
    nightTile.classList.toggle('on', settings.nightlight);
  }
  syncNightTile();
  nightTile.addEventListener('click', () => { updateSettings({ nightlight: !settings.nightlight }); syncNightTile(); });
  ac.querySelector('[data-q="net"]').addEventListener('click', () => { hideFlyout(); showFlyout(netPanel); });
  ac.querySelector('[data-q="airplane"]').addEventListener('click', () => {
    notify('Airplane mode', 'This PC is too heavy to fly. Nice try though.', I.play);
  });
  ac.querySelector('[data-q="settings"]').addEventListener('click', () => { hideFlyout(); launch('settings'); });
  const bSlider = ac.querySelector('.ac-bright input');
  const bVal = ac.querySelector('.b-val');
  bSlider.value = settings.brightness; bVal.textContent = settings.brightness;
  bSlider.addEventListener('input', () => { bVal.textContent = bSlider.value; updateSettings({ brightness: +bSlider.value }); });

  /* ---------------- search panel ---------------- */
  const sp = document.createElement('div');
  sp.id = 'search-panel';
  sp.className = 'flyout';
  sp.innerHTML = `
    <div class="sp-section-title">Best match</div>
    <div class="sp-results"></div>
    <div class="sp-web"></div>`;
  document.body.appendChild(sp);
  const searchInput = tb.querySelector('.tb-search input');
  const spResults = sp.querySelector('.sp-results');
  const spWeb = sp.querySelector('.sp-web');
  const spTitle = sp.querySelector('.sp-section-title');

  function renderSearch() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      spTitle.textContent = 'All apps';
      spResults.innerHTML = Object.values(APPS).map(a =>
        `<div class="sp-result" data-id="${a.id}">${a.icon}<span class="spr-name">${a.name}</span></div>`).join('');
      spWeb.innerHTML = '';
    } else {
      const hits = Object.values(APPS).filter(a => a.name.toLowerCase().includes(q));
      spTitle.textContent = 'Best match';
      spResults.innerHTML = hits.length
        ? hits.map((a, i) => `<div class="sp-result ${i === 0 ? 'best' : ''}" data-id="${a.id}">${a.icon}<span class="spr-name">${a.name}</span><span class="spr-sub">App</span></div>`).join('')
        : `<div class="sp-empty">No results found for "${searchInput.value}"</div>`;
      spWeb.innerHTML = `<div class="sp-section-title">Search the web</div>
        <div class="sp-result sp-webbtn">${I.globe}<span class="spr-name">See web results for "${searchInput.value}"</span></div>`;
      const wb = spWeb.querySelector('.sp-webbtn');
      if (wb) wb.addEventListener('click', () => {
        hideFlyout();
        launch('edge', { url: 'https://www.bing.com/search?q=' + encodeURIComponent(searchInput.value) });
        searchInput.value = '';
      });
    }
    spResults.querySelectorAll('.sp-result[data-id]').forEach(r => r.addEventListener('click', () => {
      hideFlyout();
      launch(r.dataset.id);
      searchInput.value = '';
      searchInput.blur();
    }));
  }
  searchInput.addEventListener('focus', () => { renderSearch(); showFlyout(sp, tb.querySelector('.tb-search')); searchInput.select(); });
  searchInput.addEventListener('input', renderSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const best = sp.querySelector('.sp-result[data-id]');
      if (best) best.click();
    } else if (e.key === 'Escape') {
      searchInput.value = '';
      hideFlyout();
      searchInput.blur();
    }
  });

  /* ---------------- task view ---------------- */
  const tv = document.getElementById('taskview-overlay');
  function renderTaskView() {
    tv.innerHTML = '';
    const wins = windowList();
    const grid = document.createElement('div');
    grid.className = 'tv-grid';
    if (!wins.length) {
      grid.innerHTML = `<div class="tv-empty">No open windows — launch something from the Start menu 🙂</div>`;
    }
    for (const w of wins) {
      const card = document.createElement('div');
      card.className = 'tv-card';
      const thumb = document.createElement('div');
      thumb.className = 'tv-thumb';
      thumb.appendChild(thumbnailFor(w, 240, 150));
      card.appendChild(thumb);
      const title = document.createElement('div');
      title.className = 'tv-title';
      title.innerHTML = `${w.opts.icon || ''}<span>${w.opts.title || ''}</span>`;
      card.appendChild(title);
      const x = document.createElement('button');
      x.className = 'tv-close'; x.textContent = '✕';
      x.addEventListener('click', (e) => { e.stopPropagation(); w.close(); renderTaskView(); });
      card.appendChild(x);
      card.addEventListener('click', () => { closeTaskView(); w.focus(); });
      grid.appendChild(card);
    }
    tv.appendChild(grid);
    const desks = document.createElement('div');
    desks.className = 'tv-desktops';
    desks.innerHTML = `<div class="tv-desk current">Desktop 1</div><div class="tv-desk" style="border-style:dashed">+ New desktop</div>`;
    desks.querySelector('.tv-desk:not(.current)').addEventListener('click', () => notify('Task View', 'Virtual desktops are on the roadmap. For now, enjoy the one you have!', I.taskview));
    tv.appendChild(desks);
  }
  function openTaskView() { renderTaskView(); tv.classList.add('open'); }
  function closeTaskView() { tv.classList.remove('open'); setTimeout(() => { if (!tv.classList.contains('open')) tv.innerHTML = ''; }, 250); }
  tb.querySelector('.tb-taskview').addEventListener('click', () => { tv.classList.contains('open') ? closeTaskView() : openTaskView(); });
  tv.addEventListener('click', (e) => { if (e.target === tv) closeTaskView(); });

  /* ---------------- start button & show desktop ---------------- */
  const startBtn = tb.querySelector('.tb-start');
  startBtn.addEventListener('click', () => toggleStart(null, startBtn));
  document.getElementById('tb-showdesktop').addEventListener('click', minimizeAll);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (tv.classList.contains('open')) closeTaskView();
      hideFlyout();
    }
    if (e.key === 'Meta' || (e.ctrlKey && e.key === 'Escape')) {
      e.preventDefault();
      toggleStart(null, startBtn);
    }
  });

  /* ---------------- app buttons ---------------- */
  const appsEl = document.getElementById('tb-apps');
  const pinned = Object.values(APPS).filter(a => a.pinned).map(a => a.id);
  let extra = [];

  function syncButtons() {
    /* running apps not pinned get buttons too */
    const running = new Set(windowList().map(w => w.opts.appId));
    extra = [...running].filter(id => !pinned.includes(id) && APPS[id]);
    const all = [...pinned, ...extra];

    appsEl.innerHTML = '';
    for (const id of all) {
      const app = APPS[id];
      const wins = appWindows(id);
      const focused = getFocused();
      const btn = document.createElement('div');
      btn.className = 'tb-appbtn' +
        (wins.length ? ' running' : '') +
        (focused && focused.opts.appId === id ? ' active' : '');
      btn.title = app.name;
      btn.innerHTML = app.icon;
      btn.addEventListener('click', () => {
        const ws = appWindows(id);
        if (!ws.length) { launch(id); return; }
        const focusedHere = ws.find(w => w === getFocused() && !w.minimized);
        if (focusedHere) focusedHere.minimize();
        else {
          const target = ws.slice().sort((a, b) => (a.minimized ? -1 : 1)).find(w => w.minimized) || ws[ws.length - 1];
          target.focus();
        }
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const ws = appWindows(id);
        contextMenu(e.clientX, e.clientY, [
          { label: app.name, icon: app.icon, action: () => launch(id) },
          '-',
          ...(ws.length ? [{ label: `Close ${ws.length > 1 ? `all ${ws.length} windows` : 'window'}`, icon: I.x, action: () => ws.forEach(w => w.close()) }] : []),
        ]);
      });
      appsEl.appendChild(btn);
    }
  }
  onWm('open', syncButtons);
  onWm('close', syncButtons);
  onWm('focus', syncButtons);
  onWm('minimize', syncButtons);
  onWm('restore', syncButtons);
  syncButtons();
}
