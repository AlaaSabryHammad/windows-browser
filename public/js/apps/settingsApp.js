/* Settings app */
import { createWindow } from '../wm.js';
import { settings, updateSettings, WALLPAPERS, ACCENTS, onSettingsChange } from '../settings.js';
import { I } from '../icons.js';
import { msgDialog } from '../ui.js';
import { resetFS } from '../fs.js';

export function open(arg = null) {
  const win = createWindow({ title: 'Settings', icon: I.settings, appId: 'settings', w: 900, h: 600 });
  win.body.innerHTML = `
    <div class="settings">
      <div class="set-side">
        <div class="set-user">
          <div class="su-av">A</div>
          <div><div class="su-name">Alaa</div><div class="su-sub">Local Account</div></div>
        </div>
        <div class="set-item" data-page="system">${I.monitor}<span>System</span></div>
        <div class="set-item" data-page="personalization">${I.paint}<span>Personalization</span></div>
        <div class="set-item" data-page="apps">${I.grid}<span>Apps</span></div>
        <div class="set-item" data-page="about">${I.info}<span>About</span></div>
      </div>
      <div class="set-content"></div>
    </div>`;

  const content = win.body.querySelector('.set-content');
  const sideItems = win.body.querySelectorAll('.set-item');

  const pages = {
    personalization: () => `
      <h1>Personalization</h1>
      <h2>Background</h2>
      <div class="wp-picker">${WALLPAPERS.map(w =>
        `<div class="wp-thumb wp-${w.id} ${settings.wallpaper === w.id ? 'sel' : ''}" data-wp="${w.id}" title="${w.name}"></div>`).join('')}
      </div>
      <h2>Choose your accent color</h2>
      <div class="accent-grid">${ACCENTS.map(c =>
        `<div class="accent-cell ${settings.accent === c ? 'sel' : ''}" style="background:${c}" data-accent="${c}"></div>`).join('')}
      </div>
      <h2>Choose your color</h2>
      <div class="set-row"><label class="wradio"><input type="radio" name="theme" value="light" ${settings.theme === 'light' ? 'checked' : ''}><span>Light</span></label></div>
      <div class="set-row"><label class="wradio"><input type="radio" name="theme" value="dark" ${settings.theme === 'dark' ? 'checked' : ''}><span>Dark</span></label></div>
      <h2>Taskbar</h2>
      <div class="set-row">
        <div><div class="sr-label">Show accent color on taskbar</div></div>
        <div class="sr-right">
          <label class="switch"><input type="checkbox" id="set-taskbaraccent" ${settings.taskbarAccent ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
        </div>
      </div>`,

    system: () => `
      <h1>System</h1>
      <h2>Display</h2>
      <div class="set-row">
        <div><div class="sr-label">Resolution</div><div class="sr-sub">Changes are… negotiable</div></div>
        <div class="sr-right"><select class="set-select" id="set-res">
          <option>${innerWidth} × ${innerHeight} (Recommended)</option>
          <option>1920 × 1080</option><option>1366 × 768</option>
        </select></div>
      </div>
      <div class="set-row">
        <div><div class="sr-label">Scale and layout</div></div>
        <div class="sr-right"><select class="set-select"><option>100% (Recommended)</option><option>125%</option><option>150%</option></select></div>
      </div>
      <h2>Night light</h2>
      <div class="set-row">
        <div><div class="sr-label">Warmer colors to help you sleep</div></div>
        <div class="sr-right">
          <label class="switch"><input type="checkbox" id="set-nightlight" ${settings.nightlight ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
        </div>
      </div>
      <h2>Brightness</h2>
      <div class="set-row">
        <div><div class="sr-label">Screen brightness</div></div>
        <div class="sr-right" style="flex:1;max-width:320px"><input type="range" min="30" max="100" value="${settings.brightness}" style="width:100%" id="set-bright"></div>
      </div>`,

    apps: () => `
      <h1>Apps</h1>
      <h2>Apps &amp; features</h2>
      <div class="set-card"><b>Built-in apps</b> — everything on this PC was hand-built with love and zero dependencies.
      <div style="margin-top:10px;color:var(--text-muted)">File Explorer · Edge · Notepad · Calculator · Paint · Command Prompt · Task Manager · Minesweeper · Photos · Settings</div></div>
      <h2>Storage</h2>
      <div class="set-card">
        <div class="drive-bar" style="height:14px"><div class="fill" style="width:68%"></div></div>
        <div style="margin-top:8px">163 GB free of 512 GB</div>
        <div style="margin-top:8px"><button class="btn" id="set-resetfs">Reset virtual file system</button></div>
      </div>`,

    about: () => `
      <h1>About</h1>
      <div class="win-logo-big">${I.windows.replace('<svg', '<svg width="66" height="66" style="color:var(--accent)"')}</div>
      <table class="about-table">
        <tr><td>Device name</td><td>WEB-DESKTOP-01</td></tr>
        <tr><td>Processor</td><td>JavaScript Engine V8 @ ∞ GHz</td></tr>
        <tr><td>Installed RAM</td><td>16.0 GB (15.9 GB usable, allegedly)</td></tr>
        <tr><td>System type</td><td>64-bit OS, browser-based processor</td></tr>
        <tr><td>Edition</td><td>Windows 10 Web Edition</td></tr>
        <tr><td>Version</td><td>22H2</td></tr>
        <tr><td>OS build</td><td>Browser 2026.10</td></tr>
      </table>
      <h2>© Nobody. Copy freely.</h2>
      <div class="set-card">This is a loving re-creation of the Windows 10 experience built with vanilla HTML, CSS and JavaScript. Not affiliated with Microsoft.</div>`,
  };

  function show(page) {
    selfChange = false;
    sideItems.forEach(s => s.classList.toggle('sel', s.dataset.page === page));
    content.innerHTML = pages[page]();
    content.scrollTop = 0;

    content.querySelectorAll('.wp-thumb').forEach(t => t.addEventListener('click', () => {
      selfChange = true; updateSettings({ wallpaper: t.dataset.wp }); selfChange = false;
      content.querySelectorAll('.wp-thumb').forEach(x => x.classList.remove('sel'));
      t.classList.add('sel');
    }));
    content.querySelectorAll('.accent-cell').forEach(c => c.addEventListener('click', () => {
      selfChange = true; updateSettings({ accent: c.dataset.accent }); selfChange = false;
      content.querySelectorAll('.accent-cell').forEach(x => x.classList.remove('sel'));
      c.classList.add('sel');
    }));
    content.querySelectorAll('input[name="theme"]').forEach(r => r.addEventListener('change', () => {
      if (r.checked) { selfChange = true; updateSettings({ theme: r.value }); selfChange = false; }
    }));
    const nl = content.querySelector('#set-nightlight');
    if (nl) nl.addEventListener('change', () => { selfChange = true; updateSettings({ nightlight: nl.checked }); selfChange = false; });
    const tb = content.querySelector('#set-taskbaraccent');
    if (tb) tb.addEventListener('change', () => { selfChange = true; updateSettings({ taskbarAccent: tb.checked }); selfChange = false; });
    const br = content.querySelector('#set-bright');
    if (br) br.addEventListener('input', () => { selfChange = true; updateSettings({ brightness: +br.value }); selfChange = false; });
    const rf = content.querySelector('#set-resetfs');
    if (rf) rf.addEventListener('click', async () => {
      const ok = await import('../ui.js').then(ui => ui.confirmDialog('Reset file system', 'This deletes all files you created and restores the defaults. Continue?', 'Reset', 'Cancel'));
      if (ok) { resetFS(); location.reload(); }
    });
  }

  let selfChange = false;

  sideItems.forEach(s => s.addEventListener('click', () => show(s.dataset.page)));
  show(arg && arg.page ? arg.page : 'system');

  /* live-refresh if settings changed from another window */
  const cb = () => { if (selfChange) return; const cur = win.body.querySelector('.set-item.sel'); if (cur) show(cur.dataset.page); };
  onSettingsChange(cb);
  win.onclose(() => { /* listener stays; harmless */ });

  return win;
}
