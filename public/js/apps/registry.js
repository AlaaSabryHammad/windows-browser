/* App registry — every installable app, its metadata and launcher. */
import { I } from '../icons.js';
import * as explorer from './explorer.js';
import * as notepad from './notepad.js';
import * as calculator from './calculator.js';
import * as edge from './edge.js';
import * as settingsApp from './settingsApp.js';
import * as paint from './paint.js';
import * as terminal from './terminal.js';
import * as taskmgr from './taskmgr.js';
import * as minesweeper from './minesweeper.js';
import * as photos from './photos.js';
import * as recycle from './recycle.js';

export const APPS = {
  explorer:   { id: 'explorer',   name: 'File Explorer', icon: I.folder,   color: '#c78a0e', w: 860, h: 540, pinned: true,  open: (arg) => explorer.open(arg) },
  edge:       { id: 'edge',       name: 'Microsoft Edge', icon: I.edge,     color: '#0f5fa8', w: 900, h: 600, pinned: true,  open: (arg) => edge.open(arg) },
  notepad:    { id: 'notepad',    name: 'Notepad',        icon: I.notepad,  color: '#2d6da3', w: 620, h: 440, pinned: true,  open: (arg) => notepad.open(arg) },
  calculator: { id: 'calculator', name: 'Calculator',     icon: I.calc,     color: '#44546a', w: 320, h: 480, minW: 280, minH: 420, pinned: true, open: () => calculator.open() },
  paint:      { id: 'paint',      name: 'Paint',          icon: I.paint,    color: '#b153a8', w: 820, h: 580, pinned: true,  open: () => paint.open() },
  terminal:   { id: 'terminal',   name: 'Command Prompt', icon: I.terminal, color: '#1b1b1b', w: 700, h: 420, pinned: true,  open: () => terminal.open() },
  settings:   { id: 'settings',   name: 'Settings',       icon: I.settings, color: '#3a6ea5', w: 900, h: 600, pinned: false, open: (arg) => settingsApp.open(arg) },
  photos:     { id: 'photos',     name: 'Photos',         icon: I.photos,   color: '#2e7d32', w: 760, h: 520, pinned: false, open: (arg) => photos.open(arg) },
  taskmgr:    { id: 'taskmgr',    name: 'Task Manager',   icon: I.taskmgr,  color: '#5a6b7d', w: 680, h: 500, pinned: false, open: () => taskmgr.open() },
  minesweeper:{ id: 'minesweeper',name: 'Minesweeper',    icon: I.mine,     color: '#37474f', w: 360, h: 470, minW: 340, minH: 460, pinned: false, open: () => minesweeper.open() },
  store:      { id: 'store',      name: 'Microsoft Store',icon: I.store,    color: '#1d7fc4', w: 700, h: 500, pinned: false, open: () => storeStub() },
  recycle:    { id: 'recycle',    name: 'Recycle Bin',    icon: I.recycle,  color: '#5b7c93', w: 640, h: 420, pinned: false, open: () => recycle.open() },
};

function storeStub() {
  import('../ui.js').then(ui => {
    ui.notify('Microsoft Store', 'You already own every app in this store. Lucky you! 😄', I.store);
  });
}

export function launch(id, arg) {
  const app = APPS[id];
  if (app) return app.open(arg);
  return null;
}

export function appList() {
  return Object.values(APPS).slice().sort((a, b) => a.name.localeCompare(b.name));
}
