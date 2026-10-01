/* Settings store: theme, accent, wallpaper, night light, brightness. Persisted to localStorage. */

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

const DEFAULTS = {
  theme: 'light',
  accent: '#0078d7',
  wallpaper: 'hero',
  nightlight: false,
  brightness: 100,
  taskbarAccent: false,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* private mode etc. */ }
  return { ...DEFAULTS };
}

export const settings = load();
const listeners = [];
export function onSettingsChange(cb) { listeners.push(cb); }

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function applySettings() {
  const b = document.body;
  b.dataset.theme = settings.theme;
  b.style.setProperty('--accent', settings.accent);
  b.style.setProperty('--accent-dark', shade(settings.accent, 0.72));
  b.style.setProperty('--accent-light', shade(settings.accent, 1.75));

  document.getElementById('wallpaper').className = `wp-${settings.wallpaper}`;
  const lockBg = document.querySelector('#lock-screen .lock-bg');
  if (lockBg) lockBg.className = `lock-bg wp-${settings.wallpaper}`;

  document.getElementById('nightlight').classList.toggle('hidden', !settings.nightlight);
  const br = document.getElementById('brightness-overlay');
  br.classList.toggle('hidden', settings.brightness >= 100);
  br.style.opacity = String((100 - settings.brightness) / 130);

  document.getElementById('taskbar').classList.toggle('accent-bg', !!settings.taskbarAccent);
}

export function updateSettings(patch) {
  Object.assign(settings, patch);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  applySettings();
  listeners.forEach(cb => cb(settings));
}
