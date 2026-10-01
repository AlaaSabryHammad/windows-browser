/* Task Manager — processes + live performance graphs */
import { createWindow, windowList, on as onWm } from '../wm.js';
import { I } from '../icons.js';

const SYS_PROCS = [
  { name: 'System', user: 0, base: 0.6 },
  { name: 'System Idle Process', user: 0, base: 0.1 },
  { name: 'Windows Explorer', user: 0.2, base: 1.4 },
  { name: 'Desktop Window Manager', user: 1.1, base: 2.2 },
  { name: 'Service Host: Local System', user: 0, base: 0.5 },
  { name: 'Antimalware Service Executable', user: 0, base: 1.8 },
  { name: 'Runtime Broker', user: 0, base: 0.3 },
];

export function open() {
  const win = createWindow({ title: 'Task Manager', icon: I.taskmgr, appId: 'taskmgr', w: 700, h: 520, minW: 520, minH: 380 });
  win.body.innerHTML = `
    <div class="tm">
      <div class="tm-tabs">
        <div class="tm-tab sel" data-t="proc">Processes</div>
        <div class="tm-tab" data-t="perf">Performance</div>
      </div>
      <div class="tm-body"></div>
      <div class="tm-status">
        <span class="tm-procs">Processes: 0</span>
        <span class="tm-cpu">CPU: 0%</span>
        <span class="tm-mem">Memory: 0%</span>
        <button class="btn endbtn" disabled>End task</button>
      </div>
    </div>`;

  const root = win.body.querySelector('.tm');
  const body = root.querySelector('.tm-body');
  const procsEl = root.querySelector('.tm-procs'), cpuEl = root.querySelector('.tm-cpu'), memEl = root.querySelector('.tm-mem');
  const endBtn = root.querySelector('.endbtn');
  let tab = 'proc';
  let selected = null; /* winId or sys index marker */
  let timer = null;
  const cpuHist = Array(60).fill(5);
  const memHist = Array(60).fill(38);

  const jitter = (v, amp) => Math.max(0, v + (Math.random() - 0.5) * amp);

  function sysLoad() { return windowList().length * 3.5; }

  function renderTabs() {
    root.querySelectorAll('.tm-tab').forEach(t => t.addEventListener('click', () => {
      tab = t.dataset.t;
      root.querySelectorAll('.tm-tab').forEach(x => x.classList.toggle('sel', x === t));
      renderBody();
    }));
  }

  function renderBody() {
    if (tab === 'proc') renderProcs();
    else renderPerf();
  }

  function renderProcs() {
    const apps = windowList().map(w => ({
      kind: 'app',
      id: w.id,
      name: w.opts.title || w.opts.appId,
      icon: w.opts.icon,
      cpu: jitter(0.4 + sysLoad() / windowList().length / 4, 1.6),
      mem: 40 + (w.el.offsetWidth * w.el.offsetHeight) / 20000,
    }));
    const sys = SYS_PROCS.map((p, i) => ({
      kind: 'sys',
      id: 'sys' + i,
      name: p.name,
      cpu: jitter(p.base, 1.2),
      mem: 8 + p.base * 26 + i * 5,
    }));
    const all = [...apps, ...sys];

    body.innerHTML = `
      <table class="tm-table">
        <thead><tr><th style="width:46%">Name</th><th class="num">Status</th><th class="num">CPU</th><th class="num">Memory</th></tr></thead>
        <tbody>${all.map(p => `
          <tr data-id="${p.id}" data-kind="${p.kind}" class="${selected === p.id ? 'sel' : ''}">
            <td style="display:flex;align-items:center;gap:9px"><span style="width:16px;height:16px;display:inline-block">${p.icon || I.taskmgr.replace('<svg', '<svg width="16" height="16"')}</span>${p.name}</td>
            <td class="num">${p.kind === 'app' ? 'Running' : 'Running'}</td>
            <td class="num">${p.cpu.toFixed(1)}%</td>
            <td class="num">${p.mem.toFixed(1)} MB</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

    body.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => {
      selected = tr.dataset.id;
      body.querySelectorAll('tr.sel').forEach(x => x.classList.remove('sel'));
      tr.classList.add('sel');
      endBtn.disabled = tr.dataset.kind === 'sys';
    }));

    procsEl.textContent = `Processes: ${all.length + 42}`;
    cpuEl.textContent = `CPU: ${Math.min(99, 6 + sysLoad()).toFixed(0)}%`;
    memEl.textContent = `Memory: ${Math.min(95, 38 + sysLoad()).toFixed(0)}%`;
  }

  function renderPerf() {
    body.innerHTML = `
      <div class="tm-perf">
        <div class="tm-perf-side">
          <div class="cpu-item sel" data-p="cpu"><canvas width="44" height="30"></canvas><div><div>CPU</div><div class="ci-big v-cpu"></div></div></div>
          <div class="cpu-item" data-p="mem"><canvas width="44" height="30"></canvas><div><div>Memory</div><div class="ci-big v-mem"></div></div></div>
        </div>
        <div class="tm-perf-main">
          <h2 class="perf-title">CPU</h2>
          <div class="big-graph"><canvas class="perf-canvas"></canvas></div>
          <div class="graph-stats">
            <span class="s-util"></span><span class="s-speed">Speed: ∞ GHz</span><span class="s-procs">Processes: 0</span><span>Up time: <span class="s-uptime"></span></span>
          </div>
        </div>
      </div>`;
    const side = body.querySelector('.tm-perf-side');
    side.querySelectorAll('.cpu-item').forEach(it => it.addEventListener('click', () => {
      side.querySelectorAll('.cpu-item').forEach(x => x.classList.remove('sel'));
      it.classList.add('sel');
      perfMode = it.dataset.p;
      updatePerf(true);
    }));
  }

  let perfMode = 'cpu';

  function drawGraph(canvas, data, color, fill) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = canvas.height = canvas.clientHeight || canvas.parentElement.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(128,128,128,.25)';
    for (let i = 1; i < 6; i++) {
      ctx.beginPath(); ctx.moveTo(0, h * i / 6); ctx.lineTo(w, h * i / 6); ctx.stroke();
    }
    for (let i = 1; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(w * i / 8, 0); ctx.lineTo(w * i / 8, h); ctx.stroke();
    }
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - (v / 100) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  }

  function mini(canvas, data, color, fill) { drawGraph(canvas, data, color, fill); }

  function updatePerf(force = false) {
    cpuHist.push(Math.min(99, 6 + sysLoad() + (Math.random() * 8))); cpuHist.shift();
    memHist.push(Math.min(95, 38 + sysLoad() + (Math.random() * 3))); memHist.shift();

    if (tab !== 'perf') return;
    const bigCanvas = body.querySelector('.perf-canvas');
    if (!bigCanvas) return;
    const data = perfMode === 'cpu' ? cpuHist : memHist;
    const color = perfMode === 'cpu' ? '#0078d7' : '#8764b8';
    drawGraph(bigCanvas, data, color, perfMode === 'cpu' ? 'rgba(0,120,215,.15)' : 'rgba(135,100,184,.15)');
    body.querySelector('.perf-title').textContent = perfMode === 'cpu' ? 'CPU — JavaScript Engine V8' : 'Memory — 16.0 GB';
    const vc = body.querySelector('.v-cpu'), vm = body.querySelector('.v-mem');
    if (vc) vc.textContent = cpuHist[cpuHist.length - 1].toFixed(0) + '%';
    if (vm) vm.textContent = memHist[memHist.length - 1].toFixed(0) + '%';
    const su = body.querySelector('.s-util');
    if (su) su.textContent = `Utilization: ${data[data.length - 1].toFixed(0)}%`;
    const sp = body.querySelector('.s-procs');
    if (sp) sp.textContent = `Processes: ${windowList().length + 49}`;
    const up = body.querySelector('.s-uptime');
    if (up) up.textContent = formatUptime();
    const cA = body.querySelectorAll('.cpu-item canvas')[0];
    const cB = body.querySelectorAll('.cpu-item canvas')[1];
    if (cA) mini(cA, cpuHist.slice(-30), '#0078d7', 'rgba(0,120,215,.2)');
    if (cB) mini(cB, memHist.slice(-30), '#8764b8', 'rgba(135,100,184,.2)');
  }

  const bootTime = Date.now();
  function formatUptime() {
    const s = Math.floor((Date.now() - bootTime) / 1000);
    return `0:0${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  endBtn.addEventListener('click', () => {
    if (!selected) return;
    const w = windowList().find(x => x.id === selected);
    if (w) { w.close(); selected = null; endBtn.disabled = true; renderProcs(); }
  });

  renderTabs();
  renderBody();
  timer = setInterval(() => {
    if (tab === 'proc') renderProcs();
    else updatePerf();
  }, 1400);
  updatePerf();
  win.onclose(() => clearInterval(timer));

  return win;
}
