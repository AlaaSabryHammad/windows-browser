/* System sounds, synthesized with Web Audio (no audio files). Respects volume / mute / system-sounds settings. */
import { settings } from './settings.js';

let ctx = null;
function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/* master volume 0..1 for everything that makes noise (media players use it too) */
export function masterVolume() { return settings.muted ? 0 : settings.volume / 100; }

function tone(c, { freq, start = 0, dur = 0.3, type = 'sine', gain = 0.25, attack = 0.01, to = null, dest }) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  if (to) o.frequency.exponentialRampToValueAtTime(to, c.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(dest);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

const SOUNDS = {
  /* soft rising chord — like the Windows 10 logon chime */
  logon: (c, d) => {
    [[523.25, 0], [659.25, 0.09], [783.99, 0.18], [1046.5, 0.3]].forEach(([f, s]) =>
      tone(c, { freq: f, start: s, dur: 1.4, gain: 0.12, attack: 0.04, dest: d }));
  },
  startup: (c, d) => {
    [[392, 0], [523.25, 0.14], [659.25, 0.28], [987.77, 0.42], [783.99, 0.56]].forEach(([f, s]) =>
      tone(c, { freq: f, start: s, dur: 1.6, gain: 0.1, attack: 0.05, dest: d }));
  },
  shutdown: (c, d) => {
    [[783.99, 0], [659.25, 0.16], [523.25, 0.32], [392, 0.48]].forEach(([f, s]) =>
      tone(c, { freq: f, start: s, dur: 1.2, gain: 0.1, attack: 0.04, dest: d }));
  },
  notify: (c, d) => {
    tone(c, { freq: 880, dur: 0.35, gain: 0.16, dest: d });
    tone(c, { freq: 1318.5, start: 0.11, dur: 0.5, gain: 0.14, dest: d });
  },
  ding: (c, d) => {
    tone(c, { freq: 1046.5, dur: 0.5, gain: 0.15, type: 'triangle', dest: d });
    tone(c, { freq: 1567.98, dur: 0.5, gain: 0.06, dest: d });
  },
  error: (c, d) => {
    tone(c, { freq: 440, dur: 0.18, gain: 0.18, type: 'triangle', dest: d });
    tone(c, { freq: 349.23, start: 0.16, dur: 0.4, gain: 0.18, type: 'triangle', dest: d });
  },
  warn: (c, d) => {
    tone(c, { freq: 659.25, dur: 0.22, gain: 0.15, type: 'triangle', dest: d });
    tone(c, { freq: 523.25, start: 0.14, dur: 0.35, gain: 0.15, type: 'triangle', dest: d });
  },
  recycle: (c, d) => {
    /* crumpling paper: filtered noise bursts */
    const len = 0.5;
    const buf = c.createBuffer(1, c.sampleRate * len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * (Math.random() < 0.2 ? 1 : 0.25) * (1 - t);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.7;
    const g = c.createGain(); g.gain.value = 0.5;
    src.connect(f).connect(g).connect(d);
    src.start();
  },
  alarm: (c, d) => {
    for (let i = 0; i < 4; i++) {
      tone(c, { freq: 988, start: i * 0.5, dur: 0.18, gain: 0.2, type: 'square', dest: d });
      tone(c, { freq: 1319, start: i * 0.5 + 0.2, dur: 0.18, gain: 0.2, type: 'square', dest: d });
    }
  },
  click: (c, d) => tone(c, { freq: 1800, dur: 0.04, gain: 0.08, type: 'square', dest: d }),
  shutter: (c, d) => {
    const buf = c.createBuffer(1, c.sampleRate * 0.12, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = 0.6;
    src.connect(g).connect(d); src.start();
  },
};

/* force=true plays even when "system sounds" are off (e.g. alarms, volume test) */
export function playSound(name, force = false) {
  if (!force && !settings.systemSounds) return;
  const vol = masterVolume();
  if (vol <= 0) return;
  const c = ac();
  if (!c || !SOUNDS[name]) return;
  const master = c.createGain();
  master.gain.value = vol;
  master.connect(c.destination);
  try { SOUNDS[name](c, master); } catch { /* ignore */ }
}

/* browsers block audio until the first user gesture — unlock on first interaction */
['pointerdown', 'keydown'].forEach(evt => window.addEventListener(evt, () => ac(), { once: true, capture: true }));
