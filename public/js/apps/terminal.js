/* Command Prompt — a cmd.exe work-alike wired to the virtual file system, window manager and browser APIs. */
import { createWindow, windowList } from '../wm.js';
import { I } from '../icons.js';
import {
  getNode, canonical, parsePath, HOME, addressOf, addNode, makeFolder, writeFile, deleteNode, destroyNode,
  moveNode, copyNode, renameNode, sizeOf, isValidName, diskInfo,
} from '../fs.js';
import { launch } from './registry.js';
import { openPath } from '../fileops.js';
import { settings } from '../settings.js';

const HELP = `For more information on a specific command, type HELP command-name
CD / CHDIR     Displays the name of or changes the current directory.
CLS            Clears the screen.
COLOR          Sets the default console foreground and background colors.
COPY           Copies one or more files to another location.
CURL           Downloads a web page (if the site allows it).
DATE / TIME    Displays the date / time.
DEL / ERASE    Deletes one or more files (wildcards allowed).
DIR            Displays a list of files and subdirectories in a directory.
DOSKEY         /HISTORY shows the command history.
ECHO           Displays messages. Use > or >> to write into a file.
EXIT           Quits the CMD.EXE program (command interpreter).
FIND           Searches for a text string in a file.
HOSTNAME       Prints the name of this computer.
IPCONFIG       Displays network configuration.
MKDIR / MD     Creates a directory.
MOVE           Moves files and renames directories.
PING           Tests the connection to a host.
RENAME / REN   Renames a file or files.
RMDIR / RD     Removes a directory (/S removes everything inside).
SET            Displays, sets, or removes environment variables.
SHUTDOWN       /S shut down, /R restart, /L sign out, /H sleep.
START          Starts a program, opens a file, folder or URL.
SYSTEMINFO     Displays machine specific properties and configuration.
TASKKILL       Kills a task by /PID or /IM image name.
TASKLIST       Displays all currently running tasks.
TITLE          Sets the window title for the CMD.EXE session.
TREE           Graphically displays the directory structure (/F lists files).
TYPE / MORE    Displays the contents of a text file.
VER            Displays the Windows version.
WHOAMI         Displays the current user.
WINVER         Shows the About Windows dialog.

Apps can be started by name too: notepad, calc, mspaint, explorer, msedge, taskmgr,
control, camera, wmplayer, stikynot, clock, weather, minesweeper, winword, excel.`;

export const EXE = {
  explorer: 'explorer.exe', edge: 'msedge.exe', notepad: 'notepad.exe', calculator: 'calc.exe', paint: 'mspaint.exe',
  terminal: 'cmd.exe', settings: 'SystemSettings.exe', photos: 'Microsoft.Photos.exe', taskmgr: 'Taskmgr.exe',
  minesweeper: 'MineSweeper.exe', recycle: 'explorer.exe', mediaplayer: 'Microsoft.Media.Player.exe', camera: 'WindowsCamera.exe',
  clock: 'Time.exe', stickynotes: 'Microsoft.Notes.exe', word: 'WINWORD.EXE', excel: 'EXCEL.EXE', weather: 'Microsoft.Msn.Weather.exe', run: 'rundll32.exe', store: 'WinStore.App.exe',
};
export const pidOf = (win) => 1000 + parseInt(win.id.slice(1), 10) * 4;

export const APP_ALIASES = {
  notepad: 'notepad', calc: 'calculator', calculator: 'calculator', paint: 'paint', mspaint: 'paint', explorer: 'explorer',
  edge: 'edge', msedge: 'edge', iexplore: 'edge', minesweeper: 'minesweeper', taskmgr: 'taskmgr', settings: 'settings',
  control: 'settings', 'ms-settings:': 'settings', photos: 'photos', camera: 'camera', wmplayer: 'mediaplayer', mediaplayer: 'mediaplayer',
  stikynot: 'stickynotes', stickynotes: 'stickynotes', winword: 'word', word: 'word', excel: 'excel', clock: 'clock', timedate: 'clock', weather: 'weather', cmd: 'terminal', run: 'run',
};

const COLORS = ['#0c0c0c', '#0037da', '#13a10e', '#3a96dd', '#c50f1f', '#881798', '#c19c00', '#cccccc', '#767676', '#3b78ff', '#16c60c', '#61d6d6', '#e74856', '#b4009e', '#f9f1a5', '#f2f2f2'];

/* split a command line into tokens, honouring "quotes" */
function tokenize(s) {
  const out = [];
  let cur = '', q = false, had = false;
  for (const ch of s) {
    if (ch === '"') { q = !q; had = true; continue; }
    if (!q && /\s/.test(ch)) { if (cur || had) out.push(cur); cur = ''; had = false; continue; }
    cur += ch;
  }
  if (cur || had) out.push(cur);
  return out;
}
/* split on an operator that is outside quotes */
function splitOutside(s, re) {
  const parts = [];
  let cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') q = !q;
    const m = !q && s.slice(i).match(re);
    if (m && m.index === 0) { parts.push(cur); cur = ''; i += m[0].length - 1; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}
const wildcard = (pat) => new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');

export function open(arg = null) {
  const win = createWindow({ title: 'Command Prompt', icon: I.terminal, appId: 'terminal', w: 740, h: 440, minW: 420, minH: 240 });
  win.body.innerHTML = `
    <div class="terminal" tabindex="-1">
      <div class="term-out selectable"></div>
      <div class="term-line">
        <span class="term-prompt"></span>
        <input class="term-input" type="text" spellcheck="false" autocomplete="off">
      </div>
    </div>`;

  const root = win.body.querySelector('.terminal');
  const out = root.querySelector('.term-out');
  const promptEl = root.querySelector('.term-prompt');
  const input = root.querySelector('.term-input');

  const startCwd = arg && arg.cwd && getNode(arg.cwd) ? canonical(arg.cwd) : [...HOME];
  const st = { cwd: startCwd, history: [], hIndex: -1, busy: false, cancel: false, echo: true, vars: {} };
  try { st.history = JSON.parse(localStorage.getItem('webwin-cmd-history') || '[]'); } catch { st.history = []; }
  st.hIndex = st.history.length;

  const prompt = () => addressOf(st.cwd) + '>';
  const refreshPrompt = () => { promptEl.textContent = st.echo ? prompt() : ''; };
  refreshPrompt();

  let sink = null;   /* redirection buffer */
  function print(text = '') {
    if (sink) { sink.push(String(text)); return; }
    out.textContent += text + '\n';
    if (out.textContent.length > 200000) out.textContent = out.textContent.slice(-150000);
    out.scrollTop = out.scrollHeight;
  }

  print('Microsoft Windows [Version 10.0.19045.2026]');
  print('(c) Windows 10 Web. All rights reserved.\n');

  const env = () => ({
    USERNAME: settings.userName, COMPUTERNAME: settings.pcName, USERPROFILE: addressOf(HOME), HOMEDRIVE: 'C:', HOMEPATH: '\\' + HOME.join('\\'),
    OS: 'Windows_NT', SYSTEMROOT: 'C:\\Windows', WINDIR: 'C:\\Windows', PROCESSOR_ARCHITECTURE: 'AMD64',
    NUMBER_OF_PROCESSORS: String(navigator.hardwareConcurrency || 4), CD: addressOf(st.cwd),
    DATE: new Date().toLocaleDateString('en-US', { weekday: 'short', month: '2-digit', day: '2-digit', year: 'numeric' }).replace(',', ''),
    TIME: new Date().toLocaleTimeString('en-GB') + '.00', RANDOM: String(Math.floor(Math.random() * 32768)),
    PATH: 'C:\\Windows\\system32;C:\\Windows', PATHEXT: '.COM;.EXE;.BAT;.CMD', ...st.vars,
  });
  const expand = (s) => s.replace(/%([^%\s]+)%/g, (m, name) => { const v = env()[name.toUpperCase()]; return v != null ? v : m; });

  const resolve = (p) => parsePath(p, st.cwd);
  const notFound = () => print('The system cannot find the path specified.');

  /* files in a directory matching a (possibly wildcard) argument */
  function matchFiles(argPath) {
    const p = resolve(argPath);
    if (!p) return { dir: null, names: [] };
    const node = getNode(p);
    if (node && node.type === 'folder' && !/[*?]/.test(argPath)) return { dir: canonical(p), names: node.children.map(c => c.name), folder: true };
    const dir = p.slice(0, -1);
    const d = getNode(dir);
    if (!d || d.type !== 'folder') return { dir: null, names: [] };
    const re = wildcard(p[p.length - 1]);
    return { dir: canonical(dir), names: d.children.filter(c => re.test(c.name)).map(c => c.name) };
  }

  const fmtD = (t) => new Date(t).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const fmtT = (t) => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const commands = {
    help: (a) => {
      if (a[0] && commands[a[0].toLowerCase()]) print(`${a[0].toUpperCase()} — see the list below.\n`);
      print(HELP);
    },
    cls: () => { out.textContent = ''; },
    ver: () => print('\nMicrosoft Windows [Version 10.0.19045.2026] Web Edition\n'),
    winver: () => import('../shell.js').then(m => m.showWinver()),
    date: () => print('The current date is: ' + env().DATE),
    time: () => print('The current time is: ' + env().TIME),
    whoami: () => print(`${settings.pcName.toLowerCase()}\\${settings.userName.toLowerCase().replace(/\s+/g, '')}`),
    hostname: () => print(settings.pcName),
    echo: (a, raw) => {
      const text = raw.replace(/^echo\.?\s?/i, '');
      if (/^echo\.$/i.test(raw.trim())) { print(''); return; }
      if (/^off$/i.test(text.trim())) { st.echo = false; refreshPrompt(); return; }
      if (/^on$/i.test(text.trim())) { st.echo = true; refreshPrompt(); return; }
      if (!text.trim()) { print(`ECHO is ${st.echo ? 'on' : 'off'}.`); return; }
      print(text);
    },
    title: (a, raw) => win.setTitle(raw.replace(/^title\s*/i, '') || 'Command Prompt'),
    color: (a) => {
      const c = (a[0] || '').toLowerCase();
      if (!c) { root.style.background = ''; root.style.color = ''; return; }
      if (!/^[0-9a-f]{1,2}$/.test(c) || (c.length === 2 && c[0] === c[1])) { print('Usage: COLOR [attr]   e.g. COLOR 0A for green on black'); return; }
      const bg = c.length === 2 ? COLORS[parseInt(c[0], 16)] : COLORS[0];
      const fg = COLORS[parseInt(c[c.length - 1], 16)];
      root.style.background = bg; root.style.color = fg;
    },
    cd: (a) => {
      const args = a.filter(x => x.toLowerCase() !== '/d');
      if (!args.length) { print(addressOf(st.cwd)); return; }
      const p = resolve(args.join(' '));
      const node = p && getNode(p);
      if (node && node.type === 'folder') { st.cwd = canonical(p); refreshPrompt(); }
      else if (node) print('The directory name is invalid.');
      else notFound();
    },
    dir: (a) => {
      const bare = a.some(x => x.toLowerCase() === '/b');
      const target = a.filter(x => !x.startsWith('/')).join(' ') || '.';
      const m = matchFiles(target);
      if (!m.dir) { print('File Not Found'); return; }
      const dirNode = getNode(m.dir);
      const kids = m.names.map(n => dirNode.children.find(c => c.name === n));
      if (bare) { kids.forEach(k => print(k.name)); return; }
      print(` Volume in drive C is Windows`);
      print(` Volume Serial Number is 1A2B-3C4D\n`);
      print(` Directory of ${addressOf(m.dir)}\n`);
      if (!kids.length) { print('File Not Found'); return; }
      let bytes = 0, files = 0, dirs = 0;
      if (m.folder && m.dir.length) {
        print(`${fmtD(dirNode.modified || dirNode.created)}  ${fmtT(dirNode.modified || dirNode.created)}    <DIR>          .`);
        print(`${fmtD(dirNode.created)}  ${fmtT(dirNode.created)}    <DIR>          ..`);
      }
      for (const k of kids) {
        const t = k.modified || k.created;
        if (k.type === 'folder') { dirs++; print(`${fmtD(t)}  ${fmtT(t)}    <DIR>          ${k.name}`); }
        else { files++; const s = sizeOf(k); bytes += s; print(`${fmtD(t)}  ${fmtT(t)}    ${s.toLocaleString().padStart(14)} ${k.name}`); }
      }
      print(`${String(files).padStart(16)} File(s) ${bytes.toLocaleString().padStart(14)} bytes`);
      print(`${String(dirs).padStart(16)} Dir(s)  ${(free || 0).toLocaleString().padStart(14)} bytes free`);
    },
    tree: (a) => {
      const files = a.some(x => x.toLowerCase() === '/f');
      const target = a.filter(x => !x.startsWith('/')).join(' ');
      const p = target ? resolve(target) : st.cwd;
      const node = p && getNode(p);
      if (!node || node.type !== 'folder') { print('Invalid path - ' + (target || '.')); return; }
      print('Folder PATH listing for volume Windows');
      print('Volume serial number is 1A2B-3C4D');
      print(addressOf(canonical(p)).replace(/\\$/, '') || 'C:.');
      const lines = [];
      (function walkT(n, prefix) {
        const kids = (n.children || []).filter(c => files || c.type === 'folder');
        kids.forEach((c, i) => {
          const last = i === kids.length - 1;
          lines.push(prefix + (c.type === 'folder' ? (last ? '└───' : '├───') : (last ? '    ' : '│   ')) + c.name);
          if (c.type === 'folder') walkT(c, prefix + (last ? '    ' : '│   '));
        });
      })(node, '');
      print(lines.length ? lines.join('\n') : 'No subfolders exist');
    },
    mkdir: (a) => {
      if (!a.length) { print('The syntax of the command is incorrect.'); return; }
      for (const arg of a) {
        const p = resolve(arg);
        if (!p) { print('The syntax of the command is incorrect.'); continue; }
        if (getNode(p)) { print(`A subdirectory or file ${arg} already exists.`); continue; }
        let acc = [];
        for (const seg of p) {
          const next = [...acc, seg];
          if (!getNode(next)) {
            if (!isValidName(seg)) { print('The filename, directory name, or volume label syntax is incorrect.'); return; }
            addNode(acc, makeFolder(seg));
          }
          acc = canonical(next);
        }
      }
    },
    rmdir: (a) => {
      const sub = a.some(x => x.toLowerCase() === '/s');
      const target = a.filter(x => !x.startsWith('/')).join(' ');
      const p = resolve(target);
      const node = p && getNode(p);
      if (!node) { print('The system cannot find the file specified.'); return; }
      if (node.type !== 'folder') { print('The directory name is invalid.'); return; }
      if (!p.length) { print('Access is denied.'); return; }
      if (node.children.length && !sub) { print('The directory is not empty.'); return; }
      if (canonical(st.cwd).join('\\').toLowerCase().startsWith(canonical(p).join('\\').toLowerCase())) { print('The process cannot access the file because it is being used by another process.'); return; }
      destroyNode(p.slice(0, -1), node.name);
    },
    del: (a) => {
      const target = a.filter(x => !x.startsWith('/')).join(' ');
      if (!target) { print('The syntax of the command is incorrect.'); return; }
      const m = matchFiles(target);
      if (!m.dir) { print(`Could Not Find ${addressOf(resolve(target) || st.cwd)}`); return; }
      const files = m.names.filter(n => getNode([...m.dir, n]).type === 'file');
      if (!files.length) { print(`Could Not Find ${addressOf([...m.dir, target.split('\\').pop()])}`); return; }
      files.forEach(n => deleteNode(m.dir, n));   /* goes to the Recycle Bin — safer for a toy */
    },
    copy: (a) => transfer(a, 'copy'),
    move: (a) => transfer(a, 'move'),
    rename: (a) => {
      if (a.length < 2) { print('The syntax of the command is incorrect.'); return; }
      const p = resolve(a[0]);
      const node = p && getNode(p);
      if (!node) { print('The system cannot find the file specified.'); return; }
      const res = renameNode(p.slice(0, -1), node.name, a[1]);
      if (res === 'exists') print('A duplicate file name exists, or the file cannot be found.');
      else if (res !== true) print('The syntax of the command is incorrect.');
    },
    type: (a) => {
      if (!a.length) { print('The syntax of the command is incorrect.'); return; }
      for (const arg of a) {
        const p = resolve(arg);
        const node = p && getNode(p);
        if (!node || node.type !== 'file') { print(`The system cannot find the file specified.\nError occurred while processing: ${arg}.`); continue; }
        if (a.length > 1) print(`\n${arg}\n`);
        const c = node.content || '';
        print(c.startsWith('data:') ? '[binary file]' : c.replace(/\r\n/g, '\n'));
      }
    },
    find: (a) => {
      const flags = a.filter(x => x.startsWith('/')).map(x => x.toLowerCase());
      const rest = a.filter(x => !x.startsWith('/'));
      if (rest.length < 2) { print('FIND: Parameter format not correct'); return; }
      const [needle, ...fileArgs] = rest;
      for (const f of fileArgs) {
        const p = resolve(f); const node = p && getNode(p);
        if (!node || node.type !== 'file') { print(`File not found - ${f.toUpperCase()}`); continue; }
        print(`\n---------- ${node.name.toUpperCase()}`);
        const ci = flags.includes('/i');
        (node.content || '').split(/\r?\n/).forEach((line, i) => {
          const hit = ci ? line.toLowerCase().includes(needle.toLowerCase()) : line.includes(needle);
          if (hit !== flags.includes('/v')) print((flags.includes('/n') ? `[${i + 1}]` : '') + line);
        });
      }
    },
    start: (a) => {
      const target = a.filter(x => !x.startsWith('/')).join(' ');
      if (!target) { launch('terminal', { cwd: st.cwd }); return; }
      startThing(target, true);
    },
    tasklist: () => {
      print('\nImage Name                     PID Session Name        Session#    Mem Usage');
      print('========================= ======== ================ =========== ============');
      const sys = [['System Idle Process', 0], ['System', 4], ['Registry', 124], ['smss.exe', 412], ['csrss.exe', 576], ['wininit.exe', 668], ['services.exe', 744], ['lsass.exe', 760], ['svchost.exe', 880], ['dwm.exe', 1040], ['explorer.exe', 3812]];
      sys.forEach(([n, pid]) => print(`${n.padEnd(25)} ${String(pid).padStart(8)} ${(pid < 700 ? 'Services' : 'Console').padEnd(16)} ${String(pid < 700 ? 0 : 1).padStart(11)} ${(Math.round(pid * 7.3 % 90000) + 8).toLocaleString().padStart(10)} K`));
      windowList().forEach(w => print(`${(EXE[w.opts.appId] || 'app.exe').padEnd(25)} ${String(pidOf(w)).padStart(8)} ${'Console'.padEnd(16)} ${'1'.padStart(11)} ${Math.round(w.el.getElementsByTagName('*').length * 9.7 + 20480).toLocaleString().padStart(10)} K`));
    },
    taskkill: (a) => {
      const lower = a.map(x => x.toLowerCase());
      const pi = lower.indexOf('/pid'), ii = lower.indexOf('/im');
      let targets = [];
      if (pi >= 0 && a[pi + 1]) targets = windowList().filter(w => String(pidOf(w)) === a[pi + 1]);
      else if (ii >= 0 && a[ii + 1]) { const re = wildcard(a[ii + 1]); targets = windowList().filter(w => re.test(EXE[w.opts.appId] || '')); }
      else { print('ERROR: Invalid syntax. Neither /FI nor /PID nor /IM were specified.'); return; }
      if (!targets.length) { print(`ERROR: The process "${a[(pi >= 0 ? pi : ii) + 1]}" not found.`); return; }
      const force = lower.includes('/f');
      targets.forEach(w => {
        print(`SUCCESS: ${force ? 'The process' : 'Sent termination signal to the process'} with PID ${pidOf(w)} has been terminated.`);
        force ? w.forceClose() : w.close();
      });
    },
    systeminfo: async () => {
      print('\nLoading Operating System Information ...');
      const d = await diskInfo();
      const mem = navigator.deviceMemory ? `${(navigator.deviceMemory * 1024).toLocaleString()} MB` : 'Unknown';
      const rows = [
        ['Host Name', settings.pcName], ['OS Name', 'Windows 10 Web Edition'], ['OS Version', '10.0.19045 N/A Build 19045'],
        ['OS Manufacturer', 'Windows 10 Web'], ['Registered Owner', settings.userName], ['Product ID', '00330-80000-00000-AA742'],
        ['Original Install Date', new Date(Number(localStorage.getItem('webwin-installed') || Date.now())).toLocaleString()],
        ['System Boot Time', new Date(performance.timeOrigin).toLocaleString()], ['System Manufacturer', navigator.vendor || 'Browser'],
        ['System Model', (navigator.userAgentData?.brands || []).map(b => b.brand).filter(b => !/not/i.test(b)).join(', ') || navigator.appName],
        ['System Type', 'x64-based PC'], ['Processor(s)', `${navigator.hardwareConcurrency || '?'} logical processor(s) — JavaScript engine`],
        ['Total Physical Memory', mem], ['Virtual Memory: Max Size', performance.memory ? `${Math.round(performance.memory.jsHeapSizeLimit / 1048576).toLocaleString()} MB` : 'N/A'],
        ['Disk (C:) used', `${Math.round(d.used / 1024).toLocaleString()} KB of ${Math.round(d.quota / 1048576).toLocaleString()} MB`],
        ['System Locale', navigator.language], ['Time Zone', Intl.DateTimeFormat().resolvedOptions().timeZone],
        ['Screen', `${screen.width} x ${screen.height} @ ${devicePixelRatio}x`], ['Network Card(s)', navigator.onLine ? '1 NIC(s) Installed — Connected' : 'Media disconnected'],
      ];
      rows.forEach(([k, v]) => print(`${(k + ':').padEnd(27)}${v}`));
    },
    ipconfig: (a) => {
      const all = a.some(x => x.toLowerCase() === '/all');
      let ip = localStorage.getItem('webwin-ip');
      if (!ip) { ip = `192.168.1.${20 + Math.floor(Math.random() * 200)}`; try { localStorage.setItem('webwin-ip', ip); } catch { /* ignore */ } }
      const conn = navigator.connection;
      const up = navigator.onLine && !settings.airplane;
      print('\nWindows IP Configuration\n');
      if (all) { print(`   Host Name . . . . . . . . . . . . : ${settings.pcName}`); print(`   Primary Dns Suffix  . . . . . . . : \n   Node Type . . . . . . . . . . . . : Hybrid\n`); }
      print(`\n${conn && conn.type === 'ethernet' ? 'Ethernet adapter Ethernet' : 'Wireless LAN adapter Wi-Fi'}:\n`);
      if (!up) { print('   Media State . . . . . . . . . . . : Media disconnected'); return; }
      print('   Connection-specific DNS Suffix  . : home');
      if (all && conn) print(`   Link speed (estimated). . . . . . : ${conn.downlink} Mbps (${conn.effectiveType})`);
      print(`   IPv4 Address. . . . . . . . . . . : ${ip}`);
      print('   Subnet Mask . . . . . . . . . . . : 255.255.255.0');
      print('   Default Gateway . . . . . . . . . : 192.168.1.1');
    },
    ping: async (a) => {
      const host = a.find(x => !x.startsWith('-') && !x.startsWith('/'));
      if (!host) { print('Usage: ping [-n count] target_name'); return; }
      const ni = a.findIndex(x => /^[-/]n$/i.test(x));
      const count = ni >= 0 ? Math.min(50, parseInt(a[ni + 1], 10) || 4) : 4;
      const url = /^https?:\/\//i.test(host) ? host : `https://${host}/`;
      print(`\nPinging ${host.replace(/^https?:\/\//, '').replace(/\/$/, '')} with 32 bytes of data:`);
      const times = [];
      for (let i = 0; i < count; i++) {
        if (st.cancel) { print('Control-C\n^C'); return; }
        const t0 = performance.now();
        try {
          if (!navigator.onLine || settings.airplane) throw new Error('offline');
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 4000);
          await fetch(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now(), { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
          clearTimeout(to);
          const ms = Math.max(1, Math.round(performance.now() - t0));
          times.push(ms);
          print(`Reply from ${host}: bytes=32 time=${ms}ms TTL=117`);
        } catch {
          print(navigator.onLine && !settings.airplane ? 'Request timed out.' : 'PING: transmit failed. General failure.');
        }
        await sleep(Math.max(0, 1000 - (performance.now() - t0)));
      }
      const lost = count - times.length;
      print(`\nPing statistics for ${host}:\n    Packets: Sent = ${count}, Received = ${times.length}, Lost = ${lost} (${Math.round(lost / count * 100)}% loss),`);
      if (times.length) print(`Approximate round trip times in milli-seconds:\n    Minimum = ${Math.min(...times)}ms, Maximum = ${Math.max(...times)}ms, Average = ${Math.round(times.reduce((x, y) => x + y, 0) / times.length)}ms`);
    },
    curl: async (a) => {
      const url = a.find(x => !x.startsWith('-'));
      if (!url) { print('curl: try \'curl https://example.com\''); return; }
      try {
        const r = await fetch(/^https?:/i.test(url) ? url : 'https://' + url);
        const t = await r.text();
        print(t.length > 20000 ? t.slice(0, 20000) + '\n… (truncated)' : t);
      } catch (e) {
        print(`curl: (7) Failed to connect — the site doesn't allow requests from other websites (CORS) or you're offline.`);
      }
    },
    shutdown: (a) => {
      const f = a.map(x => x.toLowerCase());
      const ti = f.indexOf('/t');
      const delay = ti >= 0 ? Math.min(600, parseInt(a[ti + 1], 10) || 0) : (f.includes('/s') || f.includes('/r') ? 0 : 0);
      const ev = f.includes('/r') ? 'restart' : f.includes('/l') ? 'signout' : f.includes('/h') ? 'sleep' : f.includes('/s') ? 'shutdown' : null;
      if (f.includes('/a')) { clearTimeout(window.__shutdownTimer); print('Logoff is cancelled.'); return; }
      if (!ev) { print('Usage: shutdown [/s | /r | /l | /h | /a] [/t xxx]'); return; }
      if (delay) {
        import('../ui.js').then(ui => ui.notify('You\'re about to be signed out', `Windows will ${ev === 'restart' ? 'restart' : 'shut down'} in ${delay} seconds.`, I.power));
      }
      clearTimeout(window.__shutdownTimer);
      window.__shutdownTimer = setTimeout(() => window.dispatchEvent(new CustomEvent('webwin:' + ev)), delay * 1000 + 300);
    },
    set: (a, raw) => {
      const rest = raw.replace(/^set\s*/i, '');
      if (!rest) { Object.entries(env()).sort().forEach(([k, v]) => print(`${k}=${v}`)); return; }
      const eq = rest.indexOf('=');
      if (eq < 0) {
        const hits = Object.entries(env()).filter(([k]) => k.toLowerCase().startsWith(rest.toLowerCase()));
        if (!hits.length) print(`Environment variable ${rest} not defined`);
        hits.forEach(([k, v]) => print(`${k}=${v}`));
        return;
      }
      const k = rest.slice(0, eq).trim().toUpperCase(), v = rest.slice(eq + 1);
      if (v) st.vars[k] = v; else delete st.vars[k];
    },
    doskey: (a) => { if ((a[0] || '').toLowerCase() === '/history') st.history.forEach(h => print(h)); },
    history: () => st.history.forEach((h, i) => print(`${String(i + 1).padStart(4)}  ${h}`)),
    where: (a) => {
      const id = APP_ALIASES[(a[0] || '').toLowerCase().replace(/\.exe$/, '')];
      if (id) print(`C:\\Windows\\System32\\${EXE[id]}`);
      else print('INFO: Could not find files for the given pattern(s).');
    },
    vol: () => { print(' Volume in drive C is Windows'); print(' Volume Serial Number is 1A2B-3C4D'); },
    pause: async () => { print('Press any key to continue . . .'); await new Promise(r => { const h = () => { input.removeEventListener('keydown', h); r(); }; input.addEventListener('keydown', h); }); },
    exit: () => win.close(),
    powershell: () => print('PowerShell isn\'t installed on this PC. Try the commands in HELP instead.'),
  };
  /* aliases */
  Object.assign(commands, { chdir: commands.cd, md: commands.mkdir, rd: commands.rmdir, erase: commands.del, ren: commands.rename, more: commands.type, 'cd..': () => commands.cd(['..']), 'cd\\': () => commands.cd(['\\']) });

  function transfer(a, mode) {
    const args = a.filter(x => !x.startsWith('/'));
    if (args.length < 1) { print('The syntax of the command is incorrect.'); return; }
    const src = matchFiles(args[0]);
    const dstPath = resolve(args[1] || '.');
    if (!src.dir || !src.names.length) { print('The system cannot find the file specified.'); return; }
    const dstNode = dstPath && getNode(dstPath);
    let n = 0;
    if (src.folder && mode === 'copy') {
      /* copy dir\*  */
      src.names = src.names.filter(x => getNode([...src.dir, x]).type === 'file');
    }
    if (dstNode && dstNode.type === 'folder') {
      for (const name of src.names) {
        const res = mode === 'copy' ? copyNode(src.dir, name, canonical(dstPath)) : moveNode(src.dir, name, canonical(dstPath));
        if (res && typeof res === 'object') n++;
      }
    } else if (src.names.length === 1 && dstPath) {
      /* copy a.txt b.txt / move a.txt newname.txt */
      const parent = dstPath.slice(0, -1);
      const newName = dstPath[dstPath.length - 1];
      if (!getNode(parent)) { notFound(); return; }
      const srcNode = getNode([...src.dir, src.names[0]]);
      if (mode === 'move') {
        const moved = moveNode(src.dir, srcNode.name, canonical(parent));
        if (moved && typeof moved === 'object') { renameNode(canonical(parent), moved.name, newName); n = 1; }
      } else if (srcNode.type === 'file') {
        writeFile([...canonical(parent), newName], srcNode.content, srcNode.kind);
        n = 1;
      }
    } else { print('The syntax of the command is incorrect.'); return; }
    print(mode === 'copy' ? `${String(n).padStart(8)} file(s) copied.` : `${String(n).padStart(8)} file(s) moved.`);
  }

  function startThing(target, viaStart) {
    const t = target.trim();
    const lower = t.toLowerCase().replace(/\.exe$/, '');
    if (APP_ALIASES[lower]) { launch(APP_ALIASES[lower], lower === 'cmd' ? { cwd: st.cwd } : undefined); return true; }
    if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) { launch('edge', { url: /^www\./i.test(t) ? 'https://' + t : t }); return true; }
    const p = resolve(t);
    if (p && getNode(p)) { openPath(p); return true; }
    if (viaStart) print(`The system cannot find the file ${t}.`);
    return false;
  }

  let free = 0;
  diskInfo().then(d => { free = d.free; });

  async function runOne(line) {
    line = expand(line.trim());
    if (!line) return;
    if (line.startsWith('@')) line = line.slice(1);
    /* redirection */
    let redirect = null;
    const parts = splitOutside(line, />>|>/);
    if (parts.length > 1) {
      const m = line.match(/>>|>/g);
      redirect = { file: parts[parts.length - 1].trim().replace(/^"|"$/g, ''), append: m[m.length - 1] === '>>' };
      line = parts.slice(0, -1).join('>').trim();
    }
    const tokens = tokenize(line);
    let [cmd, ...args] = tokens;
    cmd = (cmd || '').toLowerCase();
    /* "cd.." and "cd\" style */
    if (/^cd\.\.$/.test(cmd)) { cmd = 'cd'; args = ['..']; }
    if (/^cd\\/.test(cmd)) { args = [cmd.slice(2) || '\\']; cmd = 'cd'; }
    if (/^[a-z]:$/.test(cmd)) { if (cmd !== 'c:') print('The system cannot find the drive specified.'); return; }

    if (redirect) sink = [];
    try {
      const fn = commands[cmd];
      if (fn) await fn(args, line);
      else if (args.length && APP_ALIASES[cmd.replace(/\.exe$/, '')] && cmd !== 'cmd') {
        /* "notepad notes.txt", "winword report.docx", "excel budget.xlsx" */
        const app = APP_ALIASES[cmd.replace(/\.exe$/, '')];
        const p = resolve(args.join(' '));
        const node = p && getNode(p);
        if (node && (node.type === 'file' || app === 'explorer')) launch(app, { path: canonical(p) });
        else print(`The system cannot find the file ${args.join(' ')}.`);
      }
      else if (!startThing(line, false) && !startThing(cmd, false)) {
        print(`'${tokens[0]}' is not recognized as an internal or external command,\noperable program or batch file.`);
      }
    } catch (e) {
      print('An internal error occurred: ' + e.message);
    }
    if (redirect) {
      const text = sink.join('\r\n') + (sink.length ? '\r\n' : '');
      sink = null;
      const p = resolve(redirect.file);
      if (!p || !getNode(p.slice(0, -1))) { notFound(); return; }
      if (!isValidName(p[p.length - 1])) { print('The filename, directory name, or volume label syntax is incorrect.'); return; }
      const existing = getNode(p);
      if (existing && existing.type === 'folder') { print('Access is denied.'); return; }
      writeFile([...canonical(p.slice(0, -1)), existing ? existing.name : p[p.length - 1]], (redirect.append && existing ? existing.content : '') + text, 'txt');
    }
  }

  async function run(raw) {
    print((st.echo ? prompt() : '') + raw);
    const line = raw.trim();
    if (line) {
      if (st.history[st.history.length - 1] !== line) st.history.push(line);
      if (st.history.length > 200) st.history.shift();
      try { localStorage.setItem('webwin-cmd-history', JSON.stringify(st.history)); } catch { /* ignore */ }
    }
    st.hIndex = st.history.length;
    st.busy = true; st.cancel = false;
    root.classList.add('busy');
    for (const part of splitOutside(line, /&&|&/)) {
      if (st.cancel) break;
      await runOne(part);
    }
    st.busy = false;
    root.classList.remove('busy');
    if (out.textContent && !out.textContent.endsWith('\n\n') && line && !/^cls$/i.test(line)) print('');
    if (!win.isOpen) return;
    input.focus();
  }

  /* tab completion */
  let tabState = null;
  function complete(back) {
    const v = input.value;
    if (!tabState) {
      const m = v.match(/^(.*?)("?)([^"\s]*)$/);
      const head = m[1] + '', word = m[3];
      const sep = Math.max(word.lastIndexOf('\\'), word.lastIndexOf('/'));
      const dirPart = sep >= 0 ? word.slice(0, sep + 1) : '';
      const base = word.slice(sep + 1).toLowerCase();
      const dir = getNode(resolve(dirPart || '.') || st.cwd);
      if (!dir || dir.type !== 'folder') return;
      const opts = dir.children.filter(c => c.name.toLowerCase().startsWith(base)).map(c => c.name).sort((a, b) => a.localeCompare(b));
      if (!opts.length) return;
      tabState = { head, dirPart, opts, i: back ? opts.length - 1 : 0 };
    } else {
      tabState.i = (tabState.i + (back ? -1 : 1) + tabState.opts.length) % tabState.opts.length;
    }
    const name = tabState.opts[tabState.i];
    const full = tabState.dirPart + name;
    input.value = tabState.head + (/\s/.test(full) ? `"${full}"` : full);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') tabState = null;
    if (e.ctrlKey && e.key.toLowerCase() === 'c' && (st.busy || !input.value || input.selectionStart === input.selectionEnd)) {
      if (window.getSelection().toString()) return;   /* let copy work */
      e.preventDefault();
      if (st.busy) { st.cancel = true; return; }
      print(prompt() + input.value + '^C');
      input.value = '';
      return;
    }
    if (st.busy) { if (e.key === 'Enter') e.preventDefault(); return; }
    if (e.key === 'Enter') { const v = input.value; input.value = ''; run(v); }
    else if (e.key === 'Tab') { e.preventDefault(); complete(e.shiftKey); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (st.hIndex > 0) { st.hIndex--; input.value = st.history[st.hIndex] || ''; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (st.hIndex < st.history.length) { st.hIndex++; input.value = st.history[st.hIndex] || ''; }
    } else if (e.key === 'Escape') { input.value = ''; }
    else if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); out.textContent = ''; }
  });

  root.addEventListener('mouseup', () => { if (!window.getSelection().toString()) input.focus(); });
  /* right-click pastes, like the real console */
  root.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const sel = window.getSelection().toString();
    if (sel) { try { await navigator.clipboard.writeText(sel); } catch { /* ignore */ } window.getSelection().removeAllRanges(); return; }
    try { const t = await navigator.clipboard.readText(); input.value += t.replace(/\r?\n/g, ' '); } catch { /* ignore */ }
    input.focus();
  });
  setTimeout(() => input.focus(), 80);

  if (arg && arg.run) setTimeout(() => run(arg.run), 100);
  return win;
}

