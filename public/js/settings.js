/* Settings store: account, theme, accent, wallpaper, taskbar, sound, power… Persisted to localStorage. */
import { getNode } from './fs.js';

const KEY = 'webwin-settings-v1';

export const WALLPAPERS = [
  { id: 'hero',   name: 'Windows Hero' },
  { id: 'flow',   name: 'Flow' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'ocean',  name: 'Ocean' },
  { id: 'mint',   name: 'Mint' },
  { id: 'carbon', name: 'Carbon' },
];

export const ACCENTS = [
  '#0078d7', '#0063b1', '#8e8cd8', '#6b69d6', '#8764b8', '#744da9', '#b146c2',
  '#881798', '#e3008c', '#c30052', '#e81123', '#da3b01', '#ef6950', '#ff8c00',
  '#ffb900', '#498205', '#107c10', '#038387', '#00b7c3',
];

export const DEFAULT_TILES = [
  { name: 'Life at a glance', tiles: [
    { id: 'clock', size: 'md' },
    { id: 'weather', size: 'md' },
    { id: 'edge', size: 'md' },
    { id: 'photos', size: 'md' },
    { id: 'explorer', size: 'sm' },
    { id: 'settings', size: 'sm' },
    { id: 'stickynotes', size: 'sm' },
    { id: 'store', size: 'sm' },
  ] },
  { name: 'Office', tiles: [
    { id: 'word', size: 'md' },
    { id: 'excel', size: 'md' },
  ] },
  { name: 'Play and explore', tiles: [
    { id: 'minesweeper', size: 'md' },
    { id: 'mediaplayer', size: 'md' },
    { id: 'camera', size: 'sm' },
    { id: 'paint', size: 'sm' },
    { id: 'calculator', size: 'sm' },
    { id: 'notepad', size: 'sm' },
    { id: 'terminal', size: 'sm' },
    { id: 'taskmgr', size: 'sm' },
  ] },
];

const DEFAULTS = {
  setupDone: false,
  userName: 'User',
  passwordHash: null,          /* salted SHA-256, hex */
  pcName: 'WEB-DESKTOP-01',

  theme: 'light',
  accent: '#0078d7',
  transparency: true,
  wallpaper: 'hero',           /* preset id | 'picture' | 'solid' */
  wallpaperPath: null,         /* VFS path when wallpaper === 'picture' */
  solidColor: '#0063b1',
  taskbarAccent: false,

  nightlight: false,
  brightness: 100,

  volume: 72,
  muted: false,
  systemSounds: true,

  dnd: false,                  /* Focus assist */
  airplane: false,

  clock24: false,
  clockSeconds: false,
  searchMode: 'box',           /* 'box' | 'icon' | 'hidden' */

  pinned: ['explorer', 'edge', 'word', 'excel', 'notepad', 'calculator', 'terminal'],
  tiles: null,                 /* null = DEFAULT_TILES */
  startupApps: [],
  fullscreenOnSignIn: true,
  requireSignIn: true,

  iconSize: 'medium',          /* 'large' | 'medium' | 'small' */
  showDesktopIcons: true,
  autoArrange: false,
  explorerView: 'icons',       /* 'icons' | 'details' */
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* private mode etc. */ }
  return { ...DEFAULTS };
}

export const settings = load();
const listeners = new Set();
export function onSettingsChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function offSettingsChange(cb) { listeners.delete(cb); }

export function tilesConfig() {
  return settings.tiles || JSON.parse(JSON.stringify(DEFAULT_TILES));
}

export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/* CSS background value for the current wallpaper (null = use the preset class) */
export function wallpaperStyle() {
  if (settings.wallpaper === 'solid') return settings.solidColor;
  if (settings.wallpaper === 'picture' && settings.wallpaperPath) {
    const node = getNode(settings.wallpaperPath);
    if (node && node.content) return `center / cover no-repeat url("${node.content}")`;
  }
  return null;
}

export function applySettings() {
  const b = document.body;
  b.dataset.theme = settings.theme;
  b.classList.toggle('no-transparency', !settings.transparency);
  b.style.setProperty('--accent', settings.accent);
  b.style.setProperty('--accent-dark', shade(settings.accent, 0.72));
  b.style.setProperty('--accent-light', shade(settings.accent, 1.75));

  const custom = wallpaperStyle();
  const preset = custom ? 'wp-custom' : `wp-${WALLPAPERS.some(w => w.id === settings.wallpaper) ? settings.wallpaper : 'hero'}`;
  for (const el of [document.getElementById('wallpaper'), document.querySelector('#lock-screen .lock-bg')]) {
    if (!el) continue;
    el.className = (el.id === 'wallpaper' ? '' : 'lock-bg ') + preset;
    el.style.background = custom || '';
  }

  document.getElementById('nightlight').classList.toggle('hidden', !settings.nightlight);
  const br = document.getElementById('brightness-overlay');
  br.classList.toggle('hidden', settings.brightness >= 100);
  br.style.opacity = String((100 - settings.brightness) / 130);

  document.getElementById('taskbar').classList.toggle('accent-bg', !!settings.taskbarAccent);
}

export function updateSettings(patch) {
  Object.assign(settings, patch);
  persistSettings();
  applySettings();
  listeners.forEach(cb => { try { cb(settings, patch); } catch (e) { console.error(e); } });
}

export function persistSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

/* ---------- account helpers ---------- */
async function sha256(text) {
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  /* insecure-context fallback (e.g. opened over a LAN IP): FNV-1a, good enough for a toy lock */
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'fnv' + h.toString(16);
}
export async function hashPassword(pw) { return sha256('webwin::' + pw); }
export async function checkPassword(pw) {
  if (!settings.passwordHash) return true;
  return (await hashPassword(pw)) === settings.passwordHash;
}
export function userInitial() { return (settings.userName || 'U').trim().charAt(0).toUpperCase() || 'U'; }

export function resetSettings() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
