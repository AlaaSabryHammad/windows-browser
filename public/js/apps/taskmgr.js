/* Task Manager — processes, live performance graphs from real browser metrics, startup apps, details. */
import { createWindow, windowList, getFocused } from '../wm.js';
import { I } from '../icons.js';
import { contextMenu, esc } from '../ui.js';
import { settings, updateSettings } from '../settings.js';
import { ioStats, diskInfo, formatSize } from '../fs.js';
import { APPS } from './registry.js';
import { EXE, pidOf } from './terminal.js';

const SYS_PROCS = [
  { name: 'Antimalware Service Executable', exe: 'MsMpEng.exe', base: 0.6, mem: 92 },
  { name: 'Desktop Window Manager', exe: 'dwm.exe', base: 1.4, mem: 54 },
  { name: 'Windows Explorer', exe: 'explorer.exe', base: 0.4, mem: 61 },
  { name: 'Service Host: Local System', exe: 'svchost.exe', base: 0.2, mem: 23 },
  { name: 'Service Host: Network Service', exe: 'svchost.exe', base: 0.1, mem: 9 },
  { name: 'Runtime Broker', exe: 'RuntimeBroker.exe', base: 0.05, mem: 7 },
  { name: 'Windows Audio Device Graph Isolation', exe: 'audiodg.exe', base: 0.1, mem: 6 },
  { name: 'Client Server Runtime Process', exe: 'csrss.exe', base: 0.1, mem: 4 },
  { name: 'System', exe: 'System', base: 0.3, mem: 0.1 },
];

/* ---------- real metric sampling (runs while a Task Manager is open) ---------- */
const metrics = { cpu: Array(60).fill(0), mem: Array(60).fill(0), disk: Array(60).fill(0), net: Array(60).fill(0), last: {} };
let sampler = null, users = 0;
function startSampling() {
  users++;
  if (sampler) return;
  let drift = 0, longTask = 0, lastTick = performance.now(), lastSec = performance.now();
  let lastBytes = ioStats.bytesWritten;
  let lastRes = performance.getEntriesByType('resource').length;
  let obs = null;
  try {
    obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) longTask += e.duration; });
    obs.observe({ type: 'longtask', buffered: false });
  } catch { obs = null; }
  const fast = setInterval(() => {
    const now = performance.now();
    drift += Math.max(0, now - lastTick - 100);
    lastTick = now;
    if (now - lastSec < 1000) return;
    const elapsed = now - lastSec;
    lastSec = now;
    const busy = Math.min(elapsed, drift + longTask);
    drift = 0; longTask = 0;
    const cpu = Math.min(100, busy / elapsed * 100 + 1 + Math.random() * 2 + windowList().length * 0.4);
    let memPct = 0, memUsed = 0, memLimit = 0;
    if (performance.memory) {
      memUsed = performance.memory.usedJSHeapSize; memLimit = performance.memory.jsHeapSizeLimit;
      memPct = memUsed / memLimit * 100;
    } else {
      memUsed = document.getElementsByTagName('*').length * 2048;
      memLimit = (navigator.deviceMemory || 4) * 1024 ** 3;
      memPct = memUsed / memLimit * 100;
    }
    const bytes = ioStats.bytesWritten - lastBytes; lastBytes = ioStats.bytesWritten;
    const res = performance.getEntriesByType('resource');
    const netBytes = res.slice(lastRes).reduce((a, r) => a + (r.transferSize || 0), 0);
    lastRes = res.length;
    if (res.length > 1000) { performance.clearResourceTimings(); lastRes = 0; }
    metrics.last = { cpu, memUsed, memLimit, memPct, diskBps: bytes / elapsed * 1000, netBps: netBytes / elapsed * 1000 };
    const push = (arr, v) => { arr.push(v); arr.shift(); };
    push(metrics.cpu, cpu);
    push(metrics.mem, memPct);
    push(metrics.disk, Math.min(100, bytes / 1024 / 2));          /* "active time": ~200 KB/s = 100% */
    push(metrics.net, Math.min(100, netBytes / 1024 / 10));       /* 1 MB/s = 100% */
  }, 100);
  sampler = { stop: () => { clearInterval(fast); if (obs) obs.disconnect(); } };
}
function stopSampling() {
  users--;
  if (users <= 0 && sampler) { sampler.stop(); sampler = null; users = 0; }
}

const fmtRate = (bps) => bps < 1024 ? `${Math.round(bps * 8)} bps` : bps < 1024 * 1024 ? `${(bps * 8 / 1024).toFixed(0)} Kbps` : `${(bps * 8 / 1024 / 1024).toFixed(1)} Mbps`;

export function open() {
  const win = createWindow({ title: 'Task Manager', icon: I.taskmgr, appId: 'taskmgr', w: 760, h: 560, minW: 520, minH: 380 });
  win.body.innerHTML = `
    <div class="tm">
      <div class="np-menu">
        <div class="np-m" data-m="file">File</div><div class="np-m" data-m="options">Options</div><div class="np-m" data-m="view">View</div>
      </div>
      <div class="tm-tabs">
        <div class="tm-tab sel" data-t="proc">Processes</div>
        <div class="tm-tab" data-t="perf">Performance</div>
        <div class="tm-tab" data-t="startup">Startup</div>
        <div class="tm-tab" data-t="details">Details</div>
      </div>
      <div class="tm-body"></div>
      <div class="tm-status">
        <span class="tm-summary"></span>
        <button class="btn endbtn" disabled>End task</button>
      </div>
    </div>`;

  const root = win.body.querySelector('.tm');
  const body = root.querySelector('.tm-body');
  const summary = root.querySelector('.tm-summary');
  const endBtn = root.querySelector('.endbtn');
  let tab = 'proc';
  let selected = null;
  let perfMode = 'cpu';
  let sort = { key: null, dir: -1 };
  let paused = false;
  let speed = 1000;
  let disk = { used: 0, quota: 1 };
  diskInfo().then(d => { disk = d; });

  startSampling();
  const jitter = (v, amp) => Math.max(0, v + (Math.random() - 0.5) * amp);
  const totalCpu = () => metrics.cpu[metrics.cpu.length - 1];

  root.querySelectorAll('.tm-tab').forEach(t => t.addEventListener('click', () => {
    tab = t.dataset.t;
    root.querySelectorAll('.tm-tab').forEach(x => x.classList.toggle('sel', x === t));
    selected = null;
    renderBody();
  }));

  root.querySelectorAll('.np-m').forEach(m => m.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = m.getBoundingClientRect();
    const menus = {
      file: [{ label: 'Run new task', action: () => import('./registry.js').then(x => x.launch('run')) }, '-', { label: 'Exit', action: () => win.close() }],
      options: [{ label: 'Always on top', disabled: true }, { label: 'Minimize on use', disabled: true }],
      view: [
        { label: 'Refresh now', hint: 'F5', action: () => renderBody() },
        { label: 'Update speed', submenu: [['High', 500], ['Normal', 1000], ['Low', 4000]].map(([l, ms]) => ({ label: l, checked: speed === ms && !paused, action: () => { paused = false; speed = ms; restartTimer(); } }))
          .concat([{ label: 'Paused', checked: paused, action: () => { paused = true; } }]) },
      ],
    };
    contextMenu(r.left, r.bottom + 2, menus[m.dataset.m]);
  }));

  function procRows() {
    const wins = windowList();
    const cpuTotal = totalCpu();
    const weights = wins.map(w => w.el.getElementsByTagName('*').length + (w === getFocused() ? 300 : 0));
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    const apps = wins.map((w, i) => {
      const media = [...w.el.querySelectorAll('canvas, video')].reduce((a, c) => a + (c.width || c.videoWidth || 0) * (c.height || c.videoHeight || 0) * 4, 0);
      return {
        kind: 'app', id: w.id, win: w, name: w.title, icon: w.opts.icon, pid: pidOf(w), exe: EXE[w.opts.appId] || 'app.exe',
        cpu: Math.max(0, jitter(cpuTotal * 0.6 * weights[i] / wsum, 0.6)),
        mem: 12 + weights[i] * 0.045 + media / 1048576,
        disk: 0, net: w.opts.appId === 'edge' ? jitter(0.05, 0.1) : 0,
        status: w.minimized ? 'Suspended' : '',
      };
    });
    const sys = SYS_PROCS.map((p, i) => ({
      kind: 'sys', id: 'sys' + i, name: p.name, exe: p.exe, pid: 400 + i * 52,
      cpu: jitter(p.base * (cpuTotal / 10 + 0.2), 0.3), mem: jitter(p.mem, 1.5), disk: i === 0 ? (metrics.last.diskBps || 0) / 1048576 : 0, net: 0, status: '',
    }));
    return { apps, sys };
  }

  function renderProcs() {
    const { apps, sys } = procRows();
    const cpu = totalCpu();
    const sortFn = sort.key ? (a, b) => (typeof a[sort.key] === 'number' ? (a[sort.key] - b[sort.key]) : String(a[sort.key]).localeCompare(String(b[sort.key]))) * sort.dir : null;
    if (sortFn) { apps.sort(sortFn); sys.sort(sortFn); }
    const col = (k, l, num) => `<th class="${num ? 'num' : ''} ${sort.key === k ? 'sorted' : ''}" data-k="${k}">${l}</th>`;
    const row = (p) => `
      <tr data-id="${p.id}" data-kind="${p.kind}" class="${selected === p.id ? 'sel' : ''}">
        <td><span class="tm-name"><span class="tm-ic">${p.icon || I.taskmgr}</span>${esc(p.name)}</span></td>
        <td class="st">${p.status}</td>
        <td class="num heat" style="--h:${Math.min(1, p.cpu / 20)}">${p.cpu.toFixed(1)}%</td>
        <td class="num heat" style="--h:${Math.min(1, p.mem / 400)}">${p.mem.toFixed(1)} MB</td>
        <td class="num">${p.disk.toFixed(1)} MB/s</td>
        <td class="num">${p.net.toFixed(1)} Mbps</td>
      </tr>`;
    body.innerHTML = `
      <table class="tm-table">
        <thead><tr>${col('name', 'Name')}${col('status', 'Status')}${col('cpu', `${Math.round(cpu)}%<br><small>CPU</small>`, 1)}${col('mem', `${formatSize(metrics.last.memUsed || 0)}<br><small>Memory</small>`, 1)}${col('disk', '0%<br><small>Disk</small>', 1)}${col('net', '0%<br><small>Network</small>', 1)}</tr></thead>
        <tbody>
          <tr class="grp"><td colspan="6">Apps (${apps.length})</td></tr>
          ${apps.map(row).join('')}
          <tr class="grp"><td colspan="6">Background processes (${sys.length})</td></tr>
          ${sys.map(row).join('')}
        </tbody>
      </table>`;
    bindTable(apps);
    summary.textContent = `Processes: ${apps.length + sys.length + 38}   CPU: ${Math.round(cpu)}%   Memory in use: ${formatSize(metrics.last.memUsed || 0)}`;
  }

  function bindTable(apps) {
    body.querySelectorAll('th[data-k]').forEach(th => th.addEventListener('click', () => {
      sort = { key: th.dataset.k, dir: sort.key === th.dataset.k ? -sort.dir : -1 };
      renderBody();
    }));
    body.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => {
        selected = tr.dataset.id;
        body.querySelectorAll('tr.sel').forEach(x => x.classList.remove('sel'));
        tr.classList.add('sel');
        endBtn.disabled = tr.dataset.kind === 'sys';
      });
      tr.addEventListener('dblclick', () => { const w = apps.find(a => a.id === tr.dataset.id); if (w) w.win.focus(); });
      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        tr.click();
        const a = apps.find(x => x.id === tr.dataset.id);
        contextMenu(e.clientX, e.clientY, [
          { label: 'Switch to', disabled: !a, action: () => a.win.focus() },
          { label: 'End task', disabled: !a, action: () => a.win.close() },
          '-',
          { label: 'Go to details', action: () => { root.querySelector('.tm-tab[data-t="details"]').click(); } },
          { label: 'Search online', action: () => import('./registry.js').then(x => x.launch('edge', { url: 'https://www.bing.com/search?q=' + encodeURIComponent((a ? a.exe : tr.querySelector('.tm-name').textContent)) })) },
        ]);
      });
    });
  }

  function renderDetails() {
    const { apps, sys } = procRows();
    const all = [...sys, ...apps];
    body.innerHTML = `
      <table class="tm-table">
        <thead><tr><th>Name</th><th class="num">PID</th><th>Status</th><th>User name</th><th class="num">CPU</th><th class="num">Memory</th><th>Description</th></tr></thead>
        <tbody>${all.map(p => `<tr data-id="${p.id}" data-kind="${p.kind}" class="${selected === p.id ? 'sel' : ''}">
          <td><span class="tm-name"><span class="tm-ic">${p.icon || I.taskmgr}</span>${esc(p.exe)}</span></td><td class="num">${p.pid}</td><td>${p.status || 'Running'}</td>
          <td>${p.kind === 'app' ? esc(settings.userName) : 'SYSTEM'}</td><td class="num">${String(Math.round(p.cpu)).padStart(2, '0')}</td><td class="num">${Math.round(p.mem * 1024).toLocaleString()} K</td><td>${esc(p.name)}</td></tr>`).join('')}
        </tbody>
      </table>`;
    bindTable(apps);
  }

  function renderStartup() {
    const list = Object.values(APPS).filter(a => !a.hidden && a.id !== 'store');
    body.innerHTML = `
      <div class="tm-hint">Apps that are enabled here start automatically when you sign in.</div>
      <table class="tm-table">
        <thead><tr><th>Name</th><th>Publisher</th><th>Status</th><th>Startup impact</th></tr></thead>
        <tbody>${list.map(a => {
          const on = settings.startupApps.includes(a.id);
          return `<tr data-app="${a.id}" class="${selected === a.id ? 'sel' : ''}"><td><span class="tm-name"><span class="tm-ic">${a.icon}</span>${esc(a.name)}</span></td><td>Windows 10 Web</td><td>${on ? 'Enabled' : 'Disabled'}</td><td>${on ? (a.id === 'edge' || a.id === 'mediaplayer' ? 'Medium' : 'Low') : 'Not measured'}</td></tr>`;
        }).join('')}</tbody>
      </table>`;
    endBtn.textContent = 'Enable';
    endBtn.disabled = !selected;
    body.querySelectorAll('tr[data-app]').forEach(tr => {
      tr.addEventListener('click', () => {
        selected = tr.dataset.app;
        body.querySelectorAll('tr.sel').forEach(x => x.classList.remove('sel'));
        tr.classList.add('sel');
        endBtn.disabled = false;
        endBtn.textContent = settings.startupApps.includes(selected) ? 'Disable' : 'Enable';
      });
      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault(); tr.click();
        const on = settings.startupApps.includes(tr.dataset.app);
        contextMenu(e.clientX, e.clientY, [{ label: on ? 'Disable' : 'Enable', action: toggleStartup }]);
      });
    });
    summary.textContent = `Last BIOS time: ${(performance.timing ? (performance.timing.domInteractive - performance.timing.navigationStart) / 1000 : 1.2).toFixed(1)} seconds`;
  }
  function toggleStartup() {
    if (!selected) return;
    const on = settings.startupApps.includes(selected);
    updateSettings({ startupApps: on ? settings.startupApps.filter(x => x !== selected) : [...settings.startupApps, selected] });
    renderStartup();
  }

  function renderPerf() {
    body.innerHTML = `
      <div class="tm-perf">
        <div class="tm-perf-side">
          ${[['cpu', 'CPU'], ['mem', 'Memory'], ['disk', 'Disk 0 (C:)'], ['net', navigator.connection && navigator.connection.type === 'ethernet' ? 'Ethernet' : 'Wi-Fi']].map(([k, l]) =>
            `<div class="cpu-item ${perfMode === k ? 'sel' : ''}" data-p="${k}"><canvas width="60" height="40"></canvas><div><div>${l}</div><div class="ci-big v-${k}"></div></div></div>`).join('')}
        </div>
        <div class="tm-perf-main">
          <div class="perf-head"><h2 class="perf-title"></h2><span class="perf-sub"></span></div>
          <div class="perf-cap"><span class="cap-l"></span><span>100%</span></div>
          <div class="big-graph"><canvas class="perf-canvas"></canvas></div>
          <div class="perf-cap"><span>60 seconds</span><span>0</span></div>
          <div class="graph-stats"></div>
        </div>
      </div>`;
    body.querySelectorAll('.cpu-item').forEach(it => it.addEventListener('click', () => {
      body.querySelectorAll('.cpu-item').forEach(x => x.classList.remove('sel'));
      it.classList.add('sel');
      perfMode = it.dataset.p;
      updatePerf();
    }));
    updatePerf();
    summary.textContent = 'Live data from your browser: main-thread load, JS heap, virtual-disk writes and network traffic.';
  }

  const COLORS = { cpu: ['#117dbb', 'rgba(17,125,187,.12)'], mem: ['#8b12ae', 'rgba(139,18,174,.1)'], disk: ['#4da60c', 'rgba(77,166,12,.12)'], net: ['#a74f01', 'rgba(167,79,1,.1)'] };

  function drawGraph(canvas, data, [color, fill], grid = true) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth || 60;
    const h = canvas.height = canvas.clientHeight || 40;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = fill.replace(/[\d.]+\)$/, '0.03)');
    ctx.fillRect(0, 0, w, h);
    if (grid) {
      ctx.strokeStyle = fill.replace(/[\d.]+\)$/, '0.35)');
      ctx.lineWidth = 1;
      for (let i = 1; i < 10; i++) { ctx.beginPath(); ctx.moveTo(0, Math.round(h * i / 10) + .5); ctx.lineTo(w, Math.round(h * i / 10) + .5); ctx.stroke(); }
      for (let i = 1; i < 20; i++) { ctx.beginPath(); ctx.moveTo(Math.round(w * i / 20) + .5, 0); ctx.lineTo(Math.round(w * i / 20) + .5, h); ctx.stroke(); }
    }
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - (Math.min(100, v) / 100) * (h - 1);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(.5, .5, w - 1, h - 1);
  }

  function uptime() {
    const s = Math.floor(performance.now() / 1000);
    return `${Math.floor(s / 86400)}:${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function updatePerf() {
    const big = body.querySelector('.perf-canvas');
    if (!big) return;
    const L = metrics.last;
    const vals = {
      cpu: `${Math.round(metrics.cpu[59])}%`,
      mem: L.memUsed ? `${formatSize(L.memUsed)} (${Math.round(L.memPct)}%)` : '…',
      disk: `${Math.round(metrics.disk[59])}%`,
      net: `S: 0 R: ${fmtRate(L.netBps || 0)}`,
    };
    for (const k of ['cpu', 'mem', 'disk', 'net']) {
      const el = body.querySelector('.v-' + k); if (el) el.textContent = vals[k];
      const c = body.querySelector(`.cpu-item[data-p="${k}"] canvas`); if (c) drawGraph(c, metrics[k].slice(-30), COLORS[k], false);
    }
    drawGraph(big, metrics[perfMode], COLORS[perfMode]);
    const title = body.querySelector('.perf-title'), sub = body.querySelector('.perf-sub'), cap = body.querySelector('.cap-l'), stats = body.querySelector('.graph-stats');
    const conn = navigator.connection;
    if (perfMode === 'cpu') {
      title.textContent = 'CPU'; sub.textContent = `JavaScript engine · ${navigator.hardwareConcurrency || '?'} logical processors`; cap.textContent = '% Utilization';
      stats.innerHTML = `<div><small>Utilization</small><b>${Math.round(metrics.cpu[59])}%</b></div><div><small>Processes</small><b>${windowList().length + SYS_PROCS.length + 38}</b></div><div><small>Threads</small><b>${(navigator.hardwareConcurrency || 4) * 312}</b></div><div><small>Up time</small><b>${uptime()}</b></div><div><small>Logical processors</small><b>${navigator.hardwareConcurrency || '?'}</b></div>`;
    } else if (perfMode === 'mem') {
      title.textContent = 'Memory'; sub.textContent = navigator.deviceMemory ? `${navigator.deviceMemory} GB installed (reported by the browser)` : 'JS heap'; cap.textContent = 'Memory usage';
      stats.innerHTML = `<div><small>In use</small><b>${formatSize(L.memUsed || 0)}</b></div><div><small>Available to this tab</small><b>${formatSize(Math.max(0, (L.memLimit || 0) - (L.memUsed || 0)))}</b></div><div><small>DOM nodes</small><b>${document.getElementsByTagName('*').length.toLocaleString()}</b></div>`;
    } else if (perfMode === 'disk') {
      title.textContent = 'Disk 0 (C:)'; sub.textContent = 'IndexedDB virtual disk'; cap.textContent = 'Active time';
      stats.innerHTML = `<div><small>Write speed</small><b>${formatSize(Math.round(L.diskBps || 0))}/s</b></div><div><small>Capacity</small><b>${formatSize(disk.quota)}</b></div><div><small>Used by files</small><b>${formatSize(disk.used)}</b></div><div><small>Writes this session</small><b>${ioStats.writes}</b></div>`;
    } else {
      title.textContent = conn && conn.type === 'ethernet' ? 'Ethernet' : 'Wi-Fi'; sub.textContent = navigator.onLine && !settings.airplane ? 'Connected' : 'Not connected'; cap.textContent = 'Throughput';
      stats.innerHTML = `<div><small>Receive</small><b>${fmtRate(L.netBps || 0)}</b></div><div><small>Estimated bandwidth</small><b>${conn && conn.downlink ? conn.downlink + ' Mbps' : '—'}</b></div><div><small>Latency</small><b>${conn && conn.rtt != null ? conn.rtt + ' ms' : '—'}</b></div><div><small>Connection type</small><b>${conn && conn.effectiveType ? conn.effectiveType.toUpperCase() : '—'}</b></div>`;
    }
  }

  function renderBody() {
    endBtn.textContent = 'End task';
    endBtn.disabled = !selected;
    if (tab === 'proc') renderProcs();
    else if (tab === 'perf') renderPerf();
    else if (tab === 'startup') renderStartup();
    else renderDetails();
  }

  endBtn.addEventListener('click', () => {
    if (tab === 'startup') { toggleStartup(); return; }
    if (!selected) return;
    const w = windowList().find(x => x.id === selected);
    if (w) { w.close(); selected = null; endBtn.disabled = true; setTimeout(renderBody, 150); }
  });

  let timer = null;
  function restartTimer() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (paused || win.minimized) return;
      if (tab === 'proc') renderProcs();
      else if (tab === 'perf') updatePerf();
      else if (tab === 'details') renderDetails();
    }, speed);
  }
  restartTimer();
  renderBody();
  win.el.addEventListener('keydown', (e) => { if (e.key === 'F5') { e.preventDefault(); renderBody(); } if (e.key === 'Delete' && selected && tab !== 'startup') endBtn.click(); });
  win.onclose(() => { clearInterval(timer); stopSampling(); });
  return win;
}
