/* Alarms & Clock — alarms (keep ringing even when the app is closed), timers, stopwatch with laps, world clock. */
import { createWindow, appWindows } from '../wm.js';
import { I } from '../icons.js';
import { notify, esc, promptDialog, contextMenu } from '../ui.js';
import { playSound } from '../sound.js';
import { settings } from '../settings.js';

const KEY = 'webwin-clock-v1';
const CITIES = [
  ['Cairo', 'Africa/Cairo'], ['Riyadh', 'Asia/Riyadh'], ['Dubai', 'Asia/Dubai'], ['London', 'Europe/London'], ['Paris', 'Europe/Paris'],
  ['Berlin', 'Europe/Berlin'], ['Istanbul', 'Europe/Istanbul'], ['Moscow', 'Europe/Moscow'], ['New York', 'America/New_York'],
  ['Chicago', 'America/Chicago'], ['Los Angeles', 'America/Los_Angeles'], ['São Paulo', 'America/Sao_Paulo'], ['Tokyo', 'Asia/Tokyo'],
  ['Beijing', 'Asia/Shanghai'], ['Delhi', 'Asia/Kolkata'], ['Sydney', 'Australia/Sydney'], ['Casablanca', 'Africa/Casablanca'], ['Kuwait', 'Asia/Kuwait'],
];
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/* ---------------- shared state / background service ---------------- */
const state = {
  alarms: [{ id: 'a1', time: '07:00', label: 'Good morning', days: [1, 2, 3, 4, 5], on: false }],
  cities: ['Europe/London', 'America/New_York', 'Asia/Tokyo'],
  timers: [{ id: 't1', label: 'Timer (1)', dur: 60, left: 60, running: false, endAt: 0 }, { id: 't2', label: 'Tea', dur: 180, left: 180, running: false, endAt: 0 }, { id: 't3', label: 'Pomodoro', dur: 1500, left: 1500, running: false, endAt: 0 }],
  sw: { running: false, startAt: 0, acc: 0, laps: [] },
};
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) {
      state.alarms = s.alarms || state.alarms;
      state.cities = s.cities || state.cities;
      if (s.timers) state.timers = s.timers.map(t => ({ ...t, running: false, left: t.dur, endAt: 0 }));
    }
  } catch { /* ignore */ }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ alarms: state.alarms, cities: state.cities, timers: state.timers.map(({ id, label, dur }) => ({ id, label, dur })) })); } catch { /* ignore */ }
}
const listeners = new Set();
const changed = () => listeners.forEach(cb => cb());
const fmtHMS = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 2, '0')}:${String(x).padStart(2, '0')}`; };
const fmtSW = (ms) => { const t = Math.floor(ms / 10); const cs = t % 100, s = Math.floor(t / 100) % 60, m = Math.floor(t / 6000) % 60, h = Math.floor(t / 360000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`; };
const fmtAlarm = (t) => { const [h, m] = t.split(':').map(Number); return settings.clock24 ? t : `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

let ringing = null;
function ring(title, body, onSnooze) {
  stopRing();
  playSound('alarm', true);
  const loop = setInterval(() => playSound('alarm', true), 2600);
  const stopAt = setTimeout(stopRing, 60000);
  ringing = { loop, stopAt };
  appWindows('clock').forEach(w => w.flash());
  notify(title, body, I.alarm, {
    urgent: true, silent: true, sticky: true,
    actions: [
      ...(onSnooze ? [{ label: 'Snooze (5 min)', action: () => { stopRing(); onSnooze(); } }] : []),
      { label: 'Dismiss', action: stopRing },
    ],
    onClick: stopRing,
  });
}
function stopRing() { if (ringing) { clearInterval(ringing.loop); clearTimeout(ringing.stopAt); ringing = null; } }

let lastMinute = '';
export function initClockService() {
  load();
  setInterval(() => {
    const now = new Date();
    /* alarms */
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const minuteKey = now.toDateString() + hm;
    if (minuteKey !== lastMinute) {
      lastMinute = minuteKey;
      for (const a of state.alarms) {
        if (!a.on || a.time !== hm) continue;
        if (a.days.length && !a.days.includes(now.getDay())) continue;
        ring(a.label || 'Alarm', `${fmtAlarm(a.time)} — Alarms & Clock`, () => {
          const t = new Date(Date.now() + 5 * 60000);
          const snooze = { id: 's' + Date.now(), time: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`, label: (a.label || 'Alarm') + ' (snoozed)', days: [], on: true, once: true };
          state.alarms.push(snooze); save(); changed();
        });
        if (!a.days.length) { a.on = false; if (a.once) state.alarms = state.alarms.filter(x => x !== a); save(); changed(); }
      }
    }
    /* timers */
    for (const t of state.timers) {
      if (!t.running) continue;
      t.left = (t.endAt - Date.now()) / 1000;
      if (t.left <= 0) {
        t.running = false; t.left = t.dur;
        ring(t.label || 'Timer', 'Time\'s up!', null);
        changed();
      }
    }
  }, 250);
}

/* ---------------- the app ---------------- */
export function open(arg = null) {
  const win = createWindow({ title: 'Alarms & Clock', icon: I.alarm, appId: 'clock', w: 720, h: 520, minW: 460, minH: 360 });
  win.body.innerHTML = `
    <div class="clk">
      <div class="clk-side">
        <div class="clk-nav" data-t="timer">${I.clock}<span>Timer</span></div>
        <div class="clk-nav" data-t="alarm">${I.alarm}<span>Alarm</span></div>
        <div class="clk-nav" data-t="stopwatch">${I.history}<span>Stopwatch</span></div>
        <div class="clk-nav" data-t="world">${I.globe}<span>World clock</span></div>
      </div>
      <div class="clk-main"></div>
    </div>`;
  const main = win.body.querySelector('.clk-main');
  let tab = arg && arg.tab ? arg.tab : 'alarm';
  let tick = null;

  function setTab(t) {
    tab = t;
    win.body.querySelectorAll('.clk-nav').forEach(n => n.classList.toggle('sel', n.dataset.t === t));
    render();
  }
  win.body.querySelectorAll('.clk-nav').forEach(n => n.addEventListener('click', () => setTab(n.dataset.t)));

  function render() {
    clearInterval(tick);
    if (tab === 'alarm') renderAlarms();
    else if (tab === 'timer') { renderTimers(); tick = setInterval(updateTimers, 200); }
    else if (tab === 'stopwatch') { renderSW(); tick = setInterval(updateSW, 33); }
    else { renderWorld(); tick = setInterval(renderWorld, 1000); }
  }

  /* ---- alarms ---- */
  function renderAlarms() {
    main.innerHTML = `<div class="clk-head"><h1>Alarm</h1><button class="btn primary clk-add">+ Add an alarm</button></div>
      <div class="clk-note">Alarms ring while this PC is on — even if this app is closed. Notifications will break through Focus assist.</div>
      <div class="alarm-grid">${state.alarms.map((a, i) => `
        <div class="alarm-card ${a.on ? 'on' : ''}" data-i="${i}">
          <div class="ac-top"><div class="ac-time">${fmtAlarm(a.time)}</div>
            <label class="switch"><input type="checkbox" ${a.on ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label></div>
          <div class="ac-label">${esc(a.label || 'Alarm')}</div>
          <div class="ac-days">${a.days.length === 7 ? 'Every day' : a.days.length ? DAYS.map((d, k) => `<span class="${a.days.includes(k) ? 'd-on' : ''}">${d}</span>`).join('') : 'Only once'}</div>
        </div>`).join('')}</div>`;
    main.querySelector('.clk-add').addEventListener('click', () => editAlarm(null));
    main.querySelectorAll('.alarm-card').forEach(card => {
      const a = state.alarms[+card.dataset.i];
      card.querySelector('input').addEventListener('change', (e) => { a.on = e.target.checked; save(); renderAlarms(); });
      card.querySelector('.switch').addEventListener('click', (e) => e.stopPropagation());
      card.addEventListener('click', () => editAlarm(a));
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [{ label: 'Edit', action: () => editAlarm(a) }, { label: 'Delete', icon: I.trash, action: () => { state.alarms = state.alarms.filter(x => x !== a); save(); renderAlarms(); } }]); });
    });
  }

  function editAlarm(a) {
    const isNew = !a;
    const now = new Date();
    const draft = a ? { ...a, days: [...a.days] } : { id: 'a' + Date.now(), time: `${String(now.getHours()).padStart(2, '0')}:${String((now.getMinutes() + 1) % 60).padStart(2, '0')}`, label: 'Alarm', days: [], on: true };
    main.innerHTML = `<div class="clk-head"><h1>${isNew ? 'New alarm' : 'Edit alarm'}</h1></div>
      <div class="alarm-edit">
        <input type="time" class="ae-time" value="${draft.time}">
        <label>Alarm name<input class="ae-label" value="${esc(draft.label)}" spellcheck="false"></label>
        <div>Repeat<div class="ae-days">${DAYS.map((d, k) => `<button class="ae-day ${draft.days.includes(k) ? 'sel' : ''}" data-k="${k}">${d}</button>`).join('')}</div></div>
        <div class="ae-btns"><button class="btn primary ae-save">Save</button>${isNew ? '' : '<button class="btn ae-del">Delete</button>'}<button class="btn ae-cancel">Cancel</button></div>
      </div>`;
    main.querySelectorAll('.ae-day').forEach(b => b.addEventListener('click', () => {
      const k = +b.dataset.k;
      draft.days = draft.days.includes(k) ? draft.days.filter(x => x !== k) : [...draft.days, k].sort();
      b.classList.toggle('sel');
    }));
    main.querySelector('.ae-save').addEventListener('click', () => {
      draft.time = main.querySelector('.ae-time').value || draft.time;
      draft.label = main.querySelector('.ae-label').value.trim() || 'Alarm';
      draft.on = true;
      if (isNew) state.alarms.push(draft); else Object.assign(a, draft);
      save();
      const [h, m] = draft.time.split(':').map(Number);
      const t = new Date(); t.setHours(h, m, 0, 0); if (t <= new Date()) t.setDate(t.getDate() + 1);
      const mins = Math.round((t - new Date()) / 60000);
      notify('Alarms & Clock', `Alarm in ${Math.floor(mins / 60)} hours, ${mins % 60} minutes`, I.alarm, { silent: true });
      renderAlarms();
    });
    main.querySelector('.ae-del')?.addEventListener('click', () => { state.alarms = state.alarms.filter(x => x !== a); save(); renderAlarms(); });
    main.querySelector('.ae-cancel').addEventListener('click', renderAlarms);
  }

  /* ---- timers ---- */
  function renderTimers() {
    main.innerHTML = `<div class="clk-head"><h1>Timer</h1><button class="btn primary clk-add">+ Add new timer</button></div>
      <div class="timer-grid">${state.timers.map((t, i) => `
        <div class="timer-card" data-i="${i}">
          <div class="tc-label">${esc(t.label)}</div>
          <div class="tc-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="tr-bg"/><circle cx="50" cy="50" r="44" class="tr-fg"/></svg><div class="tc-time"></div></div>
          <div class="tc-btns"><button class="mp-b tc-play">${I.play}</button><button class="mp-b tc-reset">${I.restart}</button><button class="mp-b tc-del" title="Delete">${I.trash}</button></div>
        </div>`).join('')}</div>`;
    main.querySelector('.clk-add').addEventListener('click', async () => {
      const v = await promptDialog('New timer', 'Duration (minutes, or mm:ss):', '5', '', { validate: (x) => (/^\d{1,3}(:\d{1,2})?$/.test(x) ? null : 'Use minutes like 5 or mm:ss like 2:30') });
      if (!v) return;
      const [m, s] = v.split(':').map(Number);
      const dur = m * 60 + (s || 0);
      if (!dur) return;
      state.timers.push({ id: 't' + Date.now(), label: `Timer (${state.timers.length + 1})`, dur, left: dur, running: false, endAt: 0 });
      save(); renderTimers();
    });
    main.querySelectorAll('.timer-card').forEach(card => {
      const t = state.timers[+card.dataset.i];
      card.querySelector('.tc-play').addEventListener('click', () => {
        if (t.running) { t.running = false; t.left = (t.endAt - Date.now()) / 1000; }
        else { t.running = true; t.endAt = Date.now() + t.left * 1000; }
        updateTimers();
      });
      card.querySelector('.tc-reset').addEventListener('click', () => { t.running = false; t.left = t.dur; updateTimers(); });
      card.querySelector('.tc-del').addEventListener('click', () => { state.timers = state.timers.filter(x => x !== t); save(); renderTimers(); });
      card.querySelector('.tc-label').addEventListener('dblclick', async () => {
        const n = await promptDialog('Rename timer', 'Name:', t.label);
        if (n) { t.label = n; save(); renderTimers(); }
      });
    });
    updateTimers();
  }
  function updateTimers() {
    main.querySelectorAll('.timer-card').forEach(card => {
      const t = state.timers[+card.dataset.i];
      if (!t) return;
      const left = t.running ? (t.endAt - Date.now()) / 1000 : t.left;
      card.querySelector('.tc-time').textContent = fmtHMS(Math.ceil(left));
      card.querySelector('.tr-fg').style.strokeDashoffset = String(276.5 * (1 - Math.max(0, left) / t.dur));
      card.querySelector('.tc-play').innerHTML = t.running ? I.pause : I.play;
      card.classList.toggle('running', t.running);
    });
  }

  /* ---- stopwatch ---- */
  const swNow = () => state.sw.acc + (state.sw.running ? Date.now() - state.sw.startAt : 0);
  function renderSW() {
    const sw = state.sw;
    main.innerHTML = `<div class="clk-head"><h1>Stopwatch</h1></div>
      <div class="sw-time">${fmtSW(swNow())}</div>
      <div class="sw-btns"><button class="mp-b big sw-play">${sw.running ? I.pause : I.play}</button><button class="mp-b sw-lap" title="Lap" ${sw.running ? '' : 'disabled'}>${I.flag}</button><button class="mp-b sw-reset" title="Reset">${I.restart}</button></div>
      <div class="sw-laps">${sw.laps.length ? `<div class="sw-lh"><span>Laps</span><span>Time</span><span>Total</span></div>` : ''}${sw.laps.map((l, i) => `<div class="sw-lr"><span>${sw.laps.length - i}</span><span>${fmtSW(l.split)}</span><span>${fmtSW(l.total)}</span></div>`).join('')}</div>`;
    main.querySelector('.sw-play').addEventListener('click', () => {
      if (sw.running) { sw.acc += Date.now() - sw.startAt; sw.running = false; }
      else { sw.startAt = Date.now(); sw.running = true; }
      renderSW();
    });
    main.querySelector('.sw-lap').addEventListener('click', () => {
      const total = swNow();
      const prev = sw.laps[0] ? sw.laps[0].total : 0;
      sw.laps.unshift({ total, split: total - prev });
      renderSW();
    });
    main.querySelector('.sw-reset').addEventListener('click', () => { Object.assign(sw, { running: false, startAt: 0, acc: 0, laps: [] }); renderSW(); });
  }
  function updateSW() { const el = main.querySelector('.sw-time'); if (el) el.textContent = fmtSW(swNow()); }

  /* ---- world clock ---- */
  function renderWorld() {
    const now = new Date();
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetOf = (tz) => {
      const s = now.toLocaleString('en-US', { timeZone: tz });
      return Math.round((new Date(s) - new Date(now.toLocaleString('en-US'))) / 3600000);
    };
    const card = (tz, name, isLocal) => {
      const off = isLocal ? 0 : offsetOf(tz);
      const t = now.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: !settings.clock24 });
      const h = Number(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
      return `<div class="wc-card ${h >= 6 && h < 18 ? 'day' : 'night'}" data-tz="${tz}"><div class="wc-name">${esc(name)}${isLocal ? ' <small>(Local time)</small>' : ''}</div>
        <div class="wc-time">${t}</div><div class="wc-off">${isLocal ? now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : `${off === 0 ? 'Same time' : off > 0 ? `${off} hr ahead` : `${-off} hr behind`}`}</div></div>`;
    };
    const existing = main.querySelector('.wc-grid');
    const html = card(local, local.split('/').pop().replace(/_/g, ' '), true) +
      state.cities.map(tz => card(tz, (CITIES.find(c => c[1] === tz) || [tz.split('/').pop().replace(/_/g, ' ')])[0], false)).join('');
    if (existing) { existing.innerHTML = html; bindWorld(); return; }
    main.innerHTML = `<div class="clk-head"><h1>World clock</h1><select class="set-select wc-add"><option value="">+ Add a city</option>${CITIES.map(([n, tz]) => `<option value="${tz}">${n}</option>`).join('')}</select></div><div class="wc-grid">${html}</div>`;
    main.querySelector('.wc-add').addEventListener('change', (e) => {
      if (e.target.value && !state.cities.includes(e.target.value)) { state.cities.push(e.target.value); save(); main.innerHTML = ''; renderWorld(); }
    });
    bindWorld();
  }
  function bindWorld() {
    main.querySelectorAll('.wc-card').forEach((c, i) => {
      if (i === 0) return;
      c.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [{ label: 'Delete', icon: I.trash, action: () => { state.cities = state.cities.filter(x => x !== c.dataset.tz); save(); main.innerHTML = ''; renderWorld(); } }]);
      });
    });
  }

  const onChange = () => { if (tab === 'alarm' && !main.querySelector('.alarm-edit')) renderAlarms(); if (tab === 'timer') updateTimers(); };
  listeners.add(onChange);
  win.onclose(() => { clearInterval(tick); listeners.delete(onChange); });
  win.onRelaunch = (a) => { if (a && a.tab) setTab(a.tab); };
  setTab(tab);
  return win;
}
