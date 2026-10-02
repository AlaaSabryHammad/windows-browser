/* Weather — real forecasts from Open-Meteo (no API key), your location or any city, °C/°F, hourly & 7-day. */
import { createWindow } from '../wm.js';
import { I } from '../icons.js';
import { esc } from '../ui.js';
import { settings } from '../settings.js';

const KEY = 'webwin-weather-v1';
const PREF = 'webwin-weather-prefs';

const CODES = {
  0: ['Clear', '☀️', '🌙'], 1: ['Mostly clear', '🌤️', '🌙'], 2: ['Partly cloudy', '⛅', '☁️'], 3: ['Cloudy', '☁️', '☁️'],
  45: ['Fog', '🌫️', '🌫️'], 48: ['Freezing fog', '🌫️', '🌫️'], 51: ['Light drizzle', '🌦️', '🌧️'], 53: ['Drizzle', '🌦️', '🌧️'], 55: ['Heavy drizzle', '🌧️', '🌧️'],
  56: ['Freezing drizzle', '🌧️', '🌧️'], 57: ['Freezing drizzle', '🌧️', '🌧️'], 61: ['Light rain', '🌦️', '🌧️'], 63: ['Rain', '🌧️', '🌧️'], 65: ['Heavy rain', '🌧️', '🌧️'],
  66: ['Freezing rain', '🌧️', '🌧️'], 67: ['Freezing rain', '🌧️', '🌧️'], 71: ['Light snow', '🌨️', '🌨️'], 73: ['Snow', '🌨️', '🌨️'], 75: ['Heavy snow', '❄️', '❄️'],
  77: ['Snow grains', '🌨️', '🌨️'], 80: ['Showers', '🌦️', '🌧️'], 81: ['Showers', '🌧️', '🌧️'], 82: ['Violent showers', '⛈️', '⛈️'], 85: ['Snow showers', '🌨️', '🌨️'],
  86: ['Snow showers', '🌨️', '🌨️'], 95: ['Thunderstorm', '⛈️', '⛈️'], 96: ['Thunderstorm, hail', '⛈️', '⛈️'], 99: ['Thunderstorm, hail', '⛈️', '⛈️'],
};
const desc = (c) => (CODES[c] || ['Unknown'])[0];
const emoji = (c, day = true) => (CODES[c] || ['', '🌡️', '🌡️'])[day ? 1 : 2];

function prefs() { try { return { unit: 'C', place: null, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { unit: 'C', place: null }; } }
function savePrefs(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* ignore */ } }

export function open() {
  const P = prefs();
  const win = createWindow({ title: 'Weather', icon: I.weather, appId: 'weather', w: 860, h: 600, minW: 480, minH: 380 });
  win.body.innerHTML = `
    <div class="wx">
      <div class="wx-top">
        <div class="wx-search">${I.search}<input placeholder="Search for a city" spellcheck="false"><div class="wx-sugg hidden"></div></div>
        <button class="btn wx-loc" title="Use my location">📍 My location</button>
        <button class="btn wx-unit">°${P.unit === 'C' ? 'F' : 'C'}</button>
        <button class="toolbar-btn wx-refresh" title="Refresh">${I.refresh}</button>
      </div>
      <div class="wx-body"><div class="wx-loading">Loading forecast…</div></div>
    </div>`;
  const body = win.body.querySelector('.wx-body');
  const input = win.body.querySelector('.wx-search input');
  const sugg = win.body.querySelector('.wx-sugg');
  let data = null;

  const T = (c) => Math.round(P.unit === 'F' ? c * 9 / 5 + 32 : c);

  async function geocode(name) {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=en&format=json`);
    const j = await r.json();
    return (j.results || []).map(x => ({ name: x.name, region: [x.admin1, x.country].filter(Boolean).join(', '), lat: x.latitude, lon: x.longitude }));
  }

  async function load(place) {
    if (settings.airplane || !navigator.onLine) {
      body.innerHTML = `<div class="wx-msg">${I.offline}<h2>You're offline</h2><p>Connect to the Internet to get the latest forecast.</p></div>`;
      return;
    }
    body.innerHTML = `<div class="wx-loading">Loading forecast for ${esc(place.name)}…</div>`;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,pressure_msl&hourly=temperature_2m,weather_code,precipitation_probability,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max&timezone=auto&forecast_days=7`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      data = await r.json();
      P.place = place; savePrefs(P);
      render(place);
      try {
        localStorage.setItem(KEY, JSON.stringify({ temp: T(data.current.temperature_2m), desc: desc(data.current.weather_code), city: place.name, code: data.current.weather_code, updated: Date.now() }));
      } catch { /* ignore */ }
    } catch (e) {
      body.innerHTML = `<div class="wx-msg">${I.warning}<h2>Couldn't load the forecast</h2><p>${esc(e.message || 'Network error')}</p><button class="btn primary wx-retry">Try again</button></div>`;
      body.querySelector('.wx-retry').addEventListener('click', () => load(place));
    }
  }

  function render(place) {
    const c = data.current, d = data.daily, h = data.hourly;
    const day = !!c.is_day;
    win.body.querySelector('.wx').className = `wx ${day ? 'day' : 'night'} wx-c${c.weather_code >= 51 ? 'rain' : c.weather_code >= 2 ? 'cloud' : 'clear'}`;
    const nowIdx = Math.max(0, h.time.findIndex(t => new Date(t) >= new Date(Date.now() - 3600000)));
    const hours = h.time.slice(nowIdx, nowIdx + 24).map((t, i) => {
      const k = nowIdx + i;
      return `<div class="wx-h"><div>${i === 0 ? 'Now' : new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', hour12: !settings.clock24 })}</div><div class="wx-he">${emoji(h.weather_code[k], h.is_day[k])}</div><b>${T(h.temperature_2m[k])}°</b><small>💧${h.precipitation_probability[k] ?? 0}%</small></div>`;
    }).join('');
    const days = d.time.map((t, i) => `
      <div class="wx-d ${i === 0 ? 'sel' : ''}"><div>${i === 0 ? 'Today' : new Date(t + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}</div>
      <div class="wx-de">${emoji(d.weather_code[i])}</div><div><b>${T(d.temperature_2m_max[i])}°</b> <span>${T(d.temperature_2m_min[i])}°</span></div><small>${desc(d.weather_code[i])}</small></div>`).join('');
    body.innerHTML = `
      <div class="wx-now">
        <div class="wx-place">${esc(place.name)}<small>${esc(place.region || '')}</small></div>
        <div class="wx-main"><span class="wx-big-e">${emoji(c.weather_code, day)}</span><span class="wx-temp">${T(c.temperature_2m)}</span><span class="wx-unitl">°${P.unit}</span>
          <div class="wx-desc"><b>${desc(c.weather_code)}</b><div>Updated as of ${new Date(c.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: !settings.clock24 })}</div>
          <div>Feels like ${T(c.apparent_temperature)}° · Wind ${Math.round(c.wind_speed_10m)} km/h · Humidity ${c.relative_humidity_2m}%</div>
          <div>Pressure ${Math.round(c.pressure_msl)} mb · UV index ${Math.round(d.uv_index_max[0] ?? 0)} · Sunrise ${new Date(d.sunrise[0]).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · Sunset ${new Date(d.sunset[0]).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div></div>
        </div>
      </div>
      <h3>Daily</h3><div class="wx-days">${days}</div>
      <h3>Hourly</h3><div class="wx-hours">${hours}</div>
      <div class="wx-credit">Weather data by Open-Meteo.com</div>`;
    win.setTitle(`Weather - ${place.name}`);
  }

  function locate() {
    if (!navigator.geolocation) { load({ name: 'Cairo', region: 'Egypt', lat: 30.0444, lon: 31.2357 }); return; }
    body.innerHTML = '<div class="wx-loading">Finding your location…</div>';
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      let name = 'My location';
      try {
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
        const j = await r.json();
        name = j.city || j.locality || name;
        load({ name, region: j.countryName || '', lat, lon });
      } catch { load({ name, region: '', lat, lon }); }
    }, () => load(P.place || { name: 'Cairo', region: 'Egypt', lat: 30.0444, lon: 31.2357 }), { timeout: 8000, maximumAge: 600000 });
  }

  let st = null;
  input.addEventListener('input', () => {
    clearTimeout(st);
    const q = input.value.trim();
    if (q.length < 2) { sugg.classList.add('hidden'); return; }
    st = setTimeout(async () => {
      try {
        const res = await geocode(q);
        sugg.innerHTML = res.length ? res.map((r, i) => `<div class="wx-s" data-i="${i}"><b>${esc(r.name)}</b> <span>${esc(r.region)}</span></div>`).join('') : '<div class="wx-s none">No results</div>';
        sugg.classList.remove('hidden');
        sugg.querySelectorAll('.wx-s[data-i]').forEach(el => el.addEventListener('click', () => { sugg.classList.add('hidden'); input.value = ''; load(res[+el.dataset.i]); }));
      } catch { /* offline */ }
    }, 300);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sugg.querySelector('.wx-s[data-i]')?.click(); if (e.key === 'Escape') sugg.classList.add('hidden'); });
  win.body.querySelector('.wx-loc').addEventListener('click', locate);
  win.body.querySelector('.wx-refresh').addEventListener('click', () => P.place ? load(P.place) : locate());
  win.body.querySelector('.wx-unit').addEventListener('click', (e) => {
    P.unit = P.unit === 'C' ? 'F' : 'C'; savePrefs(P);
    e.currentTarget.textContent = `°${P.unit === 'C' ? 'F' : 'C'}`;
    if (data && P.place) render(P.place);
  });

  if (P.place) load(P.place); else locate();
  const t = setInterval(() => { if (P.place && !win.minimized) load(P.place); }, 15 * 60000);
  win.onclose(() => clearInterval(t));
  return win;
}
