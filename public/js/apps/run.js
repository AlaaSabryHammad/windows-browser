/* Run dialog (Win+R) */
import { createWindow, workArea } from '../wm.js';
import { I } from '../icons.js';
import { esc, msgDialog } from '../ui.js';
import { getNode, parsePath, KNOWN, HOME } from '../fs.js';
import { openPath } from '../fileops.js';
import { fileDialog } from '../filedialog.js';
import { launch } from './registry.js';
import { APP_ALIASES } from './terminal.js';

const HIST = 'webwin-run-history';
const CONSOLE_CMDS = ['ping', 'ipconfig', 'systeminfo', 'tasklist', 'taskkill', 'tree', 'dir', 'echo', 'shutdown', 'curl', 'hostname', 'whoami', 'ver'];
const SHELL = {
  'shell:desktop': KNOWN.desktop, 'shell:documents': KNOWN.documents, 'shell:downloads': KNOWN.downloads, 'shell:mypictures': KNOWN.pictures,
  'shell:my pictures': KNOWN.pictures, 'shell:mymusic': KNOWN.music, 'shell:myvideo': KNOWN.videos, 'shell:profile': HOME, '.': HOME, '..': ['Users'], '\\': [],
};

/* returns true when something was started */
export function runCommand(text) {
  const t = text.trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  const first = lower.split(/\s+/)[0].replace(/\.exe$/, '');
  if (lower === 'winver') { import('../shell.js').then(m => m.showWinver()); return true; }
  if (lower === 'shell:recyclebinfolder') { launch('recycle'); return true; }
  if (lower.startsWith('ms-settings:')) { launch('settings', { page: { 'ms-settings:display': 'system', 'ms-settings:personalization': 'personalization', 'ms-settings:about': 'about', 'ms-settings:storagesense': 'storage', 'ms-settings:yourinfo': 'accounts', 'ms-settings:dateandtime': 'time', 'ms-settings:windowsupdate': 'update' }[lower] }); return true; }
  if (SHELL[lower]) { launch('explorer', { path: SHELL[lower] }); return true; }
  if (first === 'cmd' && lower.includes(' /k ')) { launch('terminal', { run: t.slice(lower.indexOf(' /k ') + 4) }); return true; }
  if (CONSOLE_CMDS.includes(first)) { launch('terminal', { run: t }); return true; }
  if (first === 'notepad' && t.split(/\s+/).length > 1) {
    const p = parsePath(t.slice(t.indexOf(' ') + 1), KNOWN.documents);
    if (p && getNode(p)) { openPath(p, 'notepad'); return true; }
  }
  if (APP_ALIASES[first] || APP_ALIASES[lower]) { launch(APP_ALIASES[first] || APP_ALIASES[lower]); return true; }
  if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) { launch('edge', { url: /^www\./i.test(t) ? 'https://' + t : t }); return true; }
  const p = parsePath(t, HOME);
  if (p && getNode(p)) { openPath(p); return true; }
  return false;
}

export function open() {
  const wa = workArea();
  const win = createWindow({ title: 'Run', icon: I.run, appId: 'run', w: 420, h: 214, x: 8, y: wa.h - 222, resizable: false, noRemember: true });
  let history = [];
  try { history = JSON.parse(localStorage.getItem(HIST) || '[]'); } catch { history = []; }
  win.body.innerHTML = `
    <div class="run">
      <div class="run-top">${I.run}<p>Type the name of a program, folder, document, or Internet resource, and Windows will open it for you.</p></div>
      <div class="run-row"><label>Open:</label><input list="run-hist" spellcheck="false" value="${esc(history[0] || '')}"><datalist id="run-hist">${history.map(h => `<option value="${esc(h)}">`).join('')}</datalist></div>
      <div class="run-btns"><button class="btn primary run-ok">OK</button><button class="btn run-cancel">Cancel</button><button class="btn run-browse">Browse…</button></div>
    </div>`;
  const input = win.body.querySelector('input');
  const ok = win.body.querySelector('.run-ok');
  const sync = () => { ok.disabled = !input.value.trim(); };
  input.addEventListener('input', sync);
  sync();

  async function go() {
    const v = input.value.trim();
    if (!v) return;
    if (runCommand(v)) {
      history = [v, ...history.filter(h => h.toLowerCase() !== v.toLowerCase())].slice(0, 20);
      try { localStorage.setItem(HIST, JSON.stringify(history)); } catch { /* ignore */ }
      win.forceClose();
    } else {
      await msgDialog(v, `Windows cannot find '${esc(v)}'. Make sure you typed the name correctly, and then try again.`, 'error');
      input.focus(); input.select();
    }
  }
  ok.addEventListener('click', go);
  win.body.querySelector('.run-cancel').addEventListener('click', () => win.forceClose());
  win.body.querySelector('.run-browse').addEventListener('click', async () => {
    const p = await fileDialog({ mode: 'open', title: 'Browse', startDir: KNOWN.documents });
    if (p) { input.value = 'C:\\' + p.join('\\'); sync(); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go(); }
    if (e.key === 'Escape') { e.preventDefault(); win.forceClose(); }
  });
  setTimeout(() => { input.focus(); input.select(); }, 50);
  return win;
}
