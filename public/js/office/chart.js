/* Canvas charts for Excel: column, bar, line, pie. */
export const CHART_COLORS = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#264478', '#9E480E', '#636363', '#997300'];

/* rows: 2D array of values (numbers/strings/null) → { categories, series:[{name, values}] } */
export function chartData(rows) {
  if (!rows.length) return { categories: [], series: [] };
  const isNum = (v) => typeof v === 'number';
  const firstRowHeader = rows[0].some(v => typeof v === 'string' && v !== '') && rows.slice(1).some(r => r.some(isNum));
  const body = firstRowHeader ? rows.slice(1) : rows;
  const firstColCats = body.length && body.every(r => !isNum(r[0])) && (rows[0].length > 1);
  const startCol = firstColCats ? 1 : 0;
  const categories = body.map((r, i) => (firstColCats ? String(r[0] ?? '') : String(i + 1)));
  const series = [];
  const width = Math.max(...rows.map(r => r.length));
  for (let c = startCol; c < width; c++) {
    const values = body.map(r => (isNum(r[c]) ? r[c] : 0));
    if (!body.some(r => isNum(r[c]))) continue;
    series.push({ name: firstRowHeader ? String(rows[0][c] ?? `Series${series.length + 1}`) : `Series${series.length + 1}`, values });
  }
  return { categories, series };
}

function niceScale(min, max, ticks = 5) {
  if (min === max) { max = min + 1; if (min > 0) min = 0; }
  const range = max - min;
  const step0 = range / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || step0;
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}
const fmt = (n) => (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e4 ? (n / 1e3).toFixed(0) + 'K' : String(parseFloat(n.toFixed(2))));

export function drawChart(canvas, type, data, title = '') {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '12px "Segoe UI", Calibri, sans-serif';
  ctx.textBaseline = 'middle';
  const { categories, series } = data;
  let top = 12;
  if (title) {
    ctx.fillStyle = '#595959';
    ctx.font = '16px "Segoe UI", Calibri, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 20);
    ctx.font = '12px "Segoe UI", Calibri, sans-serif';
    top = 40;
  }
  if (!series.length) {
    ctx.fillStyle = '#888'; ctx.textAlign = 'center';
    ctx.fillText('Select cells with numbers to chart', W / 2, H / 2);
    return;
  }

  /* legend */
  const legendH = 24;
  const names = type === 'pie' ? categories : series.map(s => s.name);
  ctx.textAlign = 'left';
  let lx = 0;
  const widths = names.map(n => ctx.measureText(n).width + 26);
  const totalW = widths.reduce((a, b) => a + b, 0);
  lx = Math.max(8, (W - totalW) / 2);
  names.forEach((n, i) => {
    if (lx > W - 20) return;
    ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
    ctx.fillRect(lx, H - legendH / 2 - 4, 9, 9);
    ctx.fillStyle = '#595959';
    ctx.fillText(n, lx + 13, H - legendH / 2);
    lx += widths[i];
  });
  const bottom = H - legendH - 6;

  if (type === 'pie') {
    const vals = series[0].values.map(v => Math.max(0, v));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const r = Math.max(10, Math.min(W - 40, bottom - top) / 2 - 4);
    const cx = W / 2, cy = (top + bottom) / 2;
    let a = -Math.PI / 2;
    vals.forEach((v, i) => {
      const da = v / total * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + da); ctx.closePath();
      ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length]; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      if (da > 0.25) {
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.fillText(Math.round(v / total * 100) + '%', cx + Math.cos(a + da / 2) * r * 0.65, cy + Math.sin(a + da / 2) * r * 0.65);
      }
      a += da;
    });
    return;
  }

  const all = series.flatMap(s => s.values);
  const sc = niceScale(Math.min(0, ...all), Math.max(0, ...all));
  const horizontal = type === 'bar';
  ctx.font = '11px "Segoe UI", Calibri, sans-serif';
  const labelW = Math.max(...[sc.min, sc.max].map(v => ctx.measureText(fmt(v)).width)) + 10;
  const catW = horizontal ? Math.min(120, Math.max(...categories.map(c => ctx.measureText(c).width)) + 10) : 0;
  const left = horizontal ? catW + 6 : labelW + 6;
  const right = W - 14;
  const plotB = horizontal ? bottom - 18 : bottom - 20;
  const n = categories.length;

  /* gridlines + value axis labels */
  ctx.strokeStyle = '#d9d9d9'; ctx.lineWidth = 1; ctx.fillStyle = '#595959';
  for (let v = sc.min; v <= sc.max + sc.step / 2; v += sc.step) {
    const t = (v - sc.min) / (sc.max - sc.min);
    if (horizontal) {
      const x = left + t * (right - left);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, top); ctx.lineTo(Math.round(x) + .5, plotB); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillText(fmt(v), x, plotB + 10);
    } else {
      const y = plotB - t * (plotB - top);
      ctx.beginPath(); ctx.moveTo(left, Math.round(y) + .5); ctx.lineTo(right, Math.round(y) + .5); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(fmt(v), left - 6, y);
    }
  }
  const zero = (v) => (v - sc.min) / (sc.max - sc.min);

  if (type === 'line') {
    const step = (right - left) / Math.max(1, n);
    series.forEach((s, si) => {
      ctx.strokeStyle = CHART_COLORS[si % CHART_COLORS.length];
      ctx.lineWidth = 2.25;
      ctx.beginPath();
      s.values.forEach((v, i) => {
        const x = left + step * (i + 0.5), y = plotB - zero(v) * (plotB - top);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = CHART_COLORS[si % CHART_COLORS.length];
      s.values.forEach((v, i) => { ctx.beginPath(); ctx.arc(left + step * (i + 0.5), plotB - zero(v) * (plotB - top), 3, 0, Math.PI * 2); ctx.fill(); });
    });
    ctx.fillStyle = '#595959'; ctx.textAlign = 'center';
    categories.forEach((c, i) => { if (n < 30 || i % Math.ceil(n / 30) === 0) ctx.fillText(c.slice(0, 14), left + step * (i + 0.5), plotB + 10); });
    return;
  }

  const groups = n;
  const span = horizontal ? (plotB - top) / groups : (right - left) / groups;
  const barW = span * 0.7 / series.length;
  series.forEach((s, si) => {
    ctx.fillStyle = CHART_COLORS[si % CHART_COLORS.length];
    s.values.forEach((v, i) => {
      const p0 = zero(0), p1 = zero(v);
      if (horizontal) {
        const y = top + span * i + span * 0.15 + barW * si;
        const x0 = left + Math.min(p0, p1) * (right - left), x1 = left + Math.max(p0, p1) * (right - left);
        ctx.fillRect(x0, y, Math.max(1, x1 - x0), barW - 1);
      } else {
        const x = left + span * i + span * 0.15 + barW * si;
        const y0 = plotB - Math.max(p0, p1) * (plotB - top), y1 = plotB - Math.min(p0, p1) * (plotB - top);
        ctx.fillRect(x, y0, barW - 1, Math.max(1, y1 - y0));
      }
    });
  });
  ctx.fillStyle = '#595959';
  categories.forEach((c, i) => {
    if (horizontal) { ctx.textAlign = 'right'; ctx.fillText(c.slice(0, 18), left - 6, top + span * (i + 0.5)); }
    else if (n < 30 || i % Math.ceil(n / 30) === 0) { ctx.textAlign = 'center'; ctx.fillText(c.slice(0, 14), left + span * (i + 0.5), plotB + 10); }
  });
}
