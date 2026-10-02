/* Settings app — real device info, personalization, accounts & passwords, storage, startup apps, time, update & recovery. */
import { createWindow } from '../wm.js';
import { settings, updateSettings, WALLPAPERS, ACCENTS, onSettingsChange, hashPassword, checkPassword, userInitial, resetSettings } from '../settings.js';
import { I } from '../icons.js';
import { msgDialog, confirmDialog, promptDialog, esc, notify } from '../ui.js';
import { resetFS, eraseAll, ROOT, KNOWN, kindOf, sizeOf, formatSize, diskInfo, getBin, emptyBin, walk } from '../fs.js';
import { fileDialog } from '../filedialog.js';
import { pickAndImport, setWallpaper } from '../fileops.js';
import { playSound } from '../sound.js';
import { APPS, launch } from './registry.js';
import { SETTINGS_SEARCH } from '../taskbar.js';

const PAGES = [
  { id: 'home', name: 'Home', icon: I.home },
  { id: 'system', name: 'System', icon: I.monitor, sub: 'Display, sound, notifications, power' },
  { id: 'storage', name: 'Storage', icon: I.storage, sub: 'Disk space, Recycle Bin' },
  { id: 'personalization', name: 'Personalization', icon: I.paint, sub: 'Background, colors, taskbar' },
  { id: 'apps', name: 'Apps', icon: I.apps, sub: 'Startup, default apps, app data' },
  { id: 'accounts', name: 'Accounts', icon: I.user, sub: 'Your info, sign-in options' },
  { id: 'time', name: 'Time & Language', icon: I.language, sub: 'Clock, region, language' },
  { id: 'update', name: 'Update & Security', icon: I.update, sub: 'Windows Update, recovery' },
  { id: 'about', name: 'About', icon: I.info, sub: 'Device specifications' },
];

const sw = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label><span class="sw-state">${on ? 'On' : 'Off'}</span>`;
const row = (label, sub, right) => `<div class="set-row"><div><div class="sr-label">${label}</div>${sub ? `<div class="sr-sub">${sub}</div>` : ''}</div><div class="sr-right">${right}</div></div>`;

export function open(arg = null) {
  const win = createWindow({ title: 'Settings', icon: I.settings, appId: 'settings', w: 960, h: 640, minW: 560, minH: 380 });
  win.body.innerHTML = `
    <div class="settings">
      <div class="set-side">
        <div class="set-search">${I.search}<input placeholder="Find a setting" spellcheck="false"></div>
        <div class="set-search-res hidden"></div>
        ${PAGES.map(p => `<div class="set-item" data-page="${p.id}">${p.icon}<span>${p.name}</span></div>`).join('')}
      </div>
      <div class="set-content"></div>
    </div>`;

  const content = win.body.querySelector('.set-content');
  const sideItems = win.body.querySelectorAll('.set-item');
  let current = 'home';
  let timers = [];

  /* ---------- search ---------- */
  const sInput = win.body.querySelector('.set-search input');
  const sRes = win.body.querySelector('.set-search-res');
  sInput.addEventListener('input', () => {
    const q = sInput.value.trim().toLowerCase();
    if (!q) { sRes.classList.add('hidden'); return; }
    const hits = SETTINGS_SEARCH.filter(s => s.name.toLowerCase().includes(q) || s.keys.includes(q));
    sRes.innerHTML = hits.length ? hits.map(h => `<div class="ssr" data-p="${h.page}">${esc(h.name)}</div>`).join('') : '<div class="ssr none">No results</div>';
    sRes.classList.remove('hidden');
    sRes.querySelectorAll('.ssr[data-p]').forEach(r => r.addEventListener('click', () => { sInput.value = ''; sRes.classList.add('hidden'); show(r.dataset.p); }));
  });
  sInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sRes.querySelector('.ssr[data-p]')?.click(); });

  /* ---------- pages ---------- */
  const pages = {
    home: () => `
      <div class="set-home">
        <h1 class="center">Windows Settings</h1>
        <div class="home-user"><div class="su-av">${esc(userInitial())}</div><div><b>${esc(settings.userName)}</b><div class="sr-sub">Local Account · ${esc(settings.pcName)}</div></div></div>
        <div class="home-grid">${PAGES.slice(1).map(p => `<div class="home-tile" data-go="${p.id}">${p.icon}<div><div class="ht-name">${p.name}</div><div class="ht-sub">${p.sub}</div></div></div>`).join('')}</div>
      </div>`,

    system: () => {
      const conn = navigator.connection;
      return `
      <h1>System</h1>
      <h2>Display</h2>
      ${row('Display resolution', 'Your real screen, reported by the browser', `<b>${screen.width} × ${screen.height}</b>`)}
      ${row('Desktop area', 'The part of the screen this PC uses', `<span class="v-area">${innerWidth} × ${innerHeight}</span>`)}
      ${row('Scale', 'Change it with your browser zoom (Ctrl + / Ctrl −)', `<b>${Math.round(devicePixelRatio * 100)}%</b>`)}
      ${row('Brightness', '', `<input type="range" min="30" max="100" value="${settings.brightness}" id="set-bright" class="set-range">`)}
      ${row('Night light', 'Warmer colors to help you sleep', sw('set-nightlight', settings.nightlight))}
      <h2>Sound</h2>
      ${row('Output device', '', 'Speakers (Web Audio)')}
      ${row('Master volume', '', `<input type="range" min="0" max="100" value="${settings.volume}" id="set-vol" class="set-range"><span class="v-vol">${settings.volume}</span>`)}
      ${row('Mute', '', sw('set-mute', settings.muted))}
      ${row('System sounds', 'Sign-in chime, notifications, errors', sw('set-sounds', settings.systemSounds))}
      ${row('', '', '<button class="btn" id="set-testsnd">Test sound</button>')}
      <h2>Notifications &amp; focus assist</h2>
      ${row('Focus assist', 'Hide notification banners — they still go to the action center', sw('set-dnd', settings.dnd))}
      ${row('Test notification', '', '<button class="btn" id="set-testnotif">Send</button>')}
      <h2>Power &amp; battery</h2>
      <div class="set-card" id="set-battery">Checking battery…</div>
      ${row('Sign in after waking from sleep', '', sw('set-reqsign', settings.requireSignIn))}
      <h2>Network &amp; Internet</h2>
      <div class="set-card net-card">${navigator.onLine && !settings.airplane ? I.wifi : I.offline}<div><b>${settings.airplane ? 'Airplane mode' : navigator.onLine ? 'Connected' : 'Not connected'}</b>
        <div class="sr-sub">${navigator.onLine && conn ? `${String(conn.effectiveType || '').toUpperCase()} · ~${conn.downlink} Mbps · ${conn.rtt} ms latency` : 'You\'re connected to the Internet through your browser.'}</div></div></div>
      ${row('Airplane mode', 'Stops Edge, Weather and other apps from going online', sw('set-air', settings.airplane))}`;
    },

    storage: () => `
      <h1>Storage</h1>
      <div class="set-card" id="stor-card">Calculating…</div>
      <h2>Clean up</h2>
      ${row('Recycle Bin', `${getBin().length} item(s)`, `<button class="btn" id="set-emptybin" ${getBin().length ? '' : 'disabled'}>Empty Recycle Bin</button>`)}
      ${row('Persistent storage', 'Ask the browser never to clear this PC\'s files automatically', '<span id="stor-persist">…</span>')}
      ${row('Reset the file system', 'Deletes every file you created and restores the defaults', '<button class="btn" id="set-resetfs">Reset</button>')}`,

    personalization: () => {
      const pics = [];
      walk((n, p) => { if (n.type === 'file' && kindOf(n) === 'img' && n.content) pics.push({ n, p }); return pics.length < 24; }, ROOT());
      const type = settings.wallpaper === 'picture' || settings.wallpaper === 'solid' ? settings.wallpaper : 'preset';
      return `
      <h1>Personalization</h1>
      <div class="pers-preview"><div class="pp-screen" id="pp-screen"><div class="pp-win"><div class="pp-tb"></div></div><div class="pp-taskbar"></div></div></div>
      <h2>Background</h2>
      ${row('Background', '', `<select class="set-select" id="bg-type"><option value="preset" ${type === 'preset' ? 'selected' : ''}>Windows spotlight</option><option value="picture" ${type === 'picture' ? 'selected' : ''}>Picture</option><option value="solid" ${type === 'solid' ? 'selected' : ''}>Solid color</option></select>`)}
      <div class="bg-sec ${type === 'preset' ? '' : 'hidden'}" data-sec="preset">
        <div class="wp-picker">${WALLPAPERS.map(w => `<div class="wp-thumb wp-${w.id} ${settings.wallpaper === w.id ? 'sel' : ''}" data-wp="${w.id}" title="${w.name}"></div>`).join('')}</div>
      </div>
      <div class="bg-sec ${type === 'picture' ? '' : 'hidden'}" data-sec="picture">
        <div class="sr-sub" style="margin-bottom:8px">Choose your picture</div>
        <div class="wp-picker">${pics.map((x, i) => `<div class="wp-thumb pic ${settings.wallpaperPath && x.p.join('\\') === settings.wallpaperPath.join('\\') ? 'sel' : ''}" data-pic="${i}" title="${esc(x.n.name)}" style="background-image:url('${x.n.content.replace(/'/g, '%27')}')"></div>`).join('') || '<div class="sr-sub">No pictures yet.</div>'}</div>
        <div style="margin-top:10px;display:flex;gap:8px"><button class="btn" id="bg-browse">Browse</button><button class="btn" id="bg-upload">Use a picture from your PC…</button></div>
      </div>
      <div class="bg-sec ${type === 'solid' ? '' : 'hidden'}" data-sec="solid">
        <div class="accent-grid">${['#0063b1', '#004e8c', '#2d7d9a', '#038387', '#486860', '#525e54', '#7e735f', '#4c4a48', '#000000', '#744da9', '#881798', '#c30052', '#e81123', '#ca5010', '#107c10', '#767676'].map(c => `<div class="accent-cell solid ${settings.solidColor === c && settings.wallpaper === 'solid' ? 'sel' : ''}" style="background:${c}" data-solid="${c}"></div>`).join('')}
          <label class="accent-cell custom" title="Custom color"><input type="color" id="solid-custom" value="${settings.solidColor}">+</label></div>
      </div>
      <h2>Colors</h2>
      <div class="set-row"><label class="wradio"><input type="radio" name="theme" value="light" ${settings.theme === 'light' ? 'checked' : ''}><span>Light</span></label><label class="wradio" style="margin-left:18px"><input type="radio" name="theme" value="dark" ${settings.theme === 'dark' ? 'checked' : ''}><span>Dark</span></label></div>
      ${row('Transparency effects', '', sw('set-transp', settings.transparency))}
      <div class="sr-sub" style="margin:8px 0">Windows colors</div>
      <div class="accent-grid">${ACCENTS.map(c => `<div class="accent-cell ${settings.accent === c ? 'sel' : ''}" style="background:${c}" data-accent="${c}"></div>`).join('')}
        <label class="accent-cell custom" title="Custom color"><input type="color" id="accent-custom" value="${settings.accent}">+</label></div>
      ${row('Show accent color on the taskbar', '', sw('set-taskbaraccent', settings.taskbarAccent))}
      <h2>Taskbar</h2>
      ${row('Search', '', `<select class="set-select" id="set-search"><option value="box" ${settings.searchMode === 'box' ? 'selected' : ''}>Show search box</option><option value="icon" ${settings.searchMode === 'icon' ? 'selected' : ''}>Show search icon</option><option value="hidden" ${settings.searchMode === 'hidden' ? 'selected' : ''}>Hidden</option></select>`)}
      ${row('Pinned apps', settings.pinned.map(id => APPS[id]?.name).filter(Boolean).join(', ') || 'None', '<button class="btn" id="set-resetpins">Reset</button>')}
      <h2>Desktop</h2>
      ${row('Icon size', '', `<select class="set-select" id="set-iconsize"><option value="large" ${settings.iconSize === 'large' ? 'selected' : ''}>Large</option><option value="medium" ${settings.iconSize === 'medium' ? 'selected' : ''}>Medium</option><option value="small" ${settings.iconSize === 'small' ? 'selected' : ''}>Small</option></select>`)}
      ${row('Start menu tiles', 'Restore the default live tiles', '<button class="btn" id="set-resettiles">Reset</button>')}`;
    },

    apps: () => `
      <h1>Apps</h1>
      <h2>Startup</h2>
      <div class="sr-sub" style="margin-bottom:6px">Apps that open automatically when you sign in.</div>
      ${Object.values(APPS).filter(a => !a.hidden && a.id !== 'store').map(a => row(`<span class="app-ln">${a.icon}${esc(a.name)}</span>`, '', sw('su-' + a.id, settings.startupApps.includes(a.id)))).join('')}
      <h2>Default apps</h2>
      <div class="set-card def-apps">
        <div>${I.txt}<span>Text files</span><b>Notepad</b></div>
        <div>${I.imgfile}<span>Photo viewer</span><b>Photos</b></div>
        <div>${I.musicfile}<span>Music & video player</span><b>Media Player</b></div>
        <div>${I.htmlfile}<span>Web browser</span><b>Microsoft Edge</b></div>
      </div>
      <h2>App data</h2>
      ${row('Microsoft Edge', 'Favorites, history and search engine', '<button class="btn" data-reset="webwin-edge-v1">Reset</button>')}
      ${row('Sticky Notes', 'All notes', '<button class="btn" data-reset="webwin-notes-v1">Reset</button>')}
      ${row('Alarms & Clock', 'Alarms and world clocks', '<button class="btn" data-reset="webwin-clock-v1">Reset</button>')}
      ${row('Command Prompt', 'Command history', '<button class="btn" data-reset="webwin-cmd-history">Reset</button>')}
      ${row('Window positions', 'Where each app opens', '<button class="btn" data-reset="webwin-bounds-v1">Reset</button>')}`,

    accounts: () => `
      <h1>Your info</h1>
      <div class="acct-head"><div class="su-av big">${esc(userInitial())}</div><div><div class="acct-name">${esc(settings.userName)}</div><div class="sr-sub">Local Account<br>Administrator</div></div></div>
      ${row('Name', '', '<button class="btn" id="acct-rename">Change name</button>')}
      <h2>Sign-in options</h2>
      <div class="set-card">${I.key}<b style="margin-left:8px">Password</b>
        <div class="sr-sub" style="margin:6px 0 10px">${settings.passwordHash ? 'Your account has a password. You\'ll need it on the lock screen.' : 'Your account doesn\'t have a password. Anyone can sign in.'}</div>
        <button class="btn" id="acct-pw">${settings.passwordHash ? 'Change' : 'Add'}</button>
        ${settings.passwordHash ? '<button class="btn" id="acct-pwdel" style="margin-left:8px">Remove</button>' : ''}
      </div>
      ${row('Require sign-in', 'After waking from sleep', sw('set-reqsign', settings.requireSignIn))}
      ${row('Full screen when I sign in', 'Lets keys like Win and Alt+Tab work for real (uses the browser\'s keyboard lock)', sw('set-fullsign', settings.fullscreenOnSignIn))}`,

    time: () => {
      const tz = Intl.DateTimeFormat().resolvedOptions();
      return `
      <h1>Date &amp; time</h1>
      <div class="big-clock" id="big-clock"></div>
      ${row('Set time automatically', 'Synced with your real device', sw('set-autotime', true).replace('<input', '<input disabled'))}
      ${row('Time zone', '', `<b>${esc(tz.timeZone)}</b>`)}
      ${row('24-hour clock', '', sw('set-24', settings.clock24))}
      ${row('Show seconds in the taskbar clock', '', sw('set-secs', settings.clockSeconds))}
      <h2>Region &amp; language</h2>
      ${row('Windows display language', '', 'English (United States)')}
      ${row('Browser languages', '', esc((navigator.languages || [navigator.language]).join(', ')))}
      ${row('Regional format', '', esc(tz.locale))}`;
    },

    update: () => `
      <h1>Windows Update</h1>
      <div class="upd-card">${I.update}<div><b class="upd-status">You're up to date</b><div class="sr-sub upd-last">Last checked: ${esc(localStorage.getItem('webwin-lastupdate') || 'Never')}</div></div></div>
      <button class="btn primary" id="upd-check">Check for updates</button>
      <h2>Windows Security</h2>
      <div class="set-card sec-grid">
        <div>${I.shield}<span>Virus &amp; threat protection</span><b>No actions needed</b></div>
        <div>${I.lock}<span>Account protection</span><b>${settings.passwordHash ? 'No actions needed' : 'Add a password'}</b></div>
        <div>${I.wifi}<span>Firewall &amp; network</span><b>No actions needed</b></div>
        <div>${I.globe}<span>App &amp; browser control</span><b>${location.protocol === 'https:' || location.hostname === 'localhost' ? 'Secure context' : 'Insecure connection'}</b></div>
      </div>
      <h2>Recovery</h2>
      ${row('Reset this PC', 'Remove all files, settings and accounts and start over with first-time setup', '<button class="btn" id="set-factory">Get started</button>')}`,

    about: () => {
      const ua = navigator.userAgentData;
      const brand = ua && ua.brands ? ua.brands.map(b => b.brand).filter(b => !/not.?a.?brand/i.test(b)).join(' / ') : navigator.userAgent.match(/(Firefox|Edg|Chrome|Safari)\/[\d.]+/)?.[0] || 'Browser';
      return `
      <h1>About</h1>
      <div class="about-hero"><div class="win-logo-big">${I.windows.replace('<svg', '<svg width="66" height="66" style="color:var(--accent)"')}</div><div><b>Your PC is monitored and protected.</b><div class="sr-sub">See details in Windows Security</div></div></div>
      <h2>Device specifications</h2>
      <table class="about-table selectable">
        <tr><td>Device name</td><td>${esc(settings.pcName)}</td></tr>
        <tr><td>Processor</td><td>JavaScript engine · ${navigator.hardwareConcurrency || '?'} logical processors</td></tr>
        <tr><td>Installed RAM</td><td>${navigator.deviceMemory ? `${navigator.deviceMemory} GB (reported by your browser)` : 'Not reported by this browser'}</td></tr>
        <tr><td>Device ID</td><td>${esc(deviceId())}</td></tr>
        <tr><td>System type</td><td>${/arm|aarch/i.test(navigator.userAgent + (navigator.platform || '')) ? 'ARM-based' : '64-bit'} operating system, ${esc(navigator.userAgentData?.platform || navigator.platform || 'unknown')} host</td></tr>
        <tr><td>Pen and touch</td><td>${navigator.maxTouchPoints ? `Touch support with ${navigator.maxTouchPoints} touch points` : 'No pen or touch input is available for this display'}</td></tr>
        <tr><td>Screen</td><td>${screen.width} × ${screen.height}, ${screen.colorDepth}-bit color, ${Math.round(devicePixelRatio * 100)}% scale</td></tr>
        <tr><td>Browser</td><td>${esc(brand)}</td></tr>
      </table>
      <div style="margin-top:12px;display:flex;gap:8px"><button class="btn" id="about-copy">Copy</button><button class="btn" id="about-rename">Rename this PC</button></div>
      <h2>Windows specifications</h2>
      <table class="about-table selectable">
        <tr><td>Edition</td><td>Windows 10 Web Edition</td></tr>
        <tr><td>Version</td><td>22H2</td></tr>
        <tr><td>Installed on</td><td>${new Date(Number(localStorage.getItem('webwin-installed') || Date.now())).toLocaleDateString()}</td></tr>
        <tr><td>OS build</td><td>19045.web</td></tr>
      </table>
      <div class="set-card" style="margin-top:14px">A loving re-creation of the Windows 10 experience built with vanilla HTML, CSS and JavaScript. Not affiliated with Microsoft.</div>`;
    },
  };

  function deviceId() {
    let id = localStorage.getItem('webwin-deviceid');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).toUpperCase();
      try { localStorage.setItem('webwin-deviceid', id); } catch { /* ignore */ }
    }
    return id;
  }

  function bindSwitch(id, fn) {
    const el = content.querySelector('#' + id);
    if (el) el.addEventListener('change', () => { el.closest('.sr-right')?.querySelector('.sw-state') && (el.closest('.sr-right').querySelector('.sw-state').textContent = el.checked ? 'On' : 'Off'); fn(el.checked); });
  }

  function show(page) {
    timers.forEach(clearInterval); timers = [];
    current = page;
    selfChange = true;
    sideItems.forEach(s => s.classList.toggle('sel', s.dataset.page === page));
    content.innerHTML = pages[page]();
    content.scrollTop = 0;
    win.setTitle(page === 'home' ? 'Settings' : `Settings — ${PAGES.find(p => p.id === page).name}`);
    bind(page);
    selfChange = false;
  }

  const upd = (patch) => { selfChange = true; updateSettings(patch); selfChange = false; };

  function bind(page) {
    content.querySelectorAll('[data-go]').forEach(t => t.addEventListener('click', () => show(t.dataset.go)));

    /* system */
    const br = content.querySelector('#set-bright');
    if (br) br.addEventListener('input', () => upd({ brightness: +br.value }));
    bindSwitch('set-nightlight', v => upd({ nightlight: v }));
    const vol = content.querySelector('#set-vol');
    if (vol) {
      vol.addEventListener('input', () => { content.querySelector('.v-vol').textContent = vol.value; upd({ volume: +vol.value, muted: false }); });
      vol.addEventListener('change', () => playSound('ding', true));
    }
    bindSwitch('set-mute', v => upd({ muted: v }));
    bindSwitch('set-sounds', v => upd({ systemSounds: v }));
    bindSwitch('set-dnd', v => upd({ dnd: v }));
    bindSwitch('set-air', v => upd({ airplane: v }));
    bindSwitch('set-reqsign', v => upd({ requireSignIn: v }));
    bindSwitch('set-fullsign', v => upd({ fullscreenOnSignIn: v }));
    content.querySelector('#set-testsnd')?.addEventListener('click', () => playSound('notify', true));
    content.querySelector('#set-testnotif')?.addEventListener('click', () => notify('Test notification', 'Notifications are working. 🎉', I.bell2, { onClick: () => launch('settings', { page: 'system' }) }));
    const batCard = content.querySelector('#set-battery');
    if (batCard) {
      if (!navigator.getBattery) batCard.textContent = 'This browser doesn\'t report battery information.';
      else navigator.getBattery().then(b => {
        const desktop = b.charging && b.level === 1 && b.chargingTime === 0;
        batCard.innerHTML = desktop ? `${I.ethernet}<b style="margin-left:8px">Plugged in</b><div class="sr-sub">No battery detected — this PC runs on AC power.</div>`
          : `${I.battery}<b style="margin-left:8px">${Math.round(b.level * 100)}%</b> <span class="sr-sub">${b.charging ? 'Charging' : isFinite(b.dischargingTime) ? `About ${Math.floor(b.dischargingTime / 3600)} h ${Math.floor(b.dischargingTime % 3600 / 60)} min left` : 'On battery'}</span>
             <div class="drive-bar" style="height:10px;margin-top:8px"><div class="fill" style="width:${b.level * 100}%"></div></div>`;
      }).catch(() => { batCard.textContent = 'Battery information is unavailable.'; });
    }
    if (page === 'system') {
      const onResize = () => { const a = content.querySelector('.v-area'); if (a) a.textContent = `${innerWidth} × ${innerHeight}`; };
      window.addEventListener('resize', onResize);
      timers.push(setInterval(() => { if (current !== 'system') window.removeEventListener('resize', onResize); }, 1000));
    }

    /* storage */
    const sc = content.querySelector('#stor-card');
    if (sc) {
      diskInfo().then(d => {
        const cats = { Documents: 0, Pictures: 0, Music: 0, Videos: 0, Other: 0 };
        walk((n) => {
          if (n.type !== 'file') return;
          const k = kindOf(n), s = sizeOf(n);
          if (k === 'img') cats.Pictures += s; else if (k === 'audio') cats.Music += s; else if (k === 'video') cats.Videos += s;
          else if (k === 'txt' || k === 'pdf' || k === 'html') cats.Documents += s; else cats.Other += s;
        }, ROOT());
        const binSize = getBin().reduce((a, b) => a + sizeOf(b.node), 0);
        const all = { ...cats, 'Recycle Bin': binSize };
        const total = Object.values(all).reduce((a, b) => a + b, 0) || 1;
        const colors = ['#0078d7', '#e3008c', '#ff8c00', '#8764b8', '#767676', '#107c10'];
        sc.innerHTML = `
          <div class="stor-head">${I.drive}<div><b>Local Disk (C:)</b><div class="sr-sub">${formatSize(d.used)} used by files · ${formatSize(d.free)} free of ${formatSize(d.quota)}</div></div></div>
          <div class="stor-bar">${Object.values(all).map((v, i) => `<span style="width:${Math.max(0, v / total * 100)}%;background:${colors[i]}"></span>`).join('')}</div>
          ${Object.entries(all).map(([k, v], i) => `<div class="stor-row"><span class="dot" style="background:${colors[i]}"></span><span>${k}</span><b>${formatSize(v)}</b></div>`).join('')}
          <div class="sr-sub" style="margin-top:8px">The browser lets this site use up to ${formatSize(d.quota)} (currently ${formatSize(d.browserUsage)} including caches).</div>`;
      });
      const ps = content.querySelector('#stor-persist');
      if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(p => {
        ps.innerHTML = p ? '<b>On</b>' : '<button class="btn" id="stor-ask">Turn on</button>';
        ps.querySelector('#stor-ask')?.addEventListener('click', async () => {
          const ok = await navigator.storage.persist();
          ps.innerHTML = ok ? '<b>On</b>' : 'The browser declined (try again after using the PC more, or bookmark it).';
        });
      }); else ps.textContent = 'Not supported';
      content.querySelector('#set-emptybin')?.addEventListener('click', async () => {
        if (await confirmDialog('Empty Recycle Bin', `Permanently delete ${getBin().length} item(s)?`, 'Yes', 'No', 'warn')) { emptyBin(); playSound('recycle'); show('storage'); }
      });
      content.querySelector('#set-resetfs')?.addEventListener('click', async () => {
        const ok = await confirmDialog('Reset file system', 'This deletes all files you created and restores the defaults. Continue?', 'Reset', 'Cancel', 'warn');
        if (ok) { await resetFS(); notify('Storage', 'The file system was reset.', I.storage); show('storage'); }
      });
    }

    /* personalization */
    const bgType = content.querySelector('#bg-type');
    if (bgType) {
      const repaintPreview = () => {
        const s = content.querySelector('#pp-screen');
        if (!s) return;
        const wp = document.getElementById('wallpaper');
        s.className = 'pp-screen ' + wp.className;
        s.style.background = wp.style.background;
      };
      repaintPreview();
      bgType.addEventListener('change', () => {
        content.querySelectorAll('.bg-sec').forEach(x => x.classList.toggle('hidden', x.dataset.sec !== bgType.value));
        if (bgType.value === 'solid') upd({ wallpaper: 'solid' });
        if (bgType.value === 'preset' && (settings.wallpaper === 'solid' || settings.wallpaper === 'picture')) upd({ wallpaper: 'hero' });
        repaintPreview();
      });
      content.querySelectorAll('.wp-thumb[data-wp]').forEach(t => t.addEventListener('click', () => {
        upd({ wallpaper: t.dataset.wp });
        content.querySelectorAll('.wp-thumb').forEach(x => x.classList.toggle('sel', x === t));
        repaintPreview();
      }));
      const pics = [];
      walk((n, p) => { if (n.type === 'file' && kindOf(n) === 'img' && n.content) pics.push({ n, p }); return pics.length < 24; }, ROOT());
      content.querySelectorAll('.wp-thumb[data-pic]').forEach(t => t.addEventListener('click', () => {
        selfChange = true; setWallpaper(pics[+t.dataset.pic].p); selfChange = false;
        content.querySelectorAll('.wp-thumb').forEach(x => x.classList.toggle('sel', x === t));
        repaintPreview();
      }));
      content.querySelector('#bg-browse').addEventListener('click', async () => {
        const p = await fileDialog({ mode: 'open', title: 'Choose your picture', startDir: KNOWN.pictures, kinds: ['img'], filterLabel: 'Image files' });
        if (p) { setWallpaper(p); show('personalization'); }
      });
      content.querySelector('#bg-upload').addEventListener('click', async () => {
        const names = await pickAndImport(KNOWN.pictures, 'image/*');
        if (names.length) { setWallpaper([...KNOWN.pictures, names[0]]); show('personalization'); }
      });
      content.querySelectorAll('[data-solid]').forEach(c => c.addEventListener('click', () => {
        upd({ wallpaper: 'solid', solidColor: c.dataset.solid });
        content.querySelectorAll('[data-solid]').forEach(x => x.classList.toggle('sel', x === c));
        repaintPreview();
      }));
      content.querySelector('#solid-custom').addEventListener('input', (e) => { upd({ wallpaper: 'solid', solidColor: e.target.value }); repaintPreview(); });
    }
    content.querySelectorAll('.accent-cell[data-accent]').forEach(c => c.addEventListener('click', () => {
      upd({ accent: c.dataset.accent });
      content.querySelectorAll('.accent-cell[data-accent]').forEach(x => x.classList.toggle('sel', x === c));
    }));
    content.querySelector('#accent-custom')?.addEventListener('input', (e) => upd({ accent: e.target.value }));
    content.querySelectorAll('input[name="theme"]').forEach(r => r.addEventListener('change', () => { if (r.checked) upd({ theme: r.value }); }));
    bindSwitch('set-transp', v => upd({ transparency: v }));
    bindSwitch('set-taskbaraccent', v => upd({ taskbarAccent: v }));
    content.querySelector('#set-search')?.addEventListener('change', (e) => upd({ searchMode: e.target.value }));
    content.querySelector('#set-iconsize')?.addEventListener('change', (e) => upd({ iconSize: e.target.value }));
    content.querySelector('#set-resetpins')?.addEventListener('click', () => { upd({ pinned: ['explorer', 'edge', 'notepad', 'calculator', 'paint', 'terminal'] }); show('personalization'); });
    content.querySelector('#set-resettiles')?.addEventListener('click', () => { upd({ tiles: null }); notify('Start', 'Start tiles were restored.', I.start, { silent: true }); });

    /* apps */
    Object.keys(APPS).forEach(id => bindSwitch('su-' + id, v => upd({ startupApps: v ? [...settings.startupApps, id] : settings.startupApps.filter(x => x !== id) })));
    content.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Reset app data', 'This permanently deletes this app\'s data. Continue?', 'Reset', 'Cancel', 'warn'))) return;
      try { localStorage.removeItem(b.dataset.reset); } catch { /* ignore */ }
      b.textContent = 'Done ✓'; b.disabled = true;
    }));

    /* accounts */
    content.querySelector('#acct-rename')?.addEventListener('click', async () => {
      const n = await promptDialog('Change your account name', 'New name:', settings.userName, '', { validate: (v) => (!v ? 'Enter a name' : /[\\/:*?"<>|]/.test(v) ? 'A name can\'t contain \\ / : * ? " < > |' : null) });
      if (n) { upd({ userName: n }); show('accounts'); }
    });
    content.querySelector('#acct-pw')?.addEventListener('click', async () => {
      if (settings.passwordHash) {
        const cur = await promptDialog('Change your password', 'Current password:', '', '', { password: true });
        if (cur == null) return;
        if (!(await checkPassword(cur))) { msgDialog('Change your password', 'The password is incorrect.', 'error'); return; }
      }
      const pw = await promptDialog('Create a password', 'New password:', '', '', { password: true, validate: (v) => (v ? null : 'Enter a password') });
      if (pw == null) return;
      const pw2 = await promptDialog('Create a password', 'Re-enter password:', '', '', { password: true });
      if (pw2 == null) return;
      if (pw !== pw2) { msgDialog('Create a password', 'The passwords don\'t match.', 'error'); return; }
      const hint = await promptDialog('Create a password', 'Password hint (optional):', settings.passwordHint || '');
      upd({ passwordHash: await hashPassword(pw), passwordHint: hint || null });
      notify('Accounts', 'Your password was saved. You\'ll use it the next time you sign in.', I.key);
      show('accounts');
    });
    content.querySelector('#acct-pwdel')?.addEventListener('click', async () => {
      const cur = await promptDialog('Remove password', 'Current password:', '', '', { password: true });
      if (cur == null) return;
      if (!(await checkPassword(cur))) { msgDialog('Remove password', 'The password is incorrect.', 'error'); return; }
      upd({ passwordHash: null, passwordHint: null });
      show('accounts');
    });

    /* time */
    bindSwitch('set-24', v => upd({ clock24: v }));
    bindSwitch('set-secs', v => upd({ clockSeconds: v }));
    const bc = content.querySelector('#big-clock');
    if (bc) {
      const tickC = () => { const d = new Date(); bc.innerHTML = `<div class="bc-t">${d.toLocaleTimeString('en-US', { hour12: !settings.clock24 })}</div><div class="sr-sub">${d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>`; };
      tickC(); timers.push(setInterval(tickC, 1000));
    }

    /* update */
    content.querySelector('#upd-check')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const status = content.querySelector('.upd-status');
      btn.disabled = true;
      status.textContent = 'Checking for updates…';
      setTimeout(() => {
        const when = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
        try { localStorage.setItem('webwin-lastupdate', 'Today, ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })); } catch { /* ignore */ }
        if (!navigator.onLine || settings.airplane) { status.textContent = 'We couldn\'t connect to the update service. Check your connection.'; }
        else { status.textContent = 'You\'re up to date'; content.querySelector('.upd-last').textContent = `Last checked: ${when}`; }
        btn.disabled = false;
      }, 2400);
    });
    content.querySelector('#set-factory')?.addEventListener('click', async () => {
      const ok = await confirmDialog('Reset this PC', '<b>This removes everything</b>: your files, apps data, settings, account and password.<br><br>The PC will restart and run first-time setup.', 'Reset', 'Cancel', 'warn');
      if (!ok) return;
      await eraseAll();
      resetSettings();
      try { Object.keys(localStorage).filter(k => k.startsWith('webwin')).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
      location.hash = '';
      location.reload();
    });

    /* about */
    content.querySelector('#about-copy')?.addEventListener('click', async () => {
      const txt = [...content.querySelectorAll('.about-table tr')].map(tr => [...tr.children].map(td => td.textContent).join('\t')).join('\n');
      try { await navigator.clipboard.writeText(txt); notify('Settings', 'Device specifications copied to the clipboard.', I.copy, { silent: true }); } catch { /* ignore */ }
    });
    content.querySelector('#about-rename')?.addEventListener('click', async () => {
      const n = await promptDialog('Rename your PC', 'You can use a combination of letters, hyphens and numbers.', settings.pcName, '', {
        validate: (v) => (/^[A-Za-z0-9-]{1,15}$/.test(v) ? null : 'Use up to 15 letters, numbers and hyphens'),
      });
      if (n) { upd({ pcName: n.toUpperCase() }); notify('Rename your PC', 'Your PC will be renamed after you restart.', I.restart, { actions: [{ label: 'Restart now', action: () => window.dispatchEvent(new CustomEvent('webwin:restart')) }] }); show('about'); }
    });
  }

  let selfChange = false;
  sideItems.forEach(s => s.addEventListener('click', () => show(s.dataset.page)));
  win.onRelaunch = (a) => { if (a && a.page) show(a.page); };
  show(arg && arg.page && pages[arg.page] ? arg.page : 'home');

  /* live-refresh if settings changed from somewhere else */
  const off = onSettingsChange(() => { if (!selfChange && !content.contains(document.activeElement)) show(current); });
  win.onclose(() => { off(); timers.forEach(clearInterval); });
  return win;
}

