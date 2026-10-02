/* Microsoft Edge — tabs, real browsing in iframes, favorites, history, local files (file:///C:/…), offline handling. */
import { createWindow } from '../wm.js';
import { I } from '../icons.js';
import { getNode, parsePath, canonical, addressOf, kindOf } from '../fs.js';
import { nodeBlob } from '../fileops.js';
import { contextMenu, esc } from '../ui.js';
import { settings, onSettingsChange } from '../settings.js';
import { launch } from './registry.js';

const STORE_KEY = 'webwin-edge-v1';
function loadStore() {
  try { return { favorites: [], history: [], engine: 'bing', ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { return { favorites: [], history: [], engine: 'bing' }; }
}
let store = loadStore();
const saveStore = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* ignore */ } };

const QUICK_LINKS = [
  { name: 'Bing', url: 'https://www.bing.com', icon: I.search },
  { name: 'Google', url: 'https://www.google.com/?igu=1', icon: I.globe },
  { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page', icon: I.info },
  { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/export/embed.html?bbox=31.1,29.95,31.4,30.15&layer=mapnik', icon: I.globe },
  { name: 'Internet Archive', url: 'https://archive.org', icon: I.history },
  { name: 'First website', url: 'http://info.cern.ch', icon: I.globe },
  { name: 'Example', url: 'https://example.com', icon: I.globe },
  { name: 'About Edge', url: 'edge://about', icon: I.edge },
];

/* sites that refuse to be shown inside frames (X-Frame-Options / frame-ancestors) */
const BLOCKED = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'github.com', 'reddit.com', 'amazon.', 'netflix.com',
  'whatsapp.com', 'web.whatsapp.com', 'chatgpt.com', 'openai.com', 'claude.ai', 'tiktok.com', 'duckduckgo.com', 'stackoverflow.com', 'microsoft.com',
  'live.com', 'outlook.com', 'gmail.com', 'mail.google.com', 'accounts.google.com', 'apple.com', 'spotify.com', 'twitch.tv', 'discord.com', 'paypal.com', 'yahoo.com', 'pinterest.com'];

const SEARCH = {
  bing: (q) => 'https://www.bing.com/search?q=' + encodeURIComponent(q),
  google: (q) => 'https://www.google.com/search?igu=1&q=' + encodeURIComponent(q),
  wikipedia: (q) => 'https://en.wikipedia.org/w/index.php?search=' + encodeURIComponent(q),
};

function normalizeInput(raw) {
  const v = raw.trim();
  if (!v) return null;
  if (/^(edge|about):/i.test(v)) return v.replace(/^about:/i, 'edge://').toLowerCase();
  if (/^file:\/\//i.test(v)) return v;
  if (/^[a-z]:\\/i.test(v) || /^[a-z]:\//i.test(v)) return 'file:///' + v.replace(/\\/g, '/');
  if (/^https?:\/\//i.test(v)) return v;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(v)) return 'http://' + v;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(v) && !/\s/.test(v)) return 'https://' + v;
  return (SEARCH[store.engine] || SEARCH.bing)(v);
}

/* make well-known sites embeddable */
function rewrite(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtube.com' && u.pathname === '/watch' && u.searchParams.get('v')) return `https://www.youtube.com/embed/${u.searchParams.get('v')}?autoplay=1`;
    if (host === 'youtu.be' && u.pathname.length > 1) return `https://www.youtube.com/embed${u.pathname}?autoplay=1`;
    if (host === 'google.com' && !u.searchParams.has('igu') && (u.pathname === '/' || u.pathname === '/search')) { u.searchParams.set('igu', '1'); return u.toString(); }
  } catch { /* not a URL */ }
  return url;
}
function isBlocked(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (/youtube\.com$/.test(host) && !new URL(url).pathname.startsWith('/embed')) return true;
    return BLOCKED.some(b => b.endsWith('.') ? host.includes(b) : host === b || host.endsWith('.' + b));
  } catch { return false; }
}

export function open(arg = null) {
  const win = createWindow({ title: 'New tab - Microsoft Edge', icon: I.edge, appId: 'edge', w: 980, h: 640, minW: 480, minH: 320 });

  win.body.innerHTML = `
    <div class="edge" tabindex="-1">
      <div class="edge-tabs"></div>
      <div class="edge-nav">
        <button class="toolbar-btn e-back" title="Back (Alt+Left)">${I.arrowLeft}</button>
        <button class="toolbar-btn e-fwd" title="Forward (Alt+Right)">${I.arrowRight}</button>
        <button class="toolbar-btn e-reload" title="Refresh (F5)">${I.refresh}</button>
        <button class="toolbar-btn e-home" title="Home">${I.home}</button>
        <div class="edge-addr"><span class="e-lock"></span><input type="text" placeholder="Search or enter web address" spellcheck="false"><button class="e-star" title="Add this page to favorites (Ctrl+D)"></button></div>
        <button class="toolbar-btn e-favs" title="Favorites (Ctrl+Shift+O)">${I.starFill}</button>
        <button class="toolbar-btn e-openreal" title="Open in your real browser">${I.external}</button>
        <button class="toolbar-btn e-menu" title="Settings and more (Alt+F)">${I.more}</button>
      </div>
      <div class="edge-favbar"></div>
      <div class="edge-view">
        <div class="edge-loadbar"></div>
      </div>
    </div>`;

  const root = win.body.querySelector('.edge');
  const tabsEl = root.querySelector('.edge-tabs');
  const view = root.querySelector('.edge-view');
  const loadbar = root.querySelector('.edge-loadbar');
  const addrInput = root.querySelector('.edge-addr input');
  const lockEl = root.querySelector('.e-lock');
  const starBtn = root.querySelector('.e-star');
  const favBar = root.querySelector('.edge-favbar');
  const backBtn = root.querySelector('.e-back'), fwdBtn = root.querySelector('.e-fwd');

  const tabs = [];
  let active = null;
  let tabId = 1;

  const newTabBtn = document.createElement('div');
  newTabBtn.className = 'et-new';
  newTabBtn.textContent = '+';
  newTabBtn.title = 'New tab (Ctrl+T)';
  newTabBtn.addEventListener('click', () => createTab('edge://newtab'));
  tabsEl.appendChild(newTabBtn);

  function createTab(url = 'edge://newtab', background = false) {
    const tab = { id: tabId++, url: null, title: 'New tab', history: [], hIndex: -1, el: null, pageEl: null };
    tabs.push(tab);
    const tabEl = document.createElement('div');
    tabEl.className = 'edge-tab';
    tabEl.innerHTML = `<span class="et-ic">${I.globe}</span><span class="et-title">New tab</span><span class="et-x" title="Close tab (Ctrl+W)">✕</span>`;
    tabEl.addEventListener('click', (e) => {
      if (e.target.closest('.et-x')) { closeTab(tab); return; }
      setActive(tab);
    });
    tabEl.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab); });
    tabsEl.insertBefore(tabEl, newTabBtn);
    tab.el = tabEl;
    if (!background) setActive(tab);
    navigate(tab, url);
    return tab;
  }

  function closeTab(tab) {
    const idx = tabs.indexOf(tab);
    tab.el.remove();
    if (tab.pageEl) tab.pageEl.remove();
    tabs.splice(idx, 1);
    if (!tabs.length) { win.close(); return; }
    if (active === tab) setActive(tabs[Math.min(idx, tabs.length - 1)]);
  }

  function setActive(tab) {
    active = tab;
    tabs.forEach(t => {
      t.el.classList.toggle('active', t === tab);
      if (t.pageEl) t.pageEl.classList.toggle('hidden', t !== tab);
    });
    syncChrome();
  }

  function syncChrome() {
    if (!active) return;
    const u = active.url || '';
    addrInput.value = u === 'edge://newtab' ? '' : u;
    lockEl.innerHTML = u.startsWith('https://') ? I.lock : u.startsWith('edge://') || u.startsWith('file://') ? '' : u ? I.info : '';
    lockEl.title = u.startsWith('https://') ? 'Connection is secure' : u.startsWith('http://') ? 'Not secure' : '';
    backBtn.disabled = active.hIndex <= 0;
    fwdBtn.disabled = active.hIndex >= active.history.length - 1;
    const fav = store.favorites.some(f => f.url === u);
    starBtn.innerHTML = fav ? I.starFill : I.star;
    starBtn.classList.toggle('hidden', !u || u.startsWith('edge://'));
    win.setTitle(`${active.title} - Microsoft Edge`);
    renderFavBar();
  }

  function setTabTitle(tab, title, icon = I.globe) {
    tab.title = title;
    tab.el.querySelector('.et-title').textContent = title;
    tab.el.querySelector('.et-ic').innerHTML = icon;
    tab.el.title = title;
    if (tab === active) win.setTitle(`${title} - Microsoft Edge`);
  }

  function navigate(tab, url, pushHist = true) {
    url = rewrite(url);
    if (pushHist) {
      tab.history = tab.history.slice(0, tab.hIndex + 1);
      tab.history.push(url);
      tab.hIndex = tab.history.length - 1;
    }
    tab.url = url;
    renderPage(tab);
    if (/^https?:/i.test(url)) {
      store.history.unshift({ url, title: tab.title, time: Date.now() });
      store.history = store.history.slice(0, 300);
      saveStore();
    }
    if (tab === active) syncChrome();
  }

  function page(tab, html, cls = '') {
    if (tab.pageEl) tab.pageEl.remove();
    const p = document.createElement('div');
    p.className = 'edge-page ' + cls;
    if (tab !== active) p.classList.add('hidden');
    p.innerHTML = html;
    view.appendChild(p);
    tab.pageEl = p;
    return p;
  }

  function renderPage(tab) {
    const url = tab.url;
    if (!url || url === 'edge://newtab' || url === 'edge://home') { renderNewTab(tab); return; }
    if (url === 'edge://about' || url === 'edge://settings') { renderAbout(tab); return; }
    if (url === 'edge://history') { renderHistory(tab); return; }
    if (url === 'edge://favorites') { renderFavorites(tab); return; }
    if (url.startsWith('edge://')) {
      setTabTitle(tab, 'Error');
      page(tab, `<div class="edge-msg"><h1>Hmmm… can't reach this page</h1><p>${esc(url)} isn't a page Edge knows about.</p></div>`);
      return;
    }
    if (url.startsWith('file:///')) { renderLocal(tab); return; }

    let host = url;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }

    if (settings.airplane || !navigator.onLine) {
      setTabTitle(tab, host);
      const p = page(tab, `<div class="edge-msg"><div class="em-ic">${I.offline}</div><h1>You're not connected</h1><p>And the web just isn't the same without you.</p>
        <p>Let's get you back online!</p><ul><li>${settings.airplane ? 'Turn off Airplane mode' : 'Check your network cables, modem, and router'}</li><li>Reconnect to Wi-Fi</li></ul><button class="btn primary em-retry">Refresh</button></div>`);
      p.querySelector('.em-retry').addEventListener('click', () => renderPage(tab));
      return;
    }
    if (isBlocked(url)) {
      setTabTitle(tab, host);
      const p = page(tab, `<div class="edge-msg"><div class="em-ic">${I.warning}</div><h1>${esc(host)} refused to connect.</h1>
        <p>This website doesn't allow itself to be displayed inside another page, so it can't open in this window.</p>
        <button class="btn primary em-real">Open ${esc(host)} in a new browser tab ↗</button></div>`);
      p.querySelector('.em-real').addEventListener('click', () => window.open(url, '_blank', 'noopener'));
      return;
    }

    /* real site via iframe */
    setTabTitle(tab, host);
    const p = page(tab, '');
    loadbar.style.transition = 'none'; loadbar.style.width = '0';
    requestAnimationFrame(() => { loadbar.style.transition = ''; loadbar.style.width = '70%'; });
    const iframe = document.createElement('iframe');
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture; geolocation; clipboard-write');
    iframe.setAttribute('allowfullscreen', '');
    iframe.addEventListener('load', () => {
      loadbar.style.width = '100%';
      setTimeout(() => { loadbar.style.width = '0'; }, 300);
      /* same-origin pages (e.g. local files) can tell us their title */
      try { const t = iframe.contentDocument && iframe.contentDocument.title; if (t) setTabTitle(tab, t); } catch { /* cross-origin */ }
    });
    iframe.src = url;
    p.appendChild(iframe);
  }

  function renderNewTab(tab) {
    setTabTitle(tab, 'New tab', I.edge);
    const favs = store.favorites.slice(0, 8);
    const links = [...favs.map(f => ({ name: f.title, url: f.url, icon: I.starFill })), ...QUICK_LINKS].slice(0, 12);
    const p = page(tab, `
      <div class="edge-home">
        <div class="eh-title">${I.edge}<span>Where to next?</span></div>
        <div class="edge-search">${I.search}<input type="text" placeholder="Search the web"><select class="eh-engine" title="Search engine">
          <option value="bing">Bing</option><option value="google">Google</option><option value="wikipedia">Wikipedia</option></select></div>
        <div class="edge-quick"></div>
        <div class="eh-clock"></div>
      </div>`);
    const inp = p.querySelector('.edge-search input');
    const eng = p.querySelector('.eh-engine');
    eng.value = store.engine;
    eng.addEventListener('change', () => { store.engine = eng.value; saveStore(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value.trim()) navigate(tab, normalizeInput(inp.value)); });
    const quick = p.querySelector('.edge-quick');
    for (const q of links) {
      const el = document.createElement('div');
      el.className = 'eh-link';
      el.innerHTML = `<span class="lbox">${q.icon}</span><span>${esc(q.name)}</span>`;
      el.addEventListener('click', () => navigate(tab, q.url));
      quick.appendChild(el);
    }
    p.querySelector('.eh-clock').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (tab === active) setTimeout(() => inp.focus(), 50);
  }

  function renderAbout(tab) {
    setTabTitle(tab, 'About Microsoft Edge', I.edge);
    page(tab, `
      <div class="edge-msg">
        <div style="margin-bottom:16px">${I.edge.replace('<svg', '<svg width="72" height="72"')}</div>
        <h1>Microsoft Edge</h1>
        <p>Web Edition — running inside a Windows 10 that runs inside your real browser.</p>
        <p>Sites that allow embedding (Bing, Google, Wikipedia, YouTube videos, maps…) open right here. Others open in a real tab.</p>
        <p class="em-small">Your browser: ${esc(navigator.userAgent)}</p>
      </div>`);
  }

  function renderHistory(tab) {
    setTabTitle(tab, 'History', I.history);
    const groups = {};
    for (const h of store.history) {
      const d = new Date(h.time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      (groups[d] = groups[d] || []).push(h);
    }
    const p = page(tab, `<div class="edge-list"><div class="el-head"><h1>History</h1><button class="btn el-clear">Clear browsing data</button></div>
      ${Object.keys(groups).length ? Object.entries(groups).map(([d, list]) => `<h2>${d}</h2>` + list.map((h, i) => `<div class="el-row" data-url="${esc(h.url)}"><span class="el-time">${new Date(h.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span><span class="el-t">${esc(h.title || h.url)}</span><span class="el-u">${esc(h.url)}</span></div>`).join('')).join('') : '<p class="el-empty">Your browsing history will show up here.</p>'}</div>`);
    p.querySelectorAll('.el-row').forEach(r => r.addEventListener('click', () => navigate(tab, r.dataset.url)));
    p.querySelector('.el-clear').addEventListener('click', () => { store.history = []; saveStore(); renderHistory(tab); });
  }

  function renderFavorites(tab) {
    setTabTitle(tab, 'Favorites', I.starFill);
    const p = page(tab, `<div class="edge-list"><div class="el-head"><h1>Favorites</h1></div>
      ${store.favorites.length ? store.favorites.map((f, i) => `<div class="el-row" data-i="${i}">${I.starFill}<span class="el-t">${esc(f.title)}</span><span class="el-u">${esc(f.url)}</span><button class="el-del" title="Delete">✕</button></div>`).join('') : '<p class="el-empty">Add pages with the ☆ in the address bar.</p>'}</div>`);
    p.querySelectorAll('.el-row').forEach(r => {
      r.addEventListener('click', (e) => {
        if (e.target.closest('.el-del')) { store.favorites.splice(+r.dataset.i, 1); saveStore(); renderFavorites(tab); syncChrome(); return; }
        navigate(tab, store.favorites[+r.dataset.i].url);
      });
    });
  }

  /* file:///C:/Users/... — show files from the virtual disk */
  function renderLocal(tab) {
    const raw = decodeURIComponent(tab.url.replace(/^file:\/\/\//i, ''));
    const path = parsePath(raw);
    const node = path && getNode(path);
    if (!node) {
      setTabTitle(tab, 'Error');
      page(tab, `<div class="edge-msg"><h1>Your file couldn't be accessed</h1><p>It may have been moved, edited, or deleted.</p><p class="em-small">ERR_FILE_NOT_FOUND</p></div>`);
      return;
    }
    setTabTitle(tab, node.name, I.htmlfile);
    if (node.type === 'folder') {
      const cp = canonical(path);
      const p = page(tab, `<div class="edge-list"><h1>Index of ${esc(addressOf(cp))}</h1>
        ${cp.length ? `<div class="el-row" data-n="..">[parent directory]</div>` : ''}
        ${node.children.map(c => `<div class="el-row" data-n="${esc(c.name)}">${c.type === 'folder' ? '📁' : '📄'} <span class="el-t">${esc(c.name)}</span></div>`).join('')}</div>`);
      p.querySelectorAll('.el-row').forEach(r => r.addEventListener('click', () => {
        const next = r.dataset.n === '..' ? cp.slice(0, -1) : [...cp, r.dataset.n];
        navigate(tab, 'file:///' + addressOf(next).replace(/\\/g, '/'));
      }));
      return;
    }
    const k = kindOf(node);
    const p = page(tab, '', 'local');
    if (k === 'html') {
      const fr = document.createElement('iframe');
      fr.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
      fr.srcdoc = node.content || '';
      p.appendChild(fr);
      const m = /<title>([^<]*)<\/title>/i.exec(node.content || '');
      if (m) setTabTitle(tab, m[1], I.htmlfile);
    } else if (k === 'img') {
      p.innerHTML = `<div class="edge-imgview"><img src="${esc(node.content)}" alt=""></div>`;
    } else if (k === 'audio' || k === 'video') {
      p.innerHTML = `<div class="edge-imgview"><${k === 'audio' ? 'audio' : 'video'} controls autoplay src="${esc(node.content)}"></${k === 'audio' ? 'audio' : 'video'}></div>`;
    } else if (k === 'pdf' || (node.content || '').startsWith('data:')) {
      const url = URL.createObjectURL(nodeBlob(node));
      const fr = document.createElement('iframe');
      fr.src = url;
      p.appendChild(fr);
      win.onclose(() => URL.revokeObjectURL(url));
    } else {
      p.innerHTML = `<pre class="edge-pre selectable">${esc(node.content || '')}</pre>`;
    }
  }

  /* ---------- favorites ---------- */
  function renderFavBar() {
    favBar.innerHTML = '';
    favBar.classList.toggle('hidden', !store.favorites.length);
    for (const f of store.favorites.slice(0, 12)) {
      const b = document.createElement('button');
      b.className = 'fb-item';
      b.innerHTML = `${I.globe}<span>${esc(f.title)}</span>`;
      b.title = f.url;
      b.addEventListener('click', () => navigate(active, f.url));
      b.addEventListener('auxclick', (e) => { if (e.button === 1) createTab(f.url, true); });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        contextMenu(e.clientX, e.clientY, [
          { label: 'Open in new tab', action: () => createTab(f.url) },
          { label: 'Delete', icon: I.trash, action: () => { store.favorites = store.favorites.filter(x => x !== f); saveStore(); syncChrome(); } },
        ]);
      });
      favBar.appendChild(b);
    }
  }
  function toggleFavorite() {
    const u = active && active.url;
    if (!u || u.startsWith('edge://')) return;
    const i = store.favorites.findIndex(f => f.url === u);
    if (i >= 0) store.favorites.splice(i, 1);
    else store.favorites.push({ url: u, title: active.title || u });
    saveStore();
    syncChrome();
  }

  /* ---------- controls ---------- */
  addrInput.addEventListener('focus', () => setTimeout(() => addrInput.select(), 0));
  addrInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const url = normalizeInput(addrInput.value);
      if (url) { navigate(active, url); addrInput.blur(); }
    } else if (e.key === 'Escape') { syncChrome(); addrInput.blur(); }
  });
  const back = () => { if (active && active.hIndex > 0) { active.hIndex--; navigate(active, active.history[active.hIndex], false); } };
  const fwd = () => { if (active && active.hIndex < active.history.length - 1) { active.hIndex++; navigate(active, active.history[active.hIndex], false); } };
  backBtn.addEventListener('click', back);
  fwdBtn.addEventListener('click', fwd);
  root.querySelector('.e-reload').addEventListener('click', () => active && renderPage(active));
  root.querySelector('.e-home').addEventListener('click', () => navigate(active, 'edge://newtab'));
  starBtn.addEventListener('click', toggleFavorite);
  root.querySelector('.e-openreal').addEventListener('click', () => {
    if (active && active.url && /^https?:/i.test(active.url)) window.open(active.url, '_blank', 'noopener');
  });
  root.querySelector('.e-favs').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.right - 260, r.bottom + 4, [
      { label: active && store.favorites.some(f => f.url === active.url) ? 'Remove this page from favorites' : 'Add this page to favorites', icon: I.star, action: toggleFavorite },
      { label: 'Manage favorites', icon: I.starFill, action: () => createTab('edge://favorites') },
      ...(store.favorites.length ? ['-'] : []),
      ...store.favorites.slice(0, 15).map(f => ({ label: f.title, icon: I.globe, action: () => navigate(active, f.url) })),
    ]);
  });
  root.querySelector('.e-menu').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.right - 240, r.bottom + 4, [
      { label: 'New tab', hint: 'Ctrl+T', action: () => createTab() },
      { label: 'New window', hint: 'Ctrl+N', action: () => launch('edge') },
      '-',
      { label: 'Favorites', hint: 'Ctrl+Shift+O', icon: I.starFill, action: () => createTab('edge://favorites') },
      { label: 'History', hint: 'Ctrl+H', icon: I.history, action: () => createTab('edge://history') },
      '-',
      { label: 'Search engine', submenu: Object.keys(SEARCH).map(k => ({ label: k[0].toUpperCase() + k.slice(1), checked: store.engine === k, action: () => { store.engine = k; saveStore(); } })) },
      { label: 'Open in your real browser', icon: I.external, disabled: !(active && /^https?:/.test(active.url || '')), action: () => window.open(active.url, '_blank', 'noopener') },
      '-',
      { label: 'About Microsoft Edge', icon: I.info, action: () => createTab('edge://about') },
      { label: 'Close Microsoft Edge', action: () => win.close() },
    ]);
  });

  root.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === 't') { e.preventDefault(); createTab(); }
    else if (e.ctrlKey && k === 'w') { e.preventDefault(); if (active) closeTab(active); }
    else if (e.ctrlKey && k === 'n') { e.preventDefault(); launch('edge'); }
    else if (e.ctrlKey && k === 'l' || e.key === 'F6') { e.preventDefault(); addrInput.focus(); }
    else if (e.ctrlKey && k === 'd') { e.preventDefault(); toggleFavorite(); }
    else if (e.ctrlKey && k === 'h') { e.preventDefault(); createTab('edge://history'); }
    else if (e.ctrlKey && e.shiftKey && k === 'o') { e.preventDefault(); createTab('edge://favorites'); }
    else if (e.ctrlKey && k === 'tab') { e.preventDefault(); const i = tabs.indexOf(active); setActive(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]); }
    else if (e.key === 'F5' || (e.ctrlKey && k === 'r')) { e.preventDefault(); renderPage(active); }
    else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); fwd(); }
  });

  const offSettings = onSettingsChange((s, patch) => { if (patch && 'airplane' in patch && active && /^https?:/.test(active.url || '')) renderPage(active); });
  win.onclose(offSettings);

  win.onRelaunch = null;
  let first = 'edge://newtab';
  if (arg && arg.url) first = normalizeInput(arg.url) || first;
  else if (arg && arg.path) first = 'file:///' + addressOf(arg.path).replace(/\\/g, '/');
  createTab(first);
  return win;
}
