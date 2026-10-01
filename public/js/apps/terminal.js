/* Command Prompt — fake but surprisingly useful terminal wired to the VFS */
import { createWindow } from '../wm.js';
import { I } from '../icons.js';
import { getNode, ROOT, HOME, addressOf } from '../fs.js';
import { launch } from './registry.js';

const HELP = `Available commands:
  HELP              Shows this list
  DIR               Lists files in the current directory
  CD [path]         Changes directory (.. to go up)
  TYPE <file>       Prints a text file
  TREE              Shows the folder tree
  ECHO <text>       Prints text
  CLS               Clears the screen
  VER               Shows the Windows version
  DATE / TIME       Shows current date / time
  WHOAMI            Shows the current user
  HOSTNAME          Shows the computer name
  START <app>       Launches an app (notepad, calc, paint, mspaint, explorer, edge, minesweeper, taskmgr, settings)
  COLOR <code>      e.g. COLOR 0a for hacker green
  SHUTDOWN          Turns off the computer
  EXIT              Closes the Command Prompt`;

const APP_ALIASES = { notepad: 'notepad', calc: 'calculator', calculator: 'calculator', paint: 'paint', mspaint: 'paint', explorer: 'explorer', edge: 'edge', minesweeper: 'minesweeper', taskmgr: 'taskmgr', settings: 'settings', photos: 'photos' };

export function open() {
  const win = createWindow({ title: 'Command Prompt', icon: I.terminal, appId: 'terminal', w: 720, h: 440, minW: 420, minH: 240 });
  win.body.innerHTML = `
    <div class="terminal">
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

  const st = { cwd: [...HOME], history: [], hIndex: -1, green: false };

  const prompt = () => 'C:\\' + st.cwd.join('\\') + '>';
  const refreshPrompt = () => { promptEl.textContent = prompt(); };
  refreshPrompt();

  function print(text = '') {
    out.textContent += text + '\n';
    out.scrollTop = out.scrollHeight;
  }

  print('Microsoft Windows [Version 10.0.19045.2026]');
  print('(c) Microsoft Corporation. All rights reserved. Well... sort of.\n');
  print("Type HELP to see what this thing can do.\n");

  function resolve(arg) {
    if (!arg) return null;
    if (arg === '..') return st.cwd.slice(0, -1);
    if (arg === '\\' || arg === '/') return [];
    if (arg.includes('\\')) {
      const parts = arg.replace(/^\\+/, '').split('\\').filter(Boolean);
      return [...st.cwd, ...parts];
    }
    return [...st.cwd, arg];
  }

  const commands = {
    help: () => print(HELP),
    cls: () => { out.textContent = ''; },
    ver: () => print('\nMicrosoft Windows [Version 10.0.19045.2026] Web Edition\n'),
    date: () => print('The current date is: ' + new Date().toLocaleDateString('en-US')),
    time: () => print('The current time is: ' + new Date().toLocaleTimeString('en-US')),
    whoami: () => print('web-desktop-01\\alaa'),
    hostname: () => print('WEB-DESKTOP-01'),
    echo: (args) => print(args.join(' ')),
    dir: () => {
      const node = getNode(st.cwd);
      if (!node || !node.children) return print('The system cannot find the path specified.');
      print(` Directory of ${addressOf(st.cwd)}\n`);
      const dirs = node.children.filter(c => c.type === 'folder');
      const files = node.children.filter(c => c.type === 'file');
      print(`${new Date().toLocaleDateString('en-US')}  ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}    <DIR>          .`);
      print(`${new Date().toLocaleDateString('en-US')}  ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}    <DIR>          ..`);
      for (const d of dirs) print(`${new Date(d.created).toLocaleDateString('en-US')}  12:00 AM    <DIR>          ${d.name}`);
      for (const f of files) print(`${new Date(f.created).toLocaleDateString('en-US')}  12:00 AM        ${String((f.content || '').length).padStart(8)} ${f.name}`);
      print(`\n       ${files.length} File(s)`);
      print(`       ${dirs.length} Dir(s)   174,530,596,864 bytes free`);
    },
    cd: (args) => {
      if (!args.length) { print(addressOf(st.cwd)); return; }
      const p = resolve(args[0]);
      if (args[0] === '.') return;
      const node = p && getNode(p);
      if (node && node.type === 'folder') { st.cwd = p; refreshPrompt(); }
      else print('The system cannot find the path specified.');
    },
    type: (args) => {
      if (!args.length) return print('Usage: TYPE <file>');
      const node = getNode([...st.cwd, args[0]]);
      if (!node || node.type !== 'file') return print(`The system cannot find the file ${args[0]}.`);
      if (node.kind !== 'txt') return print('Only text files can be printed here.');
      print(node.content || '');
    },
    tree: () => {
      const lines = [];
      (function walk(node, prefix, depth) {
        if (depth > 4) return;
        const kids = node.children || [];
        kids.forEach((c, i) => {
          const last = i === kids.length - 1;
          lines.push(prefix + (last ? '└── ' : '├── ') + c.name + (c.type === 'folder' ? '' : ''));
          if (c.type === 'folder') walk(c, prefix + (last ? '    ' : '│   '), depth + 1);
        });
      })(ROOT(), '', 0);
      print(`C:.`);
      print(lines.join('\n'));
    },
    start: (args) => {
      const key = (args[0] || '').toLowerCase();
      const appId = APP_ALIASES[key];
      if (appId) { launch(appId); print(`Starting ${key}...`); }
      else print(`'${args[0] || ''}' is not recognized as an app. Try: ${Object.keys(APP_ALIASES).join(', ')}`);
    },
    color: (args) => {
      if (args[0] === '0a' || args[0] === 'a') { root.classList.add('green'); print('Hacker mode engaged.'); }
      else if (args[0] === 'reset') { root.classList.remove('green'); }
      else print('Try COLOR 0a.');
    },
    shutdown: () => {
      print('Shutting down...');
      setTimeout(() => window.dispatchEvent(new CustomEvent('webwin:shutdown')), 600);
    },
    exit: () => win.close(),
  };

  async function run(raw) {
    const line = raw.trim();
    print(prompt() + ' ' + raw);
    if (!line) return;
    st.history.push(line);
    st.hIndex = st.history.length;
    const [cmd, ...args] = line.split(/\s+/);
    const fn = commands[cmd.toLowerCase()];
    if (fn) fn(args);
    else print(`'${cmd}' is not recognized as an internal or external command,\noperable program or batch file.`);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = input.value; input.value = ''; run(v); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (st.hIndex > 0) { st.hIndex--; input.value = st.history[st.hIndex] || ''; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (st.hIndex < st.history.length) { st.hIndex++; input.value = st.history[st.hIndex] || ''; }
    }
  });

  root.addEventListener('click', () => input.focus());
  setTimeout(() => input.focus(), 80);

  return win;
}
