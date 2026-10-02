/* App registry — every installable app, its metadata and launcher. */
import { I } from '../icons.js';
import { appWindows } from '../wm.js';
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
import * as mediaplayer from './mediaplayer.js';
import * as camera from './camera.js';
import * as clock from './clock.js';
import * as stickynotes from './stickynotes.js';
import * as weather from './weather.js';
import * as run from './run.js';
import * as word from './word.js';
import * as excel from './excel.js';

/* single: only one window at a time — launching again focuses it (and passes the new argument along) */
export const APPS = {
  word:        { id: 'word',        name: 'Word',             icon: I.word,     color: '#185abd', open: (a) => word.open(a) },
  excel:       { id: 'excel',       name: 'Excel',            icon: I.excel,    color: '#107c41', open: (a) => excel.open(a) },
  explorer:    { id: 'explorer',    name: 'File Explorer',    icon: I.folder,   color: '#c78a0e', open: (a) => explorer.open(a) },
  edge:        { id: 'edge',        name: 'Microsoft Edge',   icon: I.edge,     color: '#0f5fa8', open: (a) => edge.open(a) },
  notepad:     { id: 'notepad',     name: 'Notepad',          icon: I.notepad,  color: '#2d6da3', open: (a) => notepad.open(a) },
  calculator:  { id: 'calculator',  name: 'Calculator',       icon: I.calc,     color: '#44546a', open: () => calculator.open() },
  paint:       { id: 'paint',       name: 'Paint',            icon: I.paint,    color: '#b153a8', open: (a) => paint.open(a) },
  terminal:    { id: 'terminal',    name: 'Command Prompt',   icon: I.terminal, color: '#1b1b1b', open: (a) => terminal.open(a) },
  settings:    { id: 'settings',    name: 'Settings',         icon: I.settings, color: '#3a6ea5', single: true, open: (a) => settingsApp.open(a) },
  photos:      { id: 'photos',      name: 'Photos',           icon: I.photos,   color: '#2e7d32', open: (a) => photos.open(a) },
  taskmgr:     { id: 'taskmgr',     name: 'Task Manager',     icon: I.taskmgr,  color: '#5a6b7d', single: true, open: () => taskmgr.open() },
  minesweeper: { id: 'minesweeper', name: 'Minesweeper',      icon: I.mine,     color: '#37474f', open: () => minesweeper.open() },
  store:       { id: 'store',       name: 'Microsoft Store',  icon: I.store,    color: '#1d7fc4', open: () => storeStub() },
  recycle:     { id: 'recycle',     name: 'Recycle Bin',      icon: I.recycle,  color: '#5b7c93', single: true, open: (a) => recycle.open(a) },
  mediaplayer: { id: 'mediaplayer', name: 'Media Player',     icon: I.media,    color: '#b3166b', single: true, open: (a) => mediaplayer.open(a) },
  camera:      { id: 'camera',      name: 'Camera',           icon: I.camera,   color: '#3b4b5c', single: true, open: () => camera.open() },
  clock:       { id: 'clock',       name: 'Alarms & Clock',   icon: I.alarm,    color: '#1f6fb2', single: true, open: (a) => clock.open(a) },
  stickynotes: { id: 'stickynotes', name: 'Sticky Notes',     icon: I.sticky,   color: '#c7a600', open: (a) => stickynotes.open(a) },
  weather:     { id: 'weather',     name: 'Weather',          icon: I.weather,  color: '#2b88d8', single: true, open: () => weather.open() },
  run:         { id: 'run',         name: 'Run',              icon: I.run,      color: '#2b5797', single: true, hidden: true, open: () => run.open() },
};

function storeStub() {
  import('../ui.js').then(ui => {
    ui.notify('Microsoft Store', 'You already own every app in this store. Lucky you! 😄', I.store);
  });
}

/* launch counts → "Most used" in Start */
const USAGE_KEY = 'webwin-usage-v1';
let usage = {};
try { usage = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'); } catch { usage = {}; }
export function mostUsed(n = 4) {
  return Object.entries(usage).filter(([id]) => APPS[id] && !APPS[id].hidden).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => APPS[id]);
}

export function launch(id, arg) {
  const app = APPS[id];
  if (!app) return null;
  usage[id] = (usage[id] || 0) + 1;
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(usage)); } catch { /* ignore */ }
  if (app.single) {
    const existing = appWindows(id)[0];
    if (existing) {
      existing.focus();
      if (existing.onRelaunch) existing.onRelaunch(arg);
      return existing;
    }
  }
  return app.open(arg);
}

export function appList() {
  return Object.values(APPS).slice().sort((a, b) => a.name.localeCompare(b.name));
}
