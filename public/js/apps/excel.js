/* Excel — spreadsheet with formulas, formatting, multiple sheets, fill handle, sort, charts. Saves real .xlsx (opens in Microsoft Excel) and .csv. */
import { createWindow } from '../wm.js';
import { I } from '../icons.js';
import { getNode, canonical, writeFile, KNOWN, extOf, addNode, makeFile, uniqueName } from '../fs.js';
import { contextMenu, promptDialog, msgDialog, dialog, esc, notify, mountDialog } from '../ui.js';
import { fileDialog } from '../filedialog.js';
import { dragKind, currentDrag, downloadNode } from '../fileops.js';
import { Book, newSheet, addr, parseAddr, colName, formatValue, isErr, shiftFormula, mapRefs, FUNCTIONS, parseCSV, toCSV, literal } from '../office/formula.js';
import { writeXlsx, readXlsx } from '../office/xlsx.js';
import { toDataURL, dataURLToBytes } from '../office/zip.js';
import { drawChart, chartData } from '../office/chart.js';
import { launch } from './registry.js';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DEFAULT_W = 80, ROW_H = 22, HEAD_W = 46;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FILLS = ['#ffff00', '#fff2cc', '#e2efda', '#ddebf7', '#fce4d6', '#ededed', '#c6efce', '#ffc7ce', '#4472c4', '#70ad47'];
const FONT_COLORS = ['#000000', '#c00000', '#ff0000', '#ffc000', '#00b050', '#0070c0', '#7030a0', '#808080', '#ffffff'];

let untitledN = 0;

export function open(arg = null) {
  const win = createWindow({ title: 'Book1 - Excel', icon: I.excel, appId: 'excel', w: 1100, h: 700, minW: 620, minH: 400 });
  win.body.innerHTML = `
    <div class="wd xl" tabindex="-1">
      <div class="wd-titlebar"><span class="wd-autosave">${I.save} <span class="wd-saved">Not saved</span></span><span class="wd-docname">Book1</span></div>
      <div class="wd-tabs">
        <div class="wd-tab file" data-t="file">File</div>
        <div class="wd-tab sel" data-t="home">Home</div>
        <div class="wd-tab" data-t="insert">Insert</div>
        <div class="wd-tab" data-t="formulas">Formulas</div>
        <div class="wd-tab" data-t="data">Data</div>
        <div class="wd-tab" data-t="view">View</div>
      </div>
      <div class="wd-ribbon">
        <div class="wd-pane" data-p="home">
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="paste">${I.paste}<span>Paste</span></button>
            <div class="rg-col"><button class="rb" data-c="cut" title="Cut (Ctrl+X)">${I.cut}</button><button class="rb" data-c="copy" title="Copy (Ctrl+C)">${I.copy}</button><button class="rb" data-c="undo" title="Undo (Ctrl+Z)">${I.undo}</button><button class="rb" data-c="redo" title="Redo (Ctrl+Y)">${I.redo}</button></div></div><div class="rg-name">Clipboard</div></div>
          <div class="rg"><div class="rg-body col">
            <div class="rg-row"><button class="rb t" data-c="b" title="Bold (Ctrl+B)"><b>B</b></button><button class="rb t" data-c="i" title="Italic (Ctrl+I)"><i>I</i></button><button class="rb t" data-c="u" title="Underline (Ctrl+U)"><u>U</u></button>
              <button class="rb" data-c="fill" title="Fill color"><span class="fill-ic">◪</span><span class="bar fl-bar"></span></button><button class="rb drop" data-c="fillPick">▾</button>
              <button class="rb" data-c="color" title="Font color"><span class="fc-ic">A</span><span class="bar fc-bar"></span></button><button class="rb drop" data-c="colorPick">▾</button></div>
            <div class="rg-row"><button class="rb" data-c="grow" title="Increase font size">A<sup>+</sup></button><button class="rb" data-c="shrink" title="Decrease font size">A<sup>-</sup></button><button class="rb" data-c="wrap" title="Wrap text">↵<span class="rb-l">Wrap</span></button></div>
          </div><div class="rg-name">Font</div></div>
          <div class="rg"><div class="rg-body col">
            <div class="rg-row"><button class="rb t" data-c="left" title="Align left">${alignIcon('l')}</button><button class="rb t" data-c="center" title="Center">${alignIcon('c')}</button><button class="rb t" data-c="right" title="Align right">${alignIcon('r')}</button></div>
            <div class="rg-row"><button class="rb" data-c="merge" title="Center across selection">⇔<span class="rb-l">Center</span></button></div>
          </div><div class="rg-name">Alignment</div></div>
          <div class="rg"><div class="rg-body col">
            <div class="rg-row"><select class="xl-fmt" title="Number format"><option value="general">General</option><option value="number">Number</option><option value="currency">Currency</option><option value="percent">Percentage</option><option value="date">Short Date</option><option value="time">Time</option><option value="text">Text</option></select></div>
            <div class="rg-row"><button class="rb" data-c="fmt-currency" title="Currency format">$</button><button class="rb" data-c="fmt-percent" title="Percent style">%</button><button class="rb" data-c="fmt-comma" title="Comma style">,</button><button class="rb" data-c="decInc" title="Increase decimal">.0→</button><button class="rb" data-c="decDec" title="Decrease decimal">←.0</button></div>
          </div><div class="rg-name">Number</div></div>
          <div class="rg"><div class="rg-body col"><button class="rb wide" data-c="insertMenu">${I.plus}<span>Insert ▾</span></button><button class="rb wide" data-c="deleteMenu">${I.x}<span>Delete ▾</span></button><button class="rb wide" data-c="clearMenu">⌫<span>Clear ▾</span></button></div><div class="rg-name">Cells</div></div>
          <div class="rg"><div class="rg-body col"><button class="rb wide" data-c="autosum"><b>Σ</b><span>AutoSum ▾</span></button><button class="rb wide" data-c="sortMenu">${I.sort}<span>Sort ▾</span></button><button class="rb wide" data-c="find">${I.search}<span>Find</span></button></div><div class="rg-name">Editing</div></div>
        </div>
        <div class="wd-pane hidden" data-p="insert">
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="chart-column">${chartIcon('column')}<span>Column</span></button><button class="rb big" data-c="chart-bar">${chartIcon('bar')}<span>Bar</span></button><button class="rb big" data-c="chart-line">${chartIcon('line')}<span>Line</span></button><button class="rb big" data-c="chart-pie">${chartIcon('pie')}<span>Pie</span></button></div><div class="rg-name">Charts</div></div>
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="insFunc"><b style="font-size:18px;font-style:italic">fx</b><span>Function</span></button><button class="rb big" data-c="insDate">${I.clock}<span>Today's date</span></button></div><div class="rg-name">Other</div></div>
        </div>
        <div class="wd-pane hidden" data-p="formulas">
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="insFunc"><b style="font-size:18px;font-style:italic">fx</b><span>Insert Function</span></button><button class="rb big" data-c="autosum"><b style="font-size:18px">Σ</b><span>AutoSum ▾</span></button>
            <button class="rb big" data-c="fnMath">θ<span>Math ▾</span></button><button class="rb big" data-c="fnText">A<span>Text ▾</span></button><button class="rb big" data-c="fnLogic">?<span>Logical ▾</span></button><button class="rb big" data-c="fnLookup">🔍<span>Lookup ▾</span></button></div><div class="rg-name">Function Library</div></div>
          <div class="rg"><div class="rg-body"><button class="rb big t" data-c="showFormulas"><b>{=}</b><span>Show Formulas</span></button><button class="rb big" data-c="calc">${I.refresh}<span>Calculate Now</span></button></div><div class="rg-name">Formula Auditing</div></div>
        </div>
        <div class="wd-pane hidden" data-p="data">
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="sortAZ"><b>A↓Z</b><span>Sort A to Z</span></button><button class="rb big" data-c="sortZA"><b>Z↓A</b><span>Sort Z to A</span></button></div><div class="rg-name">Sort</div></div>
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="dedupe">⧉<span>Remove Duplicates</span></button><button class="rb big" data-c="importCSV">${I.upload}<span>From Text/CSV</span></button></div><div class="rg-name">Data Tools</div></div>
        </div>
        <div class="wd-pane hidden" data-p="view">
          <div class="rg"><div class="rg-body col"><label class="rb-check"><input type="checkbox" data-v="grid" checked> Gridlines</label><label class="rb-check"><input type="checkbox" data-v="heads" checked> Headings</label><label class="rb-check"><input type="checkbox" data-v="formulaBar" checked> Formula Bar</label></div><div class="rg-name">Show</div></div>
          <div class="rg"><div class="rg-body"><button class="rb big t" data-c="freezeRow">❄<span>Freeze Top Row</span></button><button class="rb big t" data-c="freezeCol">❄<span>Freeze First Column</span></button></div><div class="rg-name">Window</div></div>
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="zoomOut"><b style="font-size:20px">−</b><span>Zoom out</span></button><button class="rb big" data-c="zoom100"><b>100%</b><span>100%</span></button><button class="rb big" data-c="zoomIn"><b style="font-size:20px">+</b><span>Zoom in</span></button></div><div class="rg-name">Zoom</div></div>
        </div>
      </div>
      <div class="xl-fbar">
        <input class="xl-name" spellcheck="false" title="Name Box"><span class="xl-fx-btns"><button class="xl-fxb x" title="Cancel">✕</button><button class="xl-fxb ok" title="Enter">✓</button><button class="xl-fxb fx" title="Insert Function"><i>fx</i></button></span>
        <input class="xl-formula" spellcheck="false">
      </div>
      <div class="np-find xl-find hidden"><input class="nf-find" placeholder="Find what" spellcheck="false"><input class="nf-repl" placeholder="Replace with" spellcheck="false"><button class="btn nf-next">Find Next</button><button class="btn nf-all">Replace All</button><span class="nf-count"></span><button class="toolbar-btn nf-x">${I.x}</button></div>
      <div class="xl-gridwrap"><div class="xl-zoom"><div class="xl-sheet">
        <table class="xl-grid"></table>
        <div class="xl-copy hidden"></div>
        <div class="xl-filljob hidden"></div>
        <div class="xl-sel"><div class="xl-active"></div><div class="xl-handle"></div></div>
        <input class="xl-edit hidden" spellcheck="false">
        <div class="xl-charts"></div>
      </div></div></div>
      <div class="xl-tabsbar"><div class="xl-sheettabs"></div><button class="xl-addsheet" title="New sheet">+</button></div>
      <div class="wd-status"><span class="xs-mode">Ready</span><span class="ws-flex"></span><span class="xs-stats"></span>
        <button class="ws-z" data-z="-">−</button><input type="range" class="ws-zoom" min="50" max="200" step="10" value="100"><button class="ws-z" data-z="+">+</button><span class="ws-zv">100%</span></div>
    </div>`;

  const root = win.body.querySelector('.xl');
  const wrap = root.querySelector('.xl-gridwrap');
  const zoomEl = root.querySelector('.xl-zoom');
  const sheetEl = root.querySelector('.xl-sheet');
  const table = root.querySelector('.xl-grid');
  const selEl = root.querySelector('.xl-sel');
  const activeEl = root.querySelector('.xl-active');
  const handle = root.querySelector('.xl-handle');
  const copyEl = root.querySelector('.xl-copy');
  const fillEl = root.querySelector('.xl-filljob');
  const edit = root.querySelector('.xl-edit');
  const nameBox = root.querySelector('.xl-name');
  const fbar = root.querySelector('.xl-formula');
  const chartsEl = root.querySelector('.xl-charts');
  const findBar = root.querySelector('.xl-find');

  let book = new Book();
  book.active = 0;
  const st = { path: null, dirty: false, untitled: `Book${++untitledN}`, zoom: 100, showFormulas: false, fill: '#ffff00', color: '#c00000' };
  let ROWS = 0, COLS = 0;
  let tds = [];
  let sel = { c: 0, r: 0, c1: 0, r1: 0, c2: 0, r2: 0 };
  let editing = null;     /* { mode: 'enter'|'edit', from: 'cell'|'bar', orig } */
  let clip = null;        /* { sheet, c1, r1, c2, r2, cells, cut, tsv } */
  let undoStack = [], redoStack = [];

  const sh = () => book.sheets[book.active];
  const cellAt = (c, r) => sh().cells[addr(c, r)];
  const rawAt = (c, r) => (cellAt(c, r) || {}).v || '';
  const colW = (c) => sh().colW[c] || DEFAULT_W;

  /* ---------- document state ---------- */
  const docName = () => st.path ? st.path[st.path.length - 1] : st.untitled;
  function refreshTitle() {
    win.setTitle(`${docName()}${st.dirty ? '*' : ''} - Excel`);
    root.querySelector('.wd-docname').textContent = docName().replace(/\.xlsx$/i, '') + (st.dirty ? ' •' : '');
    root.querySelector('.wd-saved').textContent = st.path ? (st.dirty ? 'Edited' : 'Saved to This PC') : 'Not saved';
  }
  const setDirty = (v = true) => { if (st.dirty !== v) { st.dirty = v; refreshTitle(); } };

  /* ---------- undo ---------- */
  function snapshot() { return JSON.stringify({ sheets: book.sheets.map(s => ({ name: s.name, cells: s.cells, colW: s.colW, charts: s.charts })), active: book.active }); }
  function record() {
    const snap = snapshot();
    undoStack.push(snap);
    if (undoStack.length > (snap.length > 2e6 ? 5 : 40)) undoStack.shift();
    redoStack = [];
  }
  function restoreSnap(json) {
    const o = JSON.parse(json);
    book = new Book(o.sheets.map(s => ({ ...newSheet(s.name), cells: s.cells, colW: s.colW, charts: s.charts || [] })));
    book.active = Math.min(o.active, book.sheets.length - 1);
    book.sheets.forEach(s => book.updateBounds(s));
    buildGrid(); renderTabs(); setDirty();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restoreSnap(undoStack.pop()); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restoreSnap(redoStack.pop()); }

  /* ---------- grid ---------- */
  function buildGrid() {
    const s = sh();
    book.updateBounds(s);
    ROWS = Math.max(100, s.maxR + 40);
    COLS = Math.max(26, s.maxC + 6);
    let h = `<colgroup><col style="width:${HEAD_W}px">${Array.from({ length: COLS }, (_, c) => `<col style="width:${colW(c)}px">`).join('')}</colgroup>`;
    h += `<thead><tr><th class="corner" title="Select all"></th>${Array.from({ length: COLS }, (_, c) => `<th class="ch" data-c="${c}">${colName(c)}<span class="cr" data-c="${c}"></span></th>`).join('')}</tr></thead><tbody>`;
    for (let r = 0; r < ROWS; r++) h += rowHTML(r);
    table.innerHTML = h + '</tbody>';
    collect();
    renderAll();
  }
  const rowHTML = (r) => `<tr><th class="rh" data-r="${r}">${r + 1}</th>${Array.from({ length: COLS }, (_, c) => `<td data-c="${c}" data-r="${r}"></td>`).join('')}</tr>`;
  function collect() {
    tds = [];
    table.querySelectorAll('tbody tr').forEach((tr, r) => { tds[r] = [...tr.querySelectorAll('td')]; });
  }
  function addRows(n) {
    const tb = table.tBodies[0];
    const frag = document.createElement('tbody');
    let h = '';
    for (let r = ROWS; r < ROWS + n; r++) h += rowHTML(r);
    frag.innerHTML = h;
    while (frag.firstChild) tb.appendChild(frag.firstChild);
    ROWS += n;
    collect();
    for (let r = ROWS - n; r < ROWS; r++) for (let c = 0; c < COLS; c++) renderCell(c, r);
  }
  function addCols(n) { const s = sh(); s.maxC = Math.max(s.maxC, COLS + n - 6); buildGrid(); }

  function renderCell(c, r) {
    const td = tds[r] && tds[r][c];
    if (!td) return;
    const cell = cellAt(c, r);
    const s = (cell && cell.s) || {};
    const raw = cell ? cell.v : '';
    let text = '', v = null;
    if (st.showFormulas) text = raw || '';
    else if (raw) { v = book.value(sh(), c, r); text = formatValue(v, s); }
    td.textContent = text;
    const isNum = typeof v === 'number' || (v && v.date != null);
    const align = s.align || (st.showFormulas ? 'left' : isNum ? 'right' : (typeof v === 'boolean' || isErr(v)) ? 'center' : 'left');
    let css = `text-align:${align};`;
    if (s.b) css += 'font-weight:700;';
    if (s.i) css += 'font-style:italic;';
    if (s.u) css += 'text-decoration:underline;';
    if (s.color) css += `color:${s.color};`;
    if (s.fill) css += `background:${s.fill};`;
    if (s.size) css += `font-size:${s.size}pt;`;
    td.style.cssText = css;
    td.className = (s.wrap ? 'wrap' : '') + (isErr(v) ? ' err' : '');
    /* text spills into empty neighbours, like Excel */
    if (text && !isNum && align === 'left' && !s.wrap) {
      const next = tds[r][c + 1];
      if (next && !rawAt(c + 1, r)) td.classList.add('spill');
    }
  }
  function renderAll() {
    book.invalidate();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) renderCell(c, r);
    renderSelection();
    renderCharts();
    updateStatus();
  }

  /* ---------- selection ---------- */
  const norm = () => ({ c1: Math.min(sel.c1, sel.c2), r1: Math.min(sel.r1, sel.r2), c2: Math.max(sel.c1, sel.c2), r2: Math.max(sel.r1, sel.r2) });
  function rectOf(c1, r1, c2, r2) {
    const a = tds[r1] && tds[r1][c1], b = tds[r2] && tds[r2][c2];
    if (!a || !b) return null;
    return { x: a.offsetLeft, y: a.offsetTop, w: b.offsetLeft + b.offsetWidth - a.offsetLeft, h: b.offsetTop + b.offsetHeight - a.offsetTop };
  }
  function place(el, rc) { if (!rc) return; Object.assign(el.style, { left: rc.x + 'px', top: rc.y + 'px', width: rc.w + 'px', height: rc.h + 'px' }); }
  function renderSelection() {
    const n = norm();
    const rc = rectOf(n.c1, n.r1, n.c2, n.r2);
    place(selEl, rc);
    const a = rectOf(sel.c, sel.r, sel.c, sel.r);
    if (a && rc) Object.assign(activeEl.style, { left: a.x - rc.x + 'px', top: a.y - rc.y + 'px', width: a.w + 'px', height: a.h + 'px' });
    selEl.classList.toggle('multi', n.c1 !== n.c2 || n.r1 !== n.r2);
    table.querySelectorAll('.hl').forEach(x => x.classList.remove('hl'));
    table.querySelectorAll('thead th.ch').forEach(th => { const c = +th.dataset.c; if (c >= n.c1 && c <= n.c2) th.classList.add('hl'); });
    for (let r = n.r1; r <= Math.min(n.r2, ROWS - 1); r++) table.tBodies[0].rows[r]?.cells[0].classList.add('hl');
    nameBox.value = n.c1 !== n.c2 || n.r1 !== n.r2 ? (dragging ? `${n.r2 - n.r1 + 1}R x ${n.c2 - n.c1 + 1}C` : `${addr(n.c1, n.r1)}:${addr(n.c2, n.r2)}`) : addr(sel.c, sel.r);
    if (!editing) fbar.value = rawAt(sel.c, sel.r);
    if (clip && clip.sheet === book.active) { copyEl.classList.remove('hidden'); place(copyEl, rectOf(clip.c1, clip.r1, clip.c2, clip.r2)); } else copyEl.classList.add('hidden');
    updateRibbon();
    updateStatus();
  }
  /* like Excel: Tab, Tab, …, Enter returns to the column where the Tab run started */
  let tabStart = null;
  function stepTo(dc, dr, tab) {
    let c = sel.c + dc;
    if (tab) { if (tabStart == null) tabStart = sel.c; } else if (dr === 1 && tabStart != null) c = tabStart;
    const keep = tab ? tabStart : null;
    select(c, sel.r + dr);
    tabStart = keep;
  }
  function select(c, r, extend = false) {
    tabStart = null;
    c = Math.max(0, c); r = Math.max(0, r);
    if (r >= ROWS - 5) addRows(50);
    if (c >= COLS - 1) addCols(10);
    if (extend) { sel.c2 = c; sel.r2 = r; }
    else sel = { c, r, c1: c, r1: r, c2: c, r2: r };
    renderSelection();
    scrollIntoView(extend ? c : sel.c, extend ? r : sel.r);
  }
  function scrollIntoView(c, r) {
    const td = tds[r] && tds[r][c];
    if (!td) return;
    const z = st.zoom / 100;
    const x = td.offsetLeft * z, y = td.offsetTop * z, w = td.offsetWidth * z, h = td.offsetHeight * z;
    const left = HEAD_W * z, top = ROW_H * z;
    if (x - left < wrap.scrollLeft) wrap.scrollLeft = x - left;
    else if (x + w > wrap.scrollLeft + wrap.clientWidth) wrap.scrollLeft = x + w - wrap.clientWidth;
    if (y - top < wrap.scrollTop) wrap.scrollTop = y - top;
    else if (y + h > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = y + h - wrap.clientHeight;
  }
  function forEachSel(fn) { const n = norm(); for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) fn(c, r); }
  function selValues() { const out = []; forEachSel((c, r) => { if (rawAt(c, r)) out.push(book.value(sh(), c, r)); }); return out; }

  function updateStatus() {
    root.querySelector('.xs-mode').textContent = editing ? (editing.point ? 'Point' : editing.mode === 'edit' ? 'Edit' : 'Enter') : 'Ready';
    const n = norm();
    const stats = root.querySelector('.xs-stats');
    if (n.c1 === n.c2 && n.r1 === n.r2) { stats.textContent = ''; return; }
    const vals = selValues();
    const nums = vals.map(v => (v && v.date != null ? v.date : v)).filter(v => typeof v === 'number');
    stats.textContent = vals.length ? (nums.length ? `Average: ${formatValue(nums.reduce((a, b) => a + b, 0) / nums.length)}    Count: ${vals.length}    Sum: ${formatValue(nums.reduce((a, b) => a + b, 0))}` : `Count: ${vals.length}`) : '';
  }

  function updateRibbon() {
    const s = (cellAt(sel.c, sel.r) || {}).s || {};
    root.querySelectorAll('.rb.t[data-c]').forEach(b => {
      const c = b.dataset.c;
      const on = c === 'b' || c === 'i' || c === 'u' ? !!s[c] : ['left', 'center', 'right'].includes(c) ? s.align === c : c === 'showFormulas' ? st.showFormulas : c === 'freezeRow' ? root.classList.contains('freeze-row') : c === 'freezeCol' ? root.classList.contains('freeze-col') : false;
      b.classList.toggle('on', on);
    });
    const f = root.querySelector('.xl-fmt');
    if (document.activeElement !== f) f.value = s.fmt || 'general';
  }

  /* ---------- editing ---------- */
  function setCell(c, r, raw, sheet = sh()) {
    const a = addr(c, r);
    const cell = sheet.cells[a];
    if (!raw && (!cell || !cell.s)) delete sheet.cells[a];
    else sheet.cells[a] = { ...(cell || {}), v: raw };
    if (c > sheet.maxC) sheet.maxC = c;
    if (r > sheet.maxR) sheet.maxR = r;
  }

  function startEdit(mode, initial = null) {
    if (editing) return;
    const raw = rawAt(sel.c, sel.r);
    editing = { mode, orig: raw };
    const rc = rectOf(sel.c, sel.r, sel.c, sel.r);
    place(edit, rc);
    edit.style.minWidth = rc.w + 'px';
    edit.style.width = rc.w + 'px';
    const s = (cellAt(sel.c, sel.r) || {}).s || {};
    edit.style.fontWeight = s.b ? '700' : ''; edit.style.fontStyle = s.i ? 'italic' : '';
    edit.style.textAlign = s.align || 'left';
    edit.value = initial != null ? initial : raw;
    fbar.value = edit.value;
    edit.classList.remove('hidden');
    edit.focus();
    const L = edit.value.length;
    edit.setSelectionRange(L, L);
    growEdit();
    updateStatus();
  }
  function growEdit() {
    edit.style.width = Math.max(parseFloat(edit.style.minWidth), Math.min(600, edit.scrollWidth + 4)) + 'px';
  }
  function commitEdit(move = null) {
    if (!editing) return;
    let v = edit.value;
    editing = null;
    edit.classList.add('hidden');
    if (v !== rawAt(sel.c, sel.r)) {
      record();
      /* auto-close parentheses like Excel */
      if (v.startsWith('=')) { const open = (v.match(/\(/g) || []).length - (v.match(/\)/g) || []).length; if (open > 0) v += ')'.repeat(open); }
      setCell(sel.c, sel.r, v);
      /* typing a percent / currency / date applies a matching number format */
      const lit = literal(v);
      const cell = cellAt(sel.c, sel.r);
      if (cell && !(cell.s && cell.s.fmt)) {
        if (/^[-+]?[\d.]+%$/.test(v.trim())) cell.s = { ...(cell.s || {}), fmt: 'percent', dec: (v.split('.')[1] || '').replace('%', '').length };
        else if (/^[$€£]/.test(v.trim()) && typeof lit === 'number') cell.s = { ...(cell.s || {}), fmt: 'currency', sym: v.trim()[0], dec: 2 };
        else if (lit && lit.date != null) cell.s = { ...(cell.s || {}), fmt: 'date' };
      }
      setDirty();
      renderAll();
    }
    root.focus({ preventScroll: true });
    if (move) stepTo(move[0], move[1], move.tab);
    else renderSelection();
  }
  function cancelEdit() {
    if (!editing) return;
    editing = null;
    edit.classList.add('hidden');
    fbar.value = rawAt(sel.c, sel.r);
    root.focus({ preventScroll: true });
    updateStatus();
  }
  /* formula "point mode": clicking a cell while typing a formula inserts its reference */
  const canPoint = () => {
    if (!editing) return false;
    const input = editing.from === 'bar' ? fbar : edit;
    if (!input.value.startsWith('=')) return false;
    const before = input.value.slice(0, input.selectionStart).trimEnd();
    return /[=+\-*/^&(,:<>]$/.test(before) || (editing.point && editing.pointEnd === input.selectionStart);
  };
  function insertRef(text) {
    const input = editing.from === 'bar' ? fbar : edit;
    let s = input.selectionStart, e = input.selectionEnd;
    if (editing.point && editing.pointEnd === s) s = editing.pointStart;
    input.value = input.value.slice(0, s) + text + input.value.slice(e);
    editing.point = true; editing.pointStart = s; editing.pointEnd = s + text.length;
    input.setSelectionRange(editing.pointEnd, editing.pointEnd);
    (input === edit ? fbar : edit).value = input.value;
    growEdit();
    updateStatus();
  }

  edit.addEventListener('input', () => { fbar.value = edit.value; editing && (editing.point = false); growEdit(); updateStatus(); });
  edit.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const k = e.key;
    if (k === 'Enter') { e.preventDefault(); commitEdit(e.altKey ? null : [0, e.shiftKey ? -1 : 1]); if (e.altKey) startEdit('edit', edit.value + '\n'); }
    else if (k === 'Tab') { e.preventDefault(); commitEdit(Object.assign([e.shiftKey ? -1 : 1, 0], { tab: !e.shiftKey })); }
    else if (k === 'Escape') { e.preventDefault(); cancelEdit(); }
    else if (k === 'F2') { e.preventDefault(); editing.mode = editing.mode === 'edit' ? 'enter' : 'edit'; updateStatus(); }
    else if (k.startsWith('Arrow') && editing.mode === 'enter' && !edit.value.startsWith('=')) {
      e.preventDefault();
      commitEdit({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[k]);
    }
  });

  fbar.addEventListener('focus', () => { if (!editing) { editing = { mode: 'edit', from: 'bar', orig: rawAt(sel.c, sel.r) }; updateStatus(); } else editing.from = 'bar'; });
  fbar.addEventListener('input', () => { edit.value = fbar.value; if (editing) editing.point = false; });
  fbar.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); edit.value = fbar.value; commitEdit([0, 1]); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    else if (e.key === 'Tab') { e.preventDefault(); edit.value = fbar.value; commitEdit(Object.assign([1, 0], { tab: true })); }
  });
  root.querySelector('.xl-fxb.ok').addEventListener('mousedown', (e) => { e.preventDefault(); if (editing) { edit.value = editing.from === 'bar' ? fbar.value : edit.value; commitEdit(); } });
  root.querySelector('.xl-fxb.x').addEventListener('mousedown', (e) => { e.preventDefault(); cancelEdit(); });
  root.querySelector('.xl-fxb.fx').addEventListener('click', () => insertFunctionDialog());

  nameBox.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = nameBox.value.trim().toUpperCase();
    const [a, b] = v.split(':').map(parseAddr);
    if (!a) { msgDialog('Microsoft Excel', 'The reference you typed isn\'t valid.', 'warn'); return; }
    select(a.c, a.r);
    if (b) select(b.c, b.r, true);
    root.focus();
  });
  nameBox.addEventListener('focus', () => nameBox.select());

  /* ---------- mouse ---------- */
  let dragging = null;   /* 'cells' | 'cols' | 'rows' | 'fill' | 'point' | 'resize' */
  let dragStart = null;
  const cellFromPoint = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const td = el && el.closest && el.closest('td[data-c]');
    if (td && table.contains(td)) return { c: +td.dataset.c, r: +td.dataset.r };
    return null;
  };

  table.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const td = e.target.closest('td[data-c]');
    const ch = e.target.closest('th.ch');
    const rh = e.target.closest('th.rh');
    const cr = e.target.closest('.cr');
    if (cr) { startResize(e, +cr.dataset.c); return; }
    if (td && editing && canPoint()) {
      e.preventDefault();
      dragging = 'point';
      dragStart = { c: +td.dataset.c, r: +td.dataset.r };
      insertRef(addr(dragStart.c, dragStart.r));
      return;
    }
    if (editing) commitEdit();
    root.focus({ preventScroll: true });
    if (td) {
      const c = +td.dataset.c, r = +td.dataset.r;
      if (e.shiftKey) select(c, r, true); else select(c, r);
      dragging = 'cells';
    } else if (ch) {
      const c = +ch.dataset.c;
      if (e.shiftKey) { sel.c2 = c; sel.r1 = 0; sel.r2 = ROWS - 1; } else sel = { c, r: 0, c1: c, r1: 0, c2: c, r2: ROWS - 1 };
      dragging = 'cols'; renderSelection();
    } else if (rh) {
      const r = +rh.dataset.r;
      if (e.shiftKey) { sel.r2 = r; sel.c1 = 0; sel.c2 = COLS - 1; } else sel = { c: 0, r, c1: 0, r1: r, c2: COLS - 1, r2: r };
      dragging = 'rows'; renderSelection();
    } else if (e.target.closest('th.corner')) selectAll();
  });
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (editing) commitEdit();
    dragging = 'fill';
    dragStart = norm();
  });
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  function onMove(e) {
    if (!dragging || e.buttons === 0) return;
    if (dragging === 'resize') { doResize(e); return; }
    const p = cellFromPoint(e.clientX, e.clientY);
    if (!p) return;
    if (dragging === 'cells') { if (p.c !== sel.c2 || p.r !== sel.r2) { sel.c2 = p.c; sel.r2 = p.r; renderSelection(); } }
    else if (dragging === 'cols') { sel.c2 = p.c; renderSelection(); }
    else if (dragging === 'rows') { sel.r2 = p.r; renderSelection(); }
    else if (dragging === 'point') {
      const ref = p.c === dragStart.c && p.r === dragStart.r ? addr(p.c, p.r) : `${addr(Math.min(p.c, dragStart.c), Math.min(p.r, dragStart.r))}:${addr(Math.max(p.c, dragStart.c), Math.max(p.r, dragStart.r))}`;
      insertRef(ref);
    } else if (dragging === 'fill') {
      const s = dragStart;
      const down = p.r > s.r2 ? p.r - s.r2 : 0, up = p.r < s.r1 ? s.r1 - p.r : 0;
      const rightD = p.c > s.c2 ? p.c - s.c2 : 0, leftD = p.c < s.c1 ? s.c1 - p.c : 0;
      let t = null;
      if (Math.max(down, up) >= Math.max(rightD, leftD)) { if (down) t = { c1: s.c1, r1: s.r1, c2: s.c2, r2: p.r }; else if (up) t = { c1: s.c1, r1: p.r, c2: s.c2, r2: s.r2 }; }
      else if (rightD) t = { c1: s.c1, r1: s.r1, c2: p.c, r2: s.r2 }; else if (leftD) t = { c1: p.c, r1: s.r1, c2: s.c2, r2: s.r2 };
      dragStart.target = t;
      fillEl.classList.toggle('hidden', !t);
      if (t) place(fillEl, rectOf(t.c1, t.r1, t.c2, t.r2));
    }
  }
  function onUp() {
    if (!dragging) return;
    const d = dragging;
    dragging = null;
    if (d === 'fill') { fillEl.classList.add('hidden'); if (dragStart.target) fillSeries(dragStart, dragStart.target); }
    if (d === 'point') { (editing && editing.from === 'bar' ? fbar : edit).focus(); }
    if (d === 'cells' || d === 'cols' || d === 'rows') renderSelection();
  }
  table.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td[data-c]');
    const cr = e.target.closest('.cr');
    if (cr) { autofit(+cr.dataset.c); return; }
    if (td) { select(+td.dataset.c, +td.dataset.r); startEdit('edit'); }
  });
  table.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const td = e.target.closest('td[data-c]');
    const ch = e.target.closest('th.ch'), rh = e.target.closest('th.rh');
    if (td) {
      const c = +td.dataset.c, r = +td.dataset.r;
      const n = norm();
      if (c < n.c1 || c > n.c2 || r < n.r1 || r > n.r2) select(c, r);
    }
    contextMenu(e.clientX, e.clientY, [
      { label: 'Cut', icon: I.cut, hint: 'Ctrl+X', action: () => doCopy(true) },
      { label: 'Copy', icon: I.copy, hint: 'Ctrl+C', action: () => doCopy(false) },
      { label: 'Paste', icon: I.paste, hint: 'Ctrl+V', action: pasteFromButton },
      '-',
      ch ? { label: 'Insert column', action: () => insertCols() } : rh ? { label: 'Insert row', action: () => insertRows() } : { label: 'Insert…', submenu: [{ label: 'Entire row', action: () => insertRows() }, { label: 'Entire column', action: () => insertCols() }] },
      ch ? { label: 'Delete column', action: () => deleteCols() } : rh ? { label: 'Delete row', action: () => deleteRows() } : { label: 'Delete…', submenu: [{ label: 'Entire row', action: () => deleteRows() }, { label: 'Entire column', action: () => deleteCols() }] },
      { label: 'Clear Contents', hint: 'Del', action: () => clearSel('contents') },
      '-',
      { label: 'Sort', submenu: [{ label: 'Sort A to Z', action: () => sortSel(1) }, { label: 'Sort Z to A', action: () => sortSel(-1) }] },
      { label: 'Insert Function…', action: insertFunctionDialog },
      ...(ch ? [{ label: 'Column Width…', action: () => askWidth(+ch.dataset.c) }] : []),
      { label: 'Format Cells', submenu: ['general', 'number', 'currency', 'percent', 'date', 'text'].map(f => ({ label: f[0].toUpperCase() + f.slice(1), action: () => applyStyle({ fmt: f, dec: f === 'percent' ? 0 : f === 'general' ? undefined : 2 }) })) },
    ]);
  });

  /* column resize */
  let resizeCol = null;
  function startResize(e, c) {
    e.preventDefault(); e.stopPropagation();
    dragging = 'resize';
    resizeCol = { c, x: e.clientX, w: colW(c) };
  }
  function doResize(e) {
    const w = Math.max(16, resizeCol.w + (e.clientX - resizeCol.x) / (st.zoom / 100));
    sh().colW[resizeCol.c] = Math.round(w);
    table.querySelectorAll('col')[resizeCol.c + 1].style.width = Math.round(w) + 'px';
    renderSelection();
    renderCharts();
    setDirty();
  }
  let measureCtx = null;
  function autofit(c) {
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    let w = 30;
    for (let r = 0; r < ROWS; r++) {
      const td = tds[r][c];
      if (!td.textContent) continue;
      measureCtx.font = `${td.style.fontWeight === '700' ? 'bold ' : ''}${td.style.fontSize || '11pt'} Calibri, "Segoe UI", sans-serif`;
      w = Math.max(w, measureCtx.measureText(td.textContent).width + 12);
    }
    record();
    sh().colW[c] = Math.min(500, Math.ceil(w));
    buildGrid();
    setDirty();
  }
  async function askWidth(c) {
    const v = await promptDialog('Column Width', 'Column width (pixels):', String(colW(c)), '', { validate: (x) => (/^\d{1,3}$/.test(x) && +x >= 4 ? null : 'Enter a number between 4 and 999') });
    if (!v) return;
    record(); sh().colW[c] = +v; buildGrid(); setDirty();
  }

  /* ---------- keyboard ---------- */
  root.addEventListener('keydown', (e) => {
    if (e.target !== root) return;
    const k = e.key, lower = k.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const n = norm();
    const move = (dc, dr) => {
      e.preventDefault();
      if (e.shiftKey) {
        let c = sel.c2 + dc, r = sel.r2 + dr;
        if (ctrl) ({ c, r } = jump(sel.c2, sel.r2, dc, dr));
        select(Math.max(0, c), Math.max(0, r), true);
      } else {
        let c = sel.c + dc, r = sel.r + dr;
        if (ctrl) ({ c, r } = jump(sel.c, sel.r, dc, dr));
        select(c, r);
      }
    };
    if (k === 'ArrowUp') move(0, -1);
    else if (k === 'ArrowDown') move(0, 1);
    else if (k === 'ArrowLeft') move(-1, 0);
    else if (k === 'ArrowRight') move(1, 0);
    else if (k === 'PageDown') move(0, 20);
    else if (k === 'PageUp') move(0, -20);
    else if (k === 'Home') { e.preventDefault(); ctrl ? select(0, 0) : select(0, sel.r); }
    else if (k === 'Enter' || k === 'Tab') {
      e.preventDefault();
      const multi = n.c1 !== n.c2 || n.r1 !== n.r2;
      const d = k === 'Tab' ? [e.shiftKey ? -1 : 1, 0] : [0, e.shiftKey ? -1 : 1];
      if (!multi) { stepTo(d[0], d[1], k === 'Tab' && !e.shiftKey); return; }
      /* move inside the selection */
      let c = sel.c + d[0], r = sel.r + d[1];
      if (c > n.c2) { c = n.c1; r++; } if (c < n.c1) { c = n.c2; r--; }
      if (r > n.r2) { r = n.r1; c = c + (k === 'Enter' ? 1 : 0); if (c > n.c2) c = n.c1; }
      if (r < n.r1) r = n.r2;
      sel.c = c; sel.r = r; renderSelection();
    }
    else if (k === 'F2') { e.preventDefault(); startEdit('edit'); }
    else if (k === 'Delete') { e.preventDefault(); clearSel('contents'); }
    else if (k === 'Backspace') { e.preventDefault(); startEdit('enter', ''); }
    else if (k === 'Escape') { if (clip) { clip = null; renderSelection(); } findBar.classList.add('hidden'); }
    else if (k === 'F9') { e.preventDefault(); renderAll(); }
    else if (ctrl && lower === 'a') { e.preventDefault(); selectAll(); }
    else if (ctrl && lower === 'z') { e.preventDefault(); undo(); }
    else if (ctrl && lower === 'y') { e.preventDefault(); redo(); }
    else if (ctrl && lower === 'b') { e.preventDefault(); toggleStyle('b'); }
    else if (ctrl && lower === 'i') { e.preventDefault(); toggleStyle('i'); }
    else if (ctrl && lower === 'u') { e.preventDefault(); toggleStyle('u'); }
    else if (ctrl && lower === 'd') { e.preventDefault(); fillDir('down'); }
    else if (ctrl && lower === 'r') { e.preventDefault(); fillDir('right'); }
    else if (ctrl && lower === 's') { e.preventDefault(); save(e.shiftKey); }
    else if (k === 'F12') { e.preventDefault(); save(true); }
    else if (ctrl && lower === 'o') { e.preventDefault(); openFile(); }
    else if (ctrl && lower === 'n') { e.preventDefault(); launch('excel'); }
    else if (ctrl && lower === 'p') { e.preventDefault(); print(); }
    else if (ctrl && (lower === 'f' || lower === 'h')) { e.preventDefault(); showFind(lower === 'h'); }
    else if (ctrl && k === ';') { e.preventDefault(); startEdit('enter', new Date().toLocaleDateString('en-US')); }
    else if (ctrl && k === '`') { e.preventDefault(); commands.showFormulas(); }
    else if (e.shiftKey && k === ' ') { e.preventDefault(); sel = { c: sel.c, r: sel.r, c1: 0, r1: sel.r, c2: COLS - 1, r2: sel.r }; renderSelection(); }
    else if (ctrl && k === ' ') { e.preventDefault(); sel = { c: sel.c, r: sel.r, c1: sel.c, r1: 0, c2: sel.c, r2: ROWS - 1 }; renderSelection(); }
    else if (e.altKey && k === '=') { e.preventDefault(); autoSum('SUM'); }
    else if (k.length === 1 && !ctrl && !e.altKey) { e.preventDefault(); startEdit('enter', k); }
  });
  function jump(c, r, dc, dr) {
    const filled = (x, y) => !!rawAt(x, y);
    let x = c, y = r;
    const inside = (x2, y2) => x2 >= 0 && y2 >= 0 && x2 < COLS && y2 < Math.max(ROWS, sh().maxR + 1);
    if (filled(x, y) && inside(x + dc, y + dr) && filled(x + dc, y + dr)) {
      while (inside(x + dc, y + dr) && filled(x + dc, y + dr)) { x += dc; y += dr; }
    } else {
      x += dc; y += dr;
      while (inside(x, y) && !filled(x, y)) { x += dc; y += dr; }
      if (!inside(x, y)) { x = dc < 0 ? 0 : dc > 0 ? Math.max(sh().maxC, c) : c; y = dr < 0 ? 0 : dr > 0 ? Math.max(sh().maxR, r) : r; }
    }
    return { c: Math.max(0, x), r: Math.max(0, y) };
  }
  function selectAll() { sel = { c: 0, r: 0, c1: 0, r1: 0, c2: Math.max(sh().maxC, 0), r2: Math.max(sh().maxR, 0) }; renderSelection(); }

  /* ---------- clipboard ---------- */
  function selTSV() {
    const n = norm();
    const lines = [];
    for (let r = n.r1; r <= Math.min(n.r2, Math.max(sh().maxR, n.r1)); r++) {
      const row = [];
      for (let c = n.c1; c <= Math.min(n.c2, Math.max(sh().maxC, n.c1)); c++) row.push(rawAt(c, r) ? formatValue(book.value(sh(), c, r), (cellAt(c, r) || {}).s || {}) : '');
      lines.push(row.join('\t'));
    }
    return lines.join('\n');
  }
  function selHTML() {
    const n = norm();
    let h = '<table>';
    for (let r = n.r1; r <= Math.min(n.r2, sh().maxR); r++) {
      h += '<tr>';
      for (let c = n.c1; c <= Math.min(n.c2, sh().maxC); c++) {
        const s = (cellAt(c, r) || {}).s || {};
        h += `<td style="${s.b ? 'font-weight:bold;' : ''}${s.fill ? 'background:' + s.fill + ';' : ''}">${esc(rawAt(c, r) ? formatValue(book.value(sh(), c, r), s) : '')}</td>`;
      }
      h += '</tr>';
    }
    return h + '</table>';
  }
  function doCopy(cut, e = null) {
    const n = norm();
    const cells = {};
    for (let r = n.r1; r <= n.r2 && r <= sh().maxR; r++) for (let c = n.c1; c <= n.c2 && c <= sh().maxC; c++) { const cell = cellAt(c, r); if (cell) cells[addr(c - n.c1, r - n.r1)] = JSON.parse(JSON.stringify(cell)); }
    const tsv = selTSV();
    clip = { sheet: book.active, ...n, cells, cut, tsv };
    if (e) { e.clipboardData.setData('text/plain', tsv); e.clipboardData.setData('text/html', selHTML()); e.preventDefault(); }
    else navigator.clipboard?.writeText(tsv).catch(() => {});
    renderSelection();
  }
  function pasteText(text) {
    const n = norm();
    record();
    const norm2 = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
    if (clip && clip.tsv === norm2) {
      const src = book.sheets[clip.sheet];
      const h = clip.r2 - clip.r1 + 1, w = clip.c2 - clip.c1 + 1;
      const dc = n.c1 - clip.c1, dr = n.r1 - clip.r1;
      if (clip.cut) for (let r = clip.r1; r <= clip.r2; r++) for (let c = clip.c1; c <= clip.c2; c++) delete src.cells[addr(c, r)];
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const cell = clip.cells[addr(c, r)];
        const a = addr(n.c1 + c, n.r1 + r);
        if (!cell) { delete sh().cells[a]; continue; }
        sh().cells[a] = { ...cell, v: clip.cut ? cell.v : shiftFormula(cell.v, dc, dr) };
      }
      sel = { c: n.c1, r: n.r1, c1: n.c1, r1: n.r1, c2: n.c1 + w - 1, r2: n.r1 + h - 1 };
      if (clip.cut) clip = null;
    } else {
      const rows = norm2.split('\n').map(l => l.split('\t'));
      rows.forEach((row, r) => row.forEach((v, c) => setCell(n.c1 + c, n.r1 + r, v)));
      sel = { c: n.c1, r: n.r1, c1: n.c1, r1: n.r1, c2: n.c1 + Math.max(...rows.map(r => r.length)) - 1, r2: n.r1 + rows.length - 1 };
    }
    book.updateBounds(sh());
    if (sh().maxR >= ROWS - 5 || sh().maxC >= COLS - 1) buildGrid(); else renderAll();
    setDirty();
  }
  async function pasteFromButton() {
    try { pasteText(await navigator.clipboard.readText()); }
    catch { if (clip) pasteText(clip.tsv); else msgDialog('Excel', 'Use Ctrl+V to paste from other apps.', 'info'); }
  }
  root.addEventListener('copy', (e) => { if (e.target === root) doCopy(false, e); });
  root.addEventListener('cut', (e) => { if (e.target === root) doCopy(true, e); });
  root.addEventListener('paste', (e) => {
    if (e.target !== root) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData('text/plain'));
  });

  /* ---------- fill ---------- */
  function seriesFor(values, count) {
    /* values: raw strings of the source run → produce `count` more */
    const nums = values.map(v => (v.startsWith('=') ? null : literal(v)));
    if (values.length && nums.every(n => typeof n === 'number')) {
      const step = values.length > 1 ? (nums[nums.length - 1] - nums[0]) / (nums.length - 1) : 0;
      return Array.from({ length: count }, (_, i) => String(parseFloat((nums[nums.length - 1] + step * (i + 1)).toFixed(10))));
    }
    const last = values[values.length - 1] || '';
    const listIdx = (list) => list.findIndex(x => x.toLowerCase() === last.toLowerCase() || x.slice(0, 3).toLowerCase() === last.toLowerCase());
    for (const list of [MONTHS, DAYS]) {
      const i = listIdx(list);
      if (i >= 0) {
        const short = last.length === 3;
        return Array.from({ length: count }, (_, k) => { const x = list[(i + k + 1) % list.length]; const y = short ? x.slice(0, 3) : x; return last === last.toUpperCase() ? y.toUpperCase() : y; });
      }
    }
    const m = /^(.*?)(\d+)$/.exec(last);
    if (m && !last.startsWith('=')) return Array.from({ length: count }, (_, i) => m[1] + (+m[2] + i + 1));
    return null;
  }
  function fillSeries(src, target) {
    record();
    const vertical = target.c1 === src.c1 && target.c2 === src.c2;
    if (vertical) {
      for (let c = src.c1; c <= src.c2; c++) {
        const values = []; for (let r = src.r1; r <= src.r2; r++) values.push(rawAt(c, r));
        const down = target.r2 > src.r2;
        const count = down ? target.r2 - src.r2 : src.r1 - target.r1;
        const series = down && !values.some(v => v.startsWith('=')) && !(values.length === 1 && typeof literal(values[0]) === 'number') ? seriesFor(values, count) : null;
        for (let i = 0; i < count; i++) {
          const r = down ? src.r2 + 1 + i : src.r1 - 1 - i;
          const srcR = down ? src.r1 + (i % values.length) : src.r2 - (i % values.length);
          const cell = cellAt(c, srcR);
          const raw = series ? series[i] : shiftFormula(rawAt(c, srcR), 0, r - srcR);
          sh().cells[addr(c, r)] = { ...(cell ? JSON.parse(JSON.stringify(cell)) : {}), v: raw };
          if (!raw && !(cell && cell.s)) delete sh().cells[addr(c, r)];
        }
      }
    } else {
      for (let r = src.r1; r <= src.r2; r++) {
        const values = []; for (let c = src.c1; c <= src.c2; c++) values.push(rawAt(c, r));
        const right = target.c2 > src.c2;
        const count = right ? target.c2 - src.c2 : src.c1 - target.c1;
        const series = right && !values.some(v => v.startsWith('=')) && !(values.length === 1 && typeof literal(values[0]) === 'number') ? seriesFor(values, count) : null;
        for (let i = 0; i < count; i++) {
          const c = right ? src.c2 + 1 + i : src.c1 - 1 - i;
          const srcC = right ? src.c1 + (i % values.length) : src.c2 - (i % values.length);
          const cell = cellAt(srcC, r);
          const raw = series ? series[i] : shiftFormula(rawAt(srcC, r), c - srcC, 0);
          sh().cells[addr(c, r)] = { ...(cell ? JSON.parse(JSON.stringify(cell)) : {}), v: raw };
          if (!raw && !(cell && cell.s)) delete sh().cells[addr(c, r)];
        }
      }
    }
    sel = { c: sel.c, r: sel.r, ...target };
    book.updateBounds(sh());
    setDirty();
    renderAll();
  }
  function fillDir(dir) {
    const n = norm();
    if (dir === 'down') { if (n.r2 === n.r1) { if (n.r1 === 0) return; fillSeries({ c1: n.c1, r1: n.r1 - 1, c2: n.c2, r2: n.r1 - 1 }, { ...n, r1: n.r1 - 1 }); } else fillSeries({ ...n, r2: n.r1 }, n); }
    else { if (n.c2 === n.c1) { if (n.c1 === 0) return; fillSeries({ c1: n.c1 - 1, r1: n.r1, c2: n.c1 - 1, r2: n.r2 }, { ...n, c1: n.c1 - 1 }); } else fillSeries({ ...n, c2: n.c1 }, n); }
  }

  /* ---------- formatting ---------- */
  function applyStyle(patch) {
    record();
    forEachSel((c, r) => {
      if (r > Math.max(sh().maxR, sel.r) + 1 && norm().r2 - norm().r1 > 500) return;
      const a = addr(c, r);
      const cell = sh().cells[a] || { v: '' };
      const s = { ...(cell.s || {}), ...patch };
      for (const k of Object.keys(s)) if (s[k] === undefined || s[k] === null || s[k] === false) delete s[k];
      sh().cells[a] = { ...cell, s: Object.keys(s).length ? s : undefined };
      if (!sh().cells[a].s) delete sh().cells[a].s;
      if (!sh().cells[a].v && !sh().cells[a].s) delete sh().cells[a];
    });
    setDirty();
    renderAll();
  }
  function toggleStyle(k) { const s = (cellAt(sel.c, sel.r) || {}).s || {}; applyStyle({ [k]: !s[k] }); }
  function clearSel(what) {
    record();
    forEachSel((c, r) => {
      const a = addr(c, r);
      const cell = sh().cells[a];
      if (!cell) return;
      if (what === 'all') delete sh().cells[a];
      else if (what === 'formats') { if (cell.v) sh().cells[a] = { v: cell.v }; else delete sh().cells[a]; }
      else { if (cell.s) sh().cells[a] = { v: '', s: cell.s }; else delete sh().cells[a]; }
    });
    setDirty();
    renderAll();
  }

  /* ---------- rows / columns ---------- */
  function shiftStructure(kind, at, count) {
    /* kind: 'row' | 'col'; count > 0 insert, < 0 delete */
    record();
    const target = sh();
    const isRow = kind === 'row';
    const moved = {};
    for (const [a, cell] of Object.entries(target.cells)) {
      const p = parseAddr(a);
      const idx = isRow ? p.r : p.c;
      if (count < 0 && idx >= at && idx < at - count) continue;
      const ni = idx >= at ? idx + count : idx;
      moved[isRow ? addr(p.c, ni) : addr(ni, p.r)] = cell;
    }
    target.cells = moved;
    if (!isRow) {
      const w = {};
      for (const [c, v] of Object.entries(target.colW)) { const ci = +c; if (count < 0 && ci >= at && ci < at - count) continue; w[ci >= at ? ci + count : ci] = v; }
      target.colW = w;
    }
    /* fix references in every sheet */
    for (const s of book.sheets) {
      for (const cell of Object.values(s.cells)) {
        if (!cell.v || cell.v[0] !== '=') continue;
        cell.v = '=' + mapRefs(cell.v.slice(1), (ref) => {
          const refSheet = ref.sheet ? book.sheetByName(ref.sheet) : s;
          if (refSheet !== target) return { c: ref.c, r: ref.r };
          const idx = isRow ? ref.r : ref.c;
          if (count < 0 && idx >= at && idx < at - count) return null;
          const ni = idx >= at ? idx + count : idx;
          return isRow ? { c: ref.c, r: ni } : { c: ni, r: ref.r };
        });
      }
    }
    book.astCache.clear();
    book.updateBounds(target);
    setDirty();
    buildGrid();
  }
  const insertRows = () => { const n = norm(); shiftStructure('row', n.r1, n.r2 - n.r1 + 1); };
  const insertCols = () => { const n = norm(); shiftStructure('col', n.c1, n.c2 - n.c1 + 1); };
  const deleteRows = () => { const n = norm(); shiftStructure('row', n.r1, -(Math.min(n.r2, Math.max(sh().maxR, n.r1)) - n.r1 + 1)); };
  const deleteCols = () => { const n = norm(); shiftStructure('col', n.c1, -(Math.min(n.c2, Math.max(sh().maxC, n.c1)) - n.c1 + 1)); };

  /* ---------- sort / dedupe ---------- */
  function currentRegion() {
    const n = norm();
    if (n.c1 !== n.c2 || n.r1 !== n.r2) return { ...n, r2: Math.min(n.r2, sh().maxR), c2: Math.min(n.c2, sh().maxC), explicit: true };
    let { c1, r1, c2, r2 } = n;
    let grew = true;
    const filledRow = (r, a, b) => { for (let c = a; c <= b; c++) if (rawAt(c, r)) return true; return false; };
    const filledCol = (c, a, b) => { for (let r = a; r <= b; r++) if (rawAt(c, r)) return true; return false; };
    while (grew) {
      grew = false;
      if (r1 > 0 && filledRow(r1 - 1, Math.max(0, c1 - 1), c2 + 1)) { r1--; grew = true; }
      if (filledRow(r2 + 1, Math.max(0, c1 - 1), c2 + 1)) { r2++; grew = true; }
      if (c1 > 0 && filledCol(c1 - 1, Math.max(0, r1 - 1), r2 + 1)) { c1--; grew = true; }
      if (filledCol(c2 + 1, Math.max(0, r1 - 1), r2 + 1)) { c2++; grew = true; }
    }
    return { c1, r1, c2, r2 };
  }
  function hasHeader(reg) {
    if (reg.r2 <= reg.r1) return false;
    const first = [], second = [];
    for (let c = reg.c1; c <= reg.c2; c++) { first.push(book.value(sh(), c, reg.r1)); second.push(book.value(sh(), c, reg.r1 + 1)); }
    return first.every(v => typeof v === 'string' || v == null) && first.some(v => typeof v === 'string') && second.some(v => typeof v === 'number' || v == null || typeof v === 'string') && JSON.stringify(first.map(x => typeof x)) !== JSON.stringify(second.map(x => typeof x));
  }
  function sortSel(dir) {
    const reg = currentRegion();
    const header = !reg.explicit && hasHeader(reg);
    const start = reg.r1 + (header ? 1 : 0);
    if (start > reg.r2) return;
    record();
    const key = Math.min(Math.max(sel.c, reg.c1), reg.c2);
    const rows = [];
    for (let r = start; r <= reg.r2; r++) {
      const cells = [];
      for (let c = reg.c1; c <= reg.c2; c++) cells.push(cellAt(c, r) ? JSON.parse(JSON.stringify(cellAt(c, r))) : null);
      let v = book.value(sh(), key, r);
      if (v && v.date != null) v = v.date;
      rows.push({ r, cells, v });
    }
    rows.sort((a, b) => {
      const x = a.v, y = b.v;
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      if (typeof x === 'number') return -1 * dir;
      if (typeof y === 'number') return 1 * dir;
      return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
    rows.forEach((row, i) => {
      const r = start + i;
      row.cells.forEach((cell, j) => {
        const a = addr(reg.c1 + j, r);
        if (cell) sh().cells[a] = { ...cell, v: shiftFormula(cell.v, 0, r - row.r) };
        else delete sh().cells[a];
      });
    });
    setDirty();
    renderAll();
  }
  function dedupe() {
    const reg = currentRegion();
    const header = !reg.explicit && hasHeader(reg);
    const start = reg.r1 + (header ? 1 : 0);
    record();
    const seen = new Set();
    const keep = [];
    for (let r = start; r <= reg.r2; r++) {
      const vals = [];
      for (let c = reg.c1; c <= reg.c2; c++) vals.push(rawAt(c, r) ? formatValue(book.value(sh(), c, r)) : '');
      const k = vals.join('\u0001').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      keep.push([...Array(reg.c2 - reg.c1 + 1)].map((_, j) => cellAt(reg.c1 + j, r) ? JSON.parse(JSON.stringify(cellAt(reg.c1 + j, r))) : null));
    }
    const removed = reg.r2 - start + 1 - keep.length;
    for (let r = start; r <= reg.r2; r++) for (let c = reg.c1; c <= reg.c2; c++) delete sh().cells[addr(c, r)];
    keep.forEach((cells, i) => cells.forEach((cell, j) => { if (cell) sh().cells[addr(reg.c1 + j, start + i)] = cell; }));
    book.updateBounds(sh());
    setDirty(); renderAll();
    msgDialog('Microsoft Excel', removed ? `${removed} duplicate value${removed === 1 ? '' : 's'} found and removed; ${keep.length} unique values remain.` : 'No duplicate values found.', 'info');
  }

  /* ---------- AutoSum & functions ---------- */
  function autoSum(fn) {
    if (editing) commitEdit();
    const n = norm();
    if (n.c1 !== n.c2 || n.r1 !== n.r2) {
      /* a range: put totals under each column */
      record();
      const below = Math.min(n.r2, sh().maxR) + 1;
      for (let c = n.c1; c <= n.c2; c++) setCell(c, below, `=${fn}(${addr(c, n.r1)}:${addr(c, below - 1)})`);
      book.updateBounds(sh());
      setDirty(); renderAll();
      select(n.c1, below); select(n.c2, below, true);
      return;
    }
    const isNum = (c, r) => { const v = rawAt(c, r) ? book.value(sh(), c, r) : null; return typeof v === 'number'; };
    let r = sel.r - 1;
    while (r >= 0 && isNum(sel.c, r)) r--;
    let range = null;
    if (r < sel.r - 1) range = `${addr(sel.c, r + 1)}:${addr(sel.c, sel.r - 1)}`;
    else {
      let c = sel.c - 1;
      while (c >= 0 && isNum(c, sel.r)) c--;
      if (c < sel.c - 1) range = `${addr(c + 1, sel.r)}:${addr(sel.c - 1, sel.r)}`;
    }
    startEdit('edit', `=${fn}(${range || ''})`);
    if (!range) { const L = edit.value.length - 1; edit.setSelectionRange(L, L); }
  }
  const FN_HELP = {
    SUM: 'Adds all the numbers in a range of cells.', AVERAGE: 'Returns the average (arithmetic mean) of its arguments.', COUNT: 'Counts the cells that contain numbers.',
    COUNTA: 'Counts the cells that are not empty.', MAX: 'Returns the largest value.', MIN: 'Returns the smallest value.', IF: 'Checks a condition and returns one value if TRUE, another if FALSE.',
    IFERROR: 'Returns a value you specify if a formula evaluates to an error.', VLOOKUP: 'Looks for a value in the leftmost column of a table and returns a value in the same row.',
    SUMIF: 'Adds the cells specified by a given condition.', COUNTIF: 'Counts the cells that meet a condition.', ROUND: 'Rounds a number to a specified number of digits.',
    CONCAT: 'Joins several text items into one.', TODAY: 'Returns today\'s date.', NOW: 'Returns the current date and time.', LEN: 'Returns the number of characters in a text string.',
    INDEX: 'Returns a value from a table by row and column number.', MATCH: 'Returns the position of an item in a range.', AND: 'TRUE if all arguments are TRUE.', OR: 'TRUE if any argument is TRUE.',
  };
  function insertFunctionDialog(preset = null) {
    const dlg = document.createElement('div');
    dlg.className = 'dlg xl-fndlg';
    dlg.innerHTML = `<div class="dlg-title">Insert Function</div><div class="dlg-body" style="display:block">
      <label>Search for a function:</label><input type="text" class="fn-q" placeholder="Type a description or a name" spellcheck="false">
      <div class="fn-list"></div><div class="fn-help"></div></div>
      <div class="dlg-footer"><button class="btn primary fn-ok">OK</button><button class="btn fn-cancel">Cancel</button></div>`;
    const list = dlg.querySelector('.fn-list'), help = dlg.querySelector('.fn-help'), q = dlg.querySelector('.fn-q');
    let chosen = preset || 'SUM';
    const render = () => {
      const t = q.value.trim().toUpperCase();
      const names = (preset ? preset.split(',') : FUNCTIONS).filter(n => !t || n.includes(t) || (FN_HELP[n] || '').toUpperCase().includes(t));
      if (!names.includes(chosen)) chosen = names[0];
      list.innerHTML = names.map(n => `<div class="fn-item ${n === chosen ? 'sel' : ''}" data-n="${n}">${n}</div>`).join('');
      help.innerHTML = chosen ? `<b>${chosen}(…)</b><br>${esc(FN_HELP[chosen] || 'Excel worksheet function.')}` : '';
    };
    let close;
    const ok = () => { close(); if (chosen) { if (editing) cancelEdit(); startEdit('edit', `=${chosen}(`); } };
    close = mountDialog(dlg, { onCancel: () => close(), onEnter: ok });
    list.addEventListener('click', (e) => { const it = e.target.closest('.fn-item'); if (it) { chosen = it.dataset.n; render(); } });
    list.addEventListener('dblclick', ok);
    q.addEventListener('input', render);
    dlg.querySelector('.fn-ok').addEventListener('click', ok);
    dlg.querySelector('.fn-cancel').addEventListener('click', () => close());
    render();
    setTimeout(() => q.focus(), 30);
  }
  const fnMenu = (btn, names) => {
    const r = btn.getBoundingClientRect();
    contextMenu(r.left, r.bottom + 2, names.map(n => ({ label: n, action: () => { if (editing) cancelEdit(); startEdit('edit', `=${n}(`); } })));
  };

  /* ---------- find ---------- */
  const fInput = findBar.querySelector('.nf-find'), rInput = findBar.querySelector('.nf-repl');
  function showFind(replace) {
    findBar.classList.remove('hidden');
    findBar.classList.toggle('with-replace', replace);
    fInput.focus(); fInput.select();
  }
  function findNext() {
    const q = fInput.value.toLowerCase();
    if (!q) return;
    const s = sh();
    const keys = Object.keys(s.cells).map(parseAddr).sort((a, b) => a.r - b.r || a.c - b.c);
    const text = (p) => (rawAt(p.c, p.r) + '\u0001' + formatValue(book.value(s, p.c, p.r), (cellAt(p.c, p.r) || {}).s || {})).toLowerCase();
    const after = keys.filter(p => p.r > sel.r || (p.r === sel.r && p.c > sel.c));
    const hit = [...after, ...keys].find(p => text(p).includes(q));
    if (hit) { select(hit.c, hit.r); findBar.querySelector('.nf-count').textContent = `${keys.filter(p => text(p).includes(q)).length} cell(s) found`; }
    else { findBar.querySelector('.nf-count').textContent = ''; msgDialog('Microsoft Excel', 'We couldn\'t find what you were looking for.', 'info'); }
  }
  function replaceAll() {
    const q = fInput.value;
    if (!q) return;
    record();
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let n = 0;
    for (const cell of Object.values(sh().cells)) {
      if (!cell.v) continue;
      const v = cell.v.replace(re, () => { n++; return rInput.value; });
      cell.v = v;
    }
    book.astCache.clear();
    setDirty(); renderAll();
    msgDialog('Microsoft Excel', `All done. We made ${n} replacement${n === 1 ? '' : 's'}.`, 'info');
  }
  findBar.querySelector('.nf-next').addEventListener('click', findNext);
  findBar.querySelector('.nf-all').addEventListener('click', replaceAll);
  findBar.querySelector('.nf-x').addEventListener('click', () => { findBar.classList.add('hidden'); root.focus(); });
  [fInput, rInput].forEach(i => i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); findNext(); } if (e.key === 'Escape') { findBar.classList.add('hidden'); root.focus(); } }));

  /* ---------- charts ---------- */
  function rangeRows(range, s = sh()) {
    const [a, b] = range.split(':').map(parseAddr);
    const rows = [];
    for (let r = a.r; r <= b.r; r++) {
      const row = [];
      for (let c = a.c; c <= b.c; c++) {
        let v = book.value(s, c, r);
        if (v && v.date != null) v = formatValue(v);
        row.push(isErr(v) ? null : v);
      }
      rows.push(row);
    }
    return rows;
  }
  function addChart(type) {
    const reg = currentRegion();
    if (!(reg.c2 > reg.c1 || reg.r2 > reg.r1) && !rawAt(reg.c1, reg.r1)) { msgDialog('Microsoft Excel', 'Select the data you want to chart first (for example a column of labels and a column of numbers).', 'info'); return; }
    record();
    const rc = rectOf(reg.c2, reg.r1, reg.c2, reg.r1) || { x: 200, y: 40, w: 0 };
    sh().charts.push({ id: 'ch' + Date.now(), type, range: `${addr(reg.c1, reg.r1)}:${addr(reg.c2, reg.r2)}`, x: rc.x + rc.w + 24, y: rc.y, w: 440, h: 270, title: 'Chart Title' });
    setDirty();
    renderCharts();
  }
  function renderCharts() {
    chartsEl.innerHTML = '';
    for (const ch of sh().charts || []) {
      const el = document.createElement('div');
      el.className = 'xl-chart';
      Object.assign(el.style, { left: ch.x + 'px', top: ch.y + 'px', width: ch.w + 'px', height: ch.h + 'px' });
      el.innerHTML = `<div class="xc-bar"><span>${esc(ch.title || '')}</span><button class="xc-btn xc-more" title="Chart options">${I.more}</button><button class="xc-btn xc-del" title="Delete chart">✕</button></div><canvas></canvas>`;
      chartsEl.appendChild(el);
      const canvas = el.querySelector('canvas');
      const draw = () => drawChart(canvas, ch.type, chartData(rangeRows(ch.range)), ch.title);
      requestAnimationFrame(draw);
      /* move */
      el.querySelector('.xc-bar').addEventListener('pointerdown', (e) => {
        if (e.target.closest('.xc-btn')) return;
        e.preventDefault(); e.stopPropagation();
        const sx = e.clientX, sy = e.clientY, ox = ch.x, oy = ch.y;
        const z = st.zoom / 100;
        const mv = (ev) => { ch.x = Math.max(HEAD_W, ox + (ev.clientX - sx) / z); ch.y = Math.max(ROW_H, oy + (ev.clientY - sy) / z); el.style.left = ch.x + 'px'; el.style.top = ch.y + 'px'; };
        const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); setDirty(); };
        document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
      });
      /* resize (CSS resize handle) */
      new ResizeObserver(() => {
        if (el.offsetWidth && (el.offsetWidth !== ch.w || el.offsetHeight !== ch.h)) { ch.w = el.offsetWidth; ch.h = el.offsetHeight; setDirty(); }
        draw();
      }).observe(el);
      el.querySelector('.xc-del').addEventListener('click', () => { record(); sh().charts = sh().charts.filter(x => x !== ch); setDirty(); renderCharts(); });
      const menu = (x, y) => contextMenu(x, y, [
        { label: 'Change Chart Type', submenu: ['column', 'bar', 'line', 'pie'].map(t => ({ label: t[0].toUpperCase() + t.slice(1), checked: ch.type === t, action: () => { ch.type = t; setDirty(); draw(); } })) },
        { label: 'Edit Title…', action: async () => { const t = await promptDialog('Chart Title', 'Title:', ch.title || ''); if (t != null) { ch.title = t; setDirty(); renderCharts(); } } },
        { label: `Data range: ${ch.range}`, action: async () => { const t = await promptDialog('Select Data', 'Chart data range:', ch.range, '', { validate: (v) => (/^[A-Za-z]{1,3}\d+:[A-Za-z]{1,3}\d+$/.test(v) ? null : 'Use a range like A1:C10') }); if (t) { ch.range = t.toUpperCase(); setDirty(); draw(); } } },
        '-',
        { label: 'Save as Picture…', icon: I.photos, action: () => {
          const node = addNode(KNOWN.pictures, makeFile(uniqueName(KNOWN.pictures, `${(ch.title || 'Chart').replace(/[\\/:*?"<>|]/g, '')}.png`), 'img', canvas.toDataURL('image/png')));
          notify('Excel', `Chart saved to Pictures\\${node.name}`, I.excel, { onClick: () => launch('photos', { path: [...KNOWN.pictures, node.name] }) });
        } },
        { label: 'Delete Chart', icon: I.trash, action: () => { record(); sh().charts = sh().charts.filter(x => x !== ch); setDirty(); renderCharts(); } },
      ]);
      el.querySelector('.xc-more').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom); });
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); menu(e.clientX, e.clientY); });
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
  }

  /* ---------- sheets ---------- */
  function renderTabs() {
    const box = root.querySelector('.xl-sheettabs');
    box.innerHTML = '';
    book.sheets.forEach((s, i) => {
      const t = document.createElement('div');
      t.className = 'xl-stab' + (i === book.active ? ' sel' : '');
      t.textContent = s.name;
      t.addEventListener('click', () => switchSheet(i));
      t.addEventListener('dblclick', () => renameSheet(i));
      t.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY - 160, [
          { label: 'Insert sheet', action: addSheet },
          { label: 'Delete', disabled: book.sheets.length < 2, action: () => deleteSheet(i) },
          { label: 'Rename', action: () => renameSheet(i) },
          { label: 'Move left', disabled: i === 0, action: () => moveSheet(i, -1) },
          { label: 'Move right', disabled: i === book.sheets.length - 1, action: () => moveSheet(i, 1) },
        ]);
      });
      box.appendChild(t);
    });
  }
  function switchSheet(i) {
    if (editing) commitEdit();
    book.active = i;
    sel = { c: 0, r: 0, c1: 0, r1: 0, c2: 0, r2: 0 };
    wrap.scrollTop = 0; wrap.scrollLeft = 0;
    buildGrid(); renderTabs();
    root.focus({ preventScroll: true });
  }
  function addSheet() {
    record();
    let n = book.sheets.length + 1;
    while (book.sheetByName('Sheet' + n)) n++;
    book.sheets.push(newSheet('Sheet' + n));
    setDirty();
    switchSheet(book.sheets.length - 1);
  }
  async function deleteSheet(i) {
    const s = book.sheets[i];
    if (Object.keys(s.cells).length && !(await dialog({ title: 'Microsoft Excel', bodyHTML: `Microsoft Excel will permanently delete this sheet. Do you want to continue?`, icon: 'warn', buttons: [{ label: 'Delete', primary: true, value: true }, { label: 'Cancel', value: false }], cancelValue: false }))) return;
    record();
    book.sheets.splice(i, 1);
    book.active = Math.min(book.active, book.sheets.length - 1);
    book.invalidate(); book.astCache.clear();
    setDirty();
    switchSheet(book.active);
  }
  async function renameSheet(i) {
    const s = book.sheets[i];
    const n = await promptDialog('Rename Sheet', 'Sheet name:', s.name, '', {
      validate: (v) => (!v ? 'Enter a name' : v.length > 31 ? 'Use 31 characters or fewer' : /[\\/?*[\]:]/.test(v) ? 'A sheet name can\'t contain \\ / ? * [ ] :' : book.sheets.some((x, j) => j !== i && x.name.toLowerCase() === v.toLowerCase()) ? 'That name is already taken' : null),
    });
    if (!n || n === s.name) return;
    record();
    const old = s.name;
    s.name = n;
    /* update references to the renamed sheet */
    const quote = (x) => (/^[A-Za-z_][\w.]*$/.test(x) ? x : `'${x.replace(/'/g, "''")}'`);
    for (const sx of book.sheets) for (const cell of Object.values(sx.cells)) {
      if (cell.v && cell.v[0] === '=') cell.v = cell.v.replace(new RegExp(`(^|[^\\w'])(${quote(old).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})!`, 'gi'), (m, p) => p + quote(n) + '!');
    }
    book.astCache.clear();
    setDirty(); renderTabs(); renderAll();
  }
  function moveSheet(i, d) {
    record();
    const [s] = book.sheets.splice(i, 1);
    book.sheets.splice(i + d, 0, s);
    if (book.active === i) book.active = i + d; else if (book.active === i + d) book.active = i;
    setDirty(); renderTabs();
  }
  root.querySelector('.xl-addsheet').addEventListener('click', addSheet);

  /* ---------- files ---------- */
  async function loadPath(path) {
    const node = path && getNode(path);
    if (!node) return;
    const ext = extOf(node.name);
    try {
      if (!node.content) book = new Book();
      else if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        const s = newSheet(node.name.replace(/\.[^.]+$/, '').slice(0, 31));
        const text = node.content.startsWith('data:') ? new TextDecoder().decode(dataURLToBytes(node.content)) : node.content;
        parseCSV(text).forEach((row, r) => row.forEach((v, c) => { if (v !== '') s.cells[addr(c, r)] = { v }; }));
        book = new Book([s]);
      } else book = await readXlsx(dataURLToBytes(node.content));
    } catch (e) {
      msgDialog('Microsoft Excel', `Excel cannot open the file '${esc(node.name)}' because the file format or file extension is not valid.<br><br><small>${esc(e.message || e)}</small>`, 'error');
      book = new Book();
    }
    book.active = book.active || 0;
    book.sheets.forEach(s => book.updateBounds(s));
    st.path = canonical(path);
    st.dirty = false;
    undoStack = []; redoStack = [];
    sel = { c: 0, r: 0, c1: 0, r1: 0, c2: 0, r2: 0 };
    buildGrid(); renderTabs(); refreshTitle();
    root.focus();
  }

  async function save(as = false) {
    if (editing) commitEdit();
    let path = st.path;
    if (path && !/^(xlsx|csv)$/i.test(extOf(path[path.length - 1]))) path = null;
    if (!path || as) {
      path = await fileDialog({
        mode: 'save', title: 'Save As', startDir: st.path ? st.path.slice(0, -1) : KNOWN.documents,
        defaultName: (st.path ? docName() : st.untitled).replace(/\.[^.]+$/, '') + '.xlsx', defaultExt: 'xlsx', filterLabel: 'Excel Workbook (*.xlsx)', kinds: ['sheet'],
      });
      if (!path) return false;
    }
    if (extOf(path[path.length - 1]) === 'csv') {
      if (book.sheets.length > 1 || Object.values(sh().cells).some(c => c.s) || (sh().charts || []).length) {
        const ok = await dialog({ title: 'Microsoft Excel', icon: 'warn', bodyHTML: 'Some features in your workbook might be lost if you save it as CSV (Comma delimited) — only the active sheet\'s values are kept.<br><br>Do you want to keep using that format?', buttons: [{ label: 'Yes', primary: true, value: true }, { label: 'No', value: false }], cancelValue: false });
        if (!ok) return false;
      }
      writeFile(path, toCSV(book, sh()), 'sheet');
    } else {
      const bytes = writeXlsx(book, { charts: book.sheets.map(s => s.charts || []) });
      writeFile(path, toDataURL(bytes, XLSX_MIME), 'sheet');
    }
    st.path = canonical(path);
    st.dirty = false;
    refreshTitle();
    return true;
  }
  async function confirmDiscard() {
    if (editing) commitEdit();
    if (!st.dirty) return true;
    win.focus();
    const choice = await dialog({
      title: 'Microsoft Excel',
      bodyHTML: `<div class="np-save-q xl-q">Want to save your changes to '${esc(docName())}'?</div>`,
      buttons: [{ label: 'Save', primary: true, value: 'save' }, { label: "Don't Save", value: 'discard' }, { label: 'Cancel', value: 'cancel' }],
      cancelValue: 'cancel',
    });
    if (choice === 'save') return save(false);
    return choice === 'discard';
  }
  win.beforeClose(confirmDiscard);
  async function openFile() {
    const path = await fileDialog({ mode: 'open', title: 'Open', startDir: st.path ? st.path.slice(0, -1) : KNOWN.documents, kinds: ['sheet'], filterLabel: 'All Excel Files (*.xlsx; *.csv)' });
    if (!path) return;
    if (st.dirty || st.path) launch('excel', { path, newWindow: true });
    else loadPath(path);
  }
  function print() {
    if (editing) commitEdit();
    const s = sh();
    book.updateBounds(s);
    let h = '<table>';
    for (let r = 0; r <= s.maxR; r++) {
      h += '<tr>';
      for (let c = 0; c <= s.maxC; c++) {
        const cell = cellAt(c, r);
        const sty = (cell && cell.s) || {};
        const v = cell && cell.v ? book.value(s, c, r) : null;
        const num = typeof v === 'number' || (v && v.date != null);
        h += `<td style="text-align:${sty.align || (num ? 'right' : 'left')};${sty.b ? 'font-weight:bold;' : ''}${sty.i ? 'font-style:italic;' : ''}${sty.fill ? 'background:' + sty.fill + ';' : ''}${sty.color ? 'color:' + sty.color + ';' : ''}">${esc(cell && cell.v ? formatValue(v, sty) : '')}</td>`;
      }
      h += '</tr>';
    }
    h += '</table>';
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(fr);
    fr.contentDocument.write(`<!doctype html><title>${esc(docName())}</title><style>@page{margin:0.7in}body{font:10pt Calibri,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}table{border-collapse:collapse}td{border:1px solid #bbb;padding:2px 6px;white-space:nowrap}</style>${h}`);
    fr.contentDocument.close();
    setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 1500); }, 150);
  }

  /* ---------- ribbon ---------- */
  const colorPicker = (btn, colors, cb, noneLabel) => {
    const r = btn.getBoundingClientRect();
    contextMenu(r.left, r.bottom + 2, [
      ...(noneLabel ? [{ label: noneLabel, action: () => cb(null) }] : []),
      ...colors.map(c => ({ label: c.toUpperCase(), icon: `<span style="display:block;width:14px;height:14px;background:${c};border:1px solid #999"></span>`, action: () => cb(c) })),
      { label: 'More Colors…', action: () => { const i = document.createElement('input'); i.type = 'color'; i.addEventListener('input', () => cb(i.value)); i.click(); } },
    ]);
  };
  const currentStyle = () => (cellAt(sel.c, sel.r) || {}).s || {};
  const commands = {
    paste: pasteFromButton, cut: () => doCopy(true), copy: () => doCopy(false), undo, redo,
    b: () => toggleStyle('b'), i: () => toggleStyle('i'), u: () => toggleStyle('u'),
    fill: () => applyStyle({ fill: st.fill }),
    fillPick: (btn) => colorPicker(btn, FILLS, (c) => { if (c) { st.fill = c; root.querySelector('.fl-bar').style.background = c; } applyStyle({ fill: c }); }, 'No Fill'),
    color: () => applyStyle({ color: st.color }),
    colorPick: (btn) => colorPicker(btn, FONT_COLORS, (c) => { if (c) { st.color = c; root.querySelector('.fc-bar').style.background = c; } applyStyle({ color: c }); }, 'Automatic'),
    grow: () => applyStyle({ size: Math.min(36, (currentStyle().size || 11) + 1) }),
    shrink: () => applyStyle({ size: Math.max(6, (currentStyle().size || 11) - 1) }),
    wrap: () => applyStyle({ wrap: !currentStyle().wrap }),
    left: () => applyStyle({ align: currentStyle().align === 'left' ? null : 'left' }),
    center: () => applyStyle({ align: currentStyle().align === 'center' ? null : 'center' }),
    right: () => applyStyle({ align: currentStyle().align === 'right' ? null : 'right' }),
    merge: () => applyStyle({ align: 'center' }),
    'fmt-currency': () => applyStyle({ fmt: 'currency', dec: 2 }),
    'fmt-percent': () => applyStyle({ fmt: 'percent', dec: 0 }),
    'fmt-comma': () => applyStyle({ fmt: 'number', dec: 2 }),
    decInc: () => applyStyle({ fmt: currentStyle().fmt || 'number', dec: Math.min(10, (currentStyle().dec ?? (currentStyle().fmt === 'percent' ? 0 : 0)) + 1) }),
    decDec: () => applyStyle({ fmt: currentStyle().fmt || 'number', dec: Math.max(0, (currentStyle().dec ?? 2) - 1) }),
    insertMenu: (btn) => { const r = btn.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, [{ label: 'Insert Sheet Rows', action: insertRows }, { label: 'Insert Sheet Columns', action: insertCols }, { label: 'Insert Sheet', action: addSheet }]); },
    deleteMenu: (btn) => { const r = btn.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, [{ label: 'Delete Sheet Rows', action: deleteRows }, { label: 'Delete Sheet Columns', action: deleteCols }, { label: 'Delete Sheet', disabled: book.sheets.length < 2, action: () => deleteSheet(book.active) }]); },
    clearMenu: (btn) => { const r = btn.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, [{ label: 'Clear All', action: () => clearSel('all') }, { label: 'Clear Formats', action: () => clearSel('formats') }, { label: 'Clear Contents', hint: 'Del', action: () => clearSel('contents') }]); },
    autosum: (btn) => { const r = btn.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, [['SUM', 'Sum'], ['AVERAGE', 'Average'], ['COUNT', 'Count Numbers'], ['MAX', 'Max'], ['MIN', 'Min']].map(([f, l]) => ({ label: l, action: () => autoSum(f) })).concat(['-', { label: 'More Functions…', action: () => insertFunctionDialog() }])); },
    sortMenu: (btn) => { const r = btn.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, [{ label: 'Sort A to Z', action: () => sortSel(1) }, { label: 'Sort Z to A', action: () => sortSel(-1) }]); },
    sortAZ: () => sortSel(1), sortZA: () => sortSel(-1), dedupe,
    find: () => showFind(false),
    'chart-column': () => addChart('column'), 'chart-bar': () => addChart('bar'), 'chart-line': () => addChart('line'), 'chart-pie': () => addChart('pie'),
    insFunc: () => insertFunctionDialog(),
    insDate: () => { record(); setCell(sel.c, sel.r, '=TODAY()'); setDirty(); renderAll(); },
    fnMath: (btn) => fnMenu(btn, ['SUM', 'PRODUCT', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'INT', 'ABS', 'SQRT', 'POWER', 'MOD', 'PI', 'RAND', 'RANDBETWEEN', 'SUMIF', 'AVERAGE', 'MEDIAN', 'STDEV', 'LARGE', 'SMALL']),
    fnText: (btn) => fnMenu(btn, ['CONCAT', 'LEFT', 'RIGHT', 'MID', 'LEN', 'UPPER', 'LOWER', 'PROPER', 'TRIM', 'SUBSTITUTE', 'REPT', 'TEXT', 'VALUE']),
    fnLogic: (btn) => fnMenu(btn, ['IF', 'IFERROR', 'AND', 'OR', 'NOT', 'ISBLANK', 'ISNUMBER', 'ISTEXT', 'ISERROR', 'COUNTIF']),
    fnLookup: (btn) => fnMenu(btn, ['VLOOKUP', 'HLOOKUP', 'INDEX', 'MATCH']),
    showFormulas: () => { st.showFormulas = !st.showFormulas; renderAll(); },
    calc: () => renderAll(),
    importCSV: () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.csv,.tsv,.txt,text/csv';
      inp.addEventListener('change', async () => {
        const f = inp.files[0]; if (!f) return;
        record();
        const rows = parseCSV(await f.text());
        rows.forEach((row, r) => row.forEach((v, c) => setCell(sel.c + c, sel.r + r, v)));
        book.updateBounds(sh()); setDirty(); buildGrid();
      });
      inp.click();
    },
    freezeRow: () => { root.classList.toggle('freeze-row'); updateRibbon(); },
    freezeCol: () => { root.classList.toggle('freeze-col'); updateRibbon(); },
    zoomIn: () => setZoom(st.zoom + 10), zoomOut: () => setZoom(st.zoom - 10), zoom100: () => setZoom(100),
  };
  root.querySelectorAll('.wd-ribbon [data-c]').forEach(b => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { if (editing && !['insFunc', 'fnMath', 'fnText', 'fnLogic', 'fnLookup'].includes(b.dataset.c)) commitEdit(); commands[b.dataset.c] && commands[b.dataset.c](b); if (!editing) root.focus({ preventScroll: true }); });
  });
  root.querySelector('.xl-fmt').addEventListener('change', (e) => { const f = e.target.value; applyStyle({ fmt: f === 'general' ? null : f, dec: f === 'percent' ? 0 : f === 'number' || f === 'currency' ? 2 : null }); root.focus(); });
  root.querySelectorAll('.rb-check input').forEach(cb => cb.addEventListener('change', () => {
    const v = cb.dataset.v;
    if (v === 'grid') root.classList.toggle('no-grid', !cb.checked);
    if (v === 'heads') root.classList.toggle('no-heads', !cb.checked);
    if (v === 'formulaBar') root.querySelector('.xl-fbar').classList.toggle('hidden', !cb.checked);
    renderSelection();
  }));
  root.querySelector('.fl-bar').style.background = st.fill;
  root.querySelector('.fc-bar').style.background = st.color;

  root.querySelectorAll('.wd-tab').forEach(t => t.addEventListener('click', () => {
    if (t.dataset.t === 'file') { fileMenu(t); return; }
    root.querySelectorAll('.wd-tab').forEach(x => x.classList.toggle('sel', x === t));
    root.querySelectorAll('.wd-pane').forEach(p => p.classList.toggle('hidden', p.dataset.p !== t.dataset.t));
  }));
  function fileMenu(t) {
    const r = t.getBoundingClientRect();
    contextMenu(r.left, r.bottom, [
      { label: 'New blank workbook', hint: 'Ctrl+N', icon: I.file, action: () => launch('excel') },
      { label: 'Open…', hint: 'Ctrl+O', icon: I.open, action: openFile },
      '-',
      { label: 'Save', hint: 'Ctrl+S', icon: I.save, action: () => save(false) },
      { label: 'Save As…', hint: 'F12', action: () => save(true) },
      { label: 'Download a copy (.xlsx)', icon: I.download, action: async () => { if (await save(false)) downloadNode(getNode(st.path)); } },
      '-',
      { label: 'Print…', hint: 'Ctrl+P', action: print },
      '-',
      { label: 'Open file location', icon: I.folder, disabled: !st.path, action: () => launch('explorer', { path: st.path.slice(0, -1) }) },
      { label: 'Close', action: () => win.close() },
    ]);
  }

  function setZoom(z) {
    st.zoom = Math.max(50, Math.min(200, z));
    zoomEl.style.zoom = st.zoom / 100;
    root.querySelector('.ws-zoom').value = st.zoom;
    root.querySelector('.ws-zv').textContent = st.zoom + '%';
  }
  root.querySelector('.ws-zoom').addEventListener('input', (e) => setZoom(+e.target.value));
  root.querySelectorAll('.ws-z').forEach(b => b.addEventListener('click', () => setZoom(st.zoom + (b.dataset.z === '+' ? 10 : -10))));
  wrap.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(st.zoom + (e.deltaY < 0 ? 10 : -10)); } }, { passive: false });
  wrap.addEventListener('scroll', () => {
    if (wrap.scrollTop + wrap.clientHeight > wrap.scrollHeight - 300) addRows(50);
    if (wrap.scrollLeft + wrap.clientWidth > wrap.scrollWidth - 200 && COLS < 200) addCols(10);
  });

  /* drop a workbook / csv from Explorer or your PC */
  root.addEventListener('dragover', (e) => { if (dragKind(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  root.addEventListener('drop', async (e) => {
    const k = dragKind(e);
    if (!k) return;
    e.preventDefault();
    if (k === 'internal') {
      const p = currentDrag();
      if (p && p.names[0]) { const path = [...p.dir, p.names[0]]; if (!st.dirty && !st.path) loadPath(path); else launch('excel', { path, newWindow: true }); }
    } else {
      const f = e.dataTransfer.files[0];
      if (!f) return;
      if (/\.(xlsx|csv|tsv)$/i.test(f.name)) {
        const { importFiles } = await import('../fileops.js');
        const names = await importFiles(KNOWN.documents, [f]);
        if (names[0]) loadPath([...KNOWN.documents, names[0]]);
      }
    }
  });

  root.addEventListener('focus', () => { if (editing) (editing.from === 'bar' ? fbar : edit).focus(); });
  win.onclose(() => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); });
  win.onRelaunch = null;

  buildGrid();
  renderTabs();
  refreshTitle();
  if (arg && arg.path) loadPath(arg.path);
  setTimeout(() => root.focus({ preventScroll: true }), 60);
  return win;
}

function alignIcon(t) {
  const lines = { l: [[4, 20], [4, 14], [4, 20], [4, 12]], c: [[4, 20], [7, 17], [4, 20], [8, 16]], r: [[4, 20], [10, 20], [4, 20], [12, 20]] }[t];
  return `<svg viewBox="0 0 24 24">${lines.map(([a, b], i) => `<path d="M${a} ${6 + i * 4} H${b}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`).join('')}</svg>`;
}
function chartIcon(t) {
  if (t === 'pie') return '<svg viewBox="0 0 24 24"><path d="M12 3 A9 9 0 1 0 21 12 H12 Z" fill="#4472C4"/><path d="M13.5 1.5 A9 9 0 0 1 22.5 10.5 H13.5 Z" fill="#ED7D31"/></svg>';
  if (t === 'line') return '<svg viewBox="0 0 24 24"><path d="M3 18 L8 11 L13 14 L21 5" fill="none" stroke="#4472C4" stroke-width="2"/><path d="M3 21 H21" stroke="currentColor" stroke-width="1.2"/></svg>';
  if (t === 'bar') return '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="14" height="4" fill="#4472C4"/><rect x="3" y="10" width="18" height="4" fill="#ED7D31"/><rect x="3" y="16" width="9" height="4" fill="#4472C4"/></svg>';
  return '<svg viewBox="0 0 24 24"><rect x="4" y="10" width="4" height="10" fill="#4472C4"/><rect x="10" y="5" width="4" height="15" fill="#ED7D31"/><rect x="16" y="13" width="4" height="7" fill="#4472C4"/><path d="M2 20.5 H22" stroke="currentColor" stroke-width="1.2"/></svg>';
}
