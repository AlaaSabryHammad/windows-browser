/* Microsoft Edge (web browser with tabs, internal pages, real iframe browsing) */
import { createWindow } from '../wm.js';
import { I } from '../icons.js';

const QUICK_LINKS = [
  { name: 'Example.com', url: 'https://example.com', icon: I.globe },
  { name: 'Wikipedia', url: 'https://en.m.wikipedia.org/wiki/Microsoft_Windows', icon: I.info },
  { name: 'CERN Info', url: 'http://info.cern.ch', icon: I.globe },
  { name: 'About Edge', url: 'edge://about', icon: I.edge },
];

function normalizeInput(raw) {
  const v = raw.trim();
  if (!v) return null;
  if (v.startsWith('edge://')) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v)) return 'https://' + v;
  return 'https://www.bing.com/search?q=' + encodeURIComponent(v);
}

export function open(arg = null) {
  const win = createWindow({ title: 'New tab - Microsoft Edge', icon: I.edge, appId: 'edge', w: 920, h: 600, minW: 480, minH: 320 });

  win.body.innerHTML = `
    <div class="edge">
      <div class="edge-tabs"></div>
      <div class="edge-nav">
        <button class="toolbar-btn e-back" title="Back">${I.arrowLeft}</button>
        <button class="toolbar-btn e-fwd" title="Forward">${I.arrowRight}</button>
        <button class="toolbar-btn e-reload" title="Refresh">${I.refresh}</button>
        <button class="toolbar-btn e-home" title="Home">${I.home}</button>
        <div class="edge-addr">${I.search}<input type="text" placeholder="Search or enter web address" spellcheck="false"></div>
      </div>
      <div class="edge-view">
        <div class="edge-loadbar"></div>
        <div class="edge-note hidden">
          <span>⚠ Some websites (Google, YouTube, Facebook…) refuse to load inside frames — that's them, not you.</span>
          <button class="flyout-linkbtn e-openreal">Open in real browser ↗</button>
        </div>
      </div>
    </div>`;

  const root = win.body.querySelector('.edge');
  const tabsEl = root.querySelector('.edge-tabs');
  const view = root.querySelector('.edge-view');
  const loadbar = root.querySelector('.edge-loadbar');
  const note = root.querySelector('.edge-note');
  const addrInput = root.querySelector('.edge-addr input');
  const backBtn = root.querySelector('.e-back'), fwdBtn = root.querySelector('.e-fwd');

  const tabs = [];
  let active = null;
  let tabId = 1;

  function createTab(url = null) {
    const tab = { id: tabId++, url: null, history: [], hIndex: -1, el: null, pageEl: null };
    tabs.push(tab);
    const tabEl = document.createElement('div');
    tabEl.className = 'edge-tab';
    tabEl.innerHTML = `${I.globe}<span class="et-title">New tab</span><span class="et-x">✕</span>`;
    tabEl.addEventListener('click', (e) => {
      if (e.target.closest('.et-x')) { closeTab(tab); return; }
      setActive(tab);
    });
    tabsEl.appendChild(tabEl);
    tab.el = tabEl;
    setActive(tab);
    if (url) navigate(tab, url);
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
    addrInput.value = tab.url === 'edge://home' ? '' : tab.url || '';
    updateNav();
  }

  function updateNav() {
    backBtn.disabled = !active || active.hIndex <= 0;
    fwdBtn.disabled = !active || active.hIndex >= active.history.length - 1;
  }

  function tabTitle(tab) {
    if (!tab.url) return 'New tab';
    if (tab.url === 'edge://home') return 'New tab';
    if (tab.url === 'edge://about') return 'About Edge';
    try { return new URL(tab.url).hostname; } catch { return tab.url; }
  }

  function navigate(tab, url, pushHist = true) {
    if (pushHist) {
      tab.history = tab.history.slice(0, tab.hIndex + 1);
      tab.history.push(url);
      tab.hIndex = tab.history.length - 1;
    }
    tab.url = url;
    tab.el.querySelector('.et-title').textContent = tabTitle(tab);
    addrInput.value = url === 'edge://home' ? '' : url;
    win.setTitle(`${tabTitle(tab)} - Microsoft Edge`);
    renderPage(tab);
    updateNav();
  }

  function renderPage(tab) {
    if (tab.pageEl) tab.pageEl.remove();
    note.classList.add('hidden');
    const page = document.createElement('div');
    page.className = 'edge-page';
    page.style.cssText = 'position:absolute;inset:0;';
    tab.pageEl = page;
    view.appendChild(page);
    tabs.forEach(t => { if (t.pageEl) t.pageEl.classList.toggle('hidden', t !== tab); });

    const url = tab.url;
    if (!url || url === 'edge://home') {
      page.innerHTML = `
        <div class="edge-home">
          <div class="eh-title">${I.edge}<span>Where to next?</span></div>
          <div class="edge-search">${I.search}<input type="text" placeholder="Search the web"></div>
          <div class="edge-quick"></div>
        </div>`;
      const inp = page.querySelector('.edge-search input');
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value.trim()) navigate(tab, normalizeInput(inp.value)); });
      const quick = page.querySelector('.edge-quick');
      for (const q of QUICK_LINKS) {
        const el = document.createElement('div');
        el.className = 'eh-link';
        el.innerHTML = `<span class="lbox">${q.icon}</span><span>${q.name}</span>`;
        el.addEventListener('click', () => navigate(tab, q.url));
        quick.appendChild(el);
      }
      setTimeout(() => inp.focus(), 50);
      return;
    }

    if (url === 'edge://about') {
      page.innerHTML = `
        <div style="height:100%;overflow:auto;background:#f3f6fa;color:#222;display:flex;align-items:center;justify-content:center">
          <div style="max-width:460px;padding:40px;text-align:center">
            <div style="margin-bottom:16px">${I.edge.replace('<svg', '<svg width="72" height="72"')}</div>
            <h1 style="font-weight:300;font-size:26px">Microsoft Edge</h1>
            <p style="opacity:.7;margin:14px 0;line-height:1.6">
              Web Edition — running inside a Windows 10 that runs inside your browser.<br><br>
              Type an address to browse for real. Sites that allow embedding will render here.
            </p>
          </div>
        </div>`;
      return;
    }

    /* real site via iframe */
    loadbar.style.width = '0';
    requestAnimationFrame(() => { loadbar.style.width = '65%'; });
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    let loaded = false;
    iframe.addEventListener('load', () => {
      loaded = true;
      loadbar.style.width = '100%';
      setTimeout(() => { loadbar.style.width = '0'; }, 300);
    });
    page.appendChild(iframe);
    setTimeout(() => { if (!loaded) note.classList.remove('hidden'); }, 2500);
  }

  /* controls */
  addrInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const url = normalizeInput(addrInput.value);
      if (url) navigate(active, url);
    }
  });
  backBtn.addEventListener('click', () => {
    if (active && active.hIndex > 0) { active.hIndex--; navigate(active, active.history[active.hIndex], false); }
  });
  fwdBtn.addEventListener('click', () => {
    if (active && active.hIndex < active.history.length - 1) { active.hIndex++; navigate(active, active.history[active.hIndex], false); }
  });
  root.querySelector('.e-reload').addEventListener('click', () => active && renderPage(active));
  root.querySelector('.e-home').addEventListener('click', () => navigate(active, 'edge://home'));
  root.querySelector('.e-openreal').addEventListener('click', () => {
    if (active && active.url && !active.url.startsWith('edge://')) window.open(active.url, '_blank');
  });

  const newBtn = document.createElement('div');
  newBtn.className = 'et-new';
  newBtn.textContent = '+';
  newBtn.title = 'New tab';
  newBtn.addEventListener('click', () => createTab('edge://home'));
  tabsEl.appendChild(newBtn);

  createTab(arg && arg.url ? arg.url : 'edge://home');
  return win;
}
