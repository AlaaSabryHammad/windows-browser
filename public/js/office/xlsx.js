/* .xlsx ⇄ Book. The writer produces a real SpreadsheetML workbook that opens in Microsoft Excel / LibreOffice / Google Sheets. */
import { zip, unzip, xmlEsc, parseXML, kids, kid, all, attr, fromUtf8 } from './zip.js';
import { Book, newSheet, addr, parseAddr, isErr, literal, shiftFormula, fmtFromCode } from './formula.js';
import { toHex } from './docx.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const PX_PER_CHAR = 7;

/* ---------------- write ---------------- */
function numFmtCode(st) {
  const dec = st.dec ?? 2;
  const d = dec > 0 ? '.' + '0'.repeat(dec) : '';
  switch (st.fmt) {
    case 'number': return (st.grouping === false ? '0' : '#,##0') + d;
    case 'currency': return `"${st.sym || '$'}"#,##0${d}`;
    case 'percent': return '0' + (st.dec ? '.' + '0'.repeat(st.dec) : '') + '%';
    case 'date': return 'm/d/yyyy';
    case 'time': return 'h:mm AM/PM';
    case 'text': return '@';
  }
  return st.dec != null ? '0' + d : null;
}

export function writeXlsx(book, extra = null) {
  /* styles */
  const fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const numFmts = [];   /* {id, code} */
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const xfIndex = new Map();
  const fontIndex = new Map(), fillIndex = new Map(), fmtIndex = new Map();

  function styleId(st) {
    if (!st) return 0;
    const key = JSON.stringify(st);
    if (xfIndex.has(key)) return xfIndex.get(key);
    let fontId = 0;
    if (st.b || st.i || st.u || st.color || st.size) {
      const color = toHex(st.color);
      const fk = `${!!st.b}${!!st.i}${!!st.u}${color}${st.size || 11}`;
      if (!fontIndex.has(fk)) {
        fontIndex.set(fk, fonts.length);
        fonts.push(`<font>${st.b ? '<b/>' : ''}${st.i ? '<i/>' : ''}${st.u ? '<u/>' : ''}<sz val="${st.size || 11}"/>${color ? `<color rgb="FF${color}"/>` : ''}<name val="Calibri"/><family val="2"/></font>`);
      }
      fontId = fontIndex.get(fk);
    }
    let fillId = 0;
    const fill = toHex(st.fill);
    if (fill) {
      if (!fillIndex.has(fill)) {
        fillIndex.set(fill, fills.length);
        fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${fill}"/><bgColor indexed="64"/></patternFill></fill>`);
      }
      fillId = fillIndex.get(fill);
    }
    let numFmtId = 0;
    const code = numFmtCode(st);
    if (code) {
      const builtin = { '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, 'm/d/yyyy': 14, '@': 49 }[code];
      if (builtin != null) numFmtId = builtin;
      else {
        if (!fmtIndex.has(code)) { fmtIndex.set(code, 164 + numFmts.length); numFmts.push({ id: 164 + numFmts.length, code }); }
        numFmtId = fmtIndex.get(code);
      }
    }
    const align = st.align || st.wrap ? `<alignment${st.align ? ` horizontal="${st.align}"` : ''}${st.wrap ? ' wrapText="1"' : ''}/>` : '';
    const id = xfs.length;
    xfs.push(`<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}${fillId ? ' applyFill="1"' : ''}${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`);
    xfIndex.set(key, id);
    return id;
  }

  const sheetFiles = book.sheets.map((sh, idx) => {
    book.updateBounds(sh);
    const byRow = new Map();
    for (const [a, cell] of Object.entries(sh.cells)) {
      if (!cell || (cell.v === '' && !cell.s)) continue;
      const p = parseAddr(a);
      if (!byRow.has(p.r)) byRow.set(p.r, []);
      byRow.get(p.r).push({ p, a, cell });
    }
    let data = '';
    for (const r of [...byRow.keys()].sort((x, y) => x - y)) {
      const cells = byRow.get(r).sort((x, y) => x.p.c - y.p.c);
      data += `<row r="${r + 1}">`;
      for (const { a, cell, p } of cells) {
        const s = styleId(cell.s);
        const sAttr = s ? ` s="${s}"` : '';
        const raw = cell.v || '';
        if (raw.startsWith('=') && raw.length > 1) {
          let v = book.value(sh, p.c, p.r);
          if (v && v.date != null) v = v.date;
          const f = `<f>${xmlEsc(raw.slice(1))}</f>`;
          if (isErr(v)) data += `<c r="${a}"${sAttr} t="e">${f}<v>${xmlEsc(v.error)}</v></c>`;
          else if (typeof v === 'number') data += `<c r="${a}"${sAttr}>${f}<v>${v}</v></c>`;
          else if (typeof v === 'boolean') data += `<c r="${a}"${sAttr} t="b">${f}<v>${v ? 1 : 0}</v></c>`;
          else data += `<c r="${a}"${sAttr} t="str">${f}<v>${xmlEsc(v == null ? '' : v)}</v></c>`;
          continue;
        }
        let v = literal(raw);
        if (v && v.date != null) {
          v = v.date;
          if (!cell.s || !cell.s.fmt) { const ds = styleId({ ...(cell.s || {}), fmt: 'date' }); data += `<c r="${a}" s="${ds}"><v>${v}</v></c>`; continue; }
        }
        if (v == null) data += `<c r="${a}"${sAttr}/>`;
        else if (typeof v === 'number') data += `<c r="${a}"${sAttr}><v>${v}</v></c>`;
        else if (typeof v === 'boolean') data += `<c r="${a}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
        else if (isErr(v)) data += `<c r="${a}"${sAttr} t="e"><v>${xmlEsc(v.error)}</v></c>`;
        else data += `<c r="${a}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
      }
      data += '</row>';
    }
    const widths = Object.entries(sh.colW || {}).sort((a, b) => a[0] - b[0]);
    const cols = widths.length ? `<cols>${widths.map(([c, w]) => `<col min="${+c + 1}" max="${+c + 1}" width="${(w / PX_PER_CHAR).toFixed(2)}" customWidth="1"/>`).join('')}</cols>` : '';
    const dim = sh.maxR || sh.maxC ? `A1:${addr(sh.maxC, sh.maxR)}` : 'A1';
    return {
      name: `xl/worksheets/sheet${idx + 1}.xml`,
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="${dim}"/><sheetViews><sheetView workbookViewId="0"${idx === (book.active || 0) ? ' tabSelected="1"' : ''}/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${data}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`,
    };
  });

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}">${numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map(f => `<numFmt numFmtId="${f.id}" formatCode="${xmlEsc(f.code)}"/>`).join('')}</numFmts>` : ''}<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${book.active || 0}"/></bookViews><sheets>${book.sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;

  const n = book.sheets.length;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${book.sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="json" ContentType="application/json"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${book.sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const files = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/styles.xml', data: stylesXml },
    ...sheetFiles,
  ];
  /* things SpreadsheetML can't hold simply (charts) ride along in an unreferenced part that Office ignores */
  if (extra) files.push({ name: 'xl/webwin.json', data: JSON.stringify(extra) });
  return zip(files);
}

/* ---------------- read ---------------- */
const BUILTIN_FMT = { 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 5: '"$"#,##0', 6: '"$"#,##0', 7: '"$"#,##0.00', 8: '"$"#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm', 49: '@' };

export async function readXlsx(bytes) {
  const files = await unzip(bytes);
  const wb = parseXML(files.get('xl/workbook.xml'));
  if (!wb) throw new Error('This file is not an Excel workbook.');
  const rels = {};
  for (const r of all(parseXML(files.get('xl/_rels/workbook.xml.rels')), 'Relationship')) rels[attr(r, 'Id')] = attr(r, 'Target');

  const shared = all(parseXML(files.get('xl/sharedStrings.xml')), 'si').map(si => all(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join(''));

  /* styles → cell style objects */
  const st = parseXML(files.get('xl/styles.xml'));
  const customFmt = {};
  for (const f of all(st, 'numFmt')) customFmt[attr(f, 'numFmtId')] = attr(f, 'formatCode');
  const fontsEl = kid(all(st, 'fonts')[0], 'font') ? kids(all(st, 'fonts')[0], 'font') : [];
  const fills = all(st, 'fills')[0] ? kids(all(st, 'fills')[0], 'fill') : [];
  const xfs = all(st, 'cellXfs')[0] ? kids(all(st, 'cellXfs')[0], 'xf') : [];
  const rgb = (el) => { const v = attr(el, 'rgb'); return v && v.length >= 6 ? '#' + v.slice(-6) : null; };
  const styleOf = xfs.map(x => {
    const s = {};
    const font = fontsEl[+attr(x, 'fontId') || 0];
    if (font) {
      if (kid(font, 'b') && attr(kid(font, 'b'), 'val') !== '0') s.b = true;
      if (kid(font, 'i') && attr(kid(font, 'i'), 'val') !== '0') s.i = true;
      if (kid(font, 'u') && attr(kid(font, 'u'), 'val') !== 'none') s.u = true;
      const c = rgb(kid(font, 'color'));
      if (c && c !== '#000000') s.color = c;
    }
    const fill = fills[+attr(x, 'fillId') || 0];
    const pf = kid(fill, 'patternFill');
    if (pf && attr(pf, 'patternType') === 'solid') { const c = rgb(kid(pf, 'fgColor')); if (c) s.fill = c; }
    const id = +attr(x, 'numFmtId') || 0;
    if (id) Object.assign(s, fmtFromCode(customFmt[id] || BUILTIN_FMT[id] || ''));
    if (s.fmt === 'general') delete s.fmt;
    const al = kid(x, 'alignment');
    if (al && ['left', 'center', 'right'].includes(attr(al, 'horizontal'))) s.align = attr(al, 'horizontal');
    if (al && attr(al, 'wrapText') === '1') s.wrap = true;
    return Object.keys(s).length ? s : null;
  });

  const sheets = [];
  for (const sEl of all(wb, 'sheet')) {
    const name = attr(sEl, 'name');
    let target = rels[attr(sEl, 'id')] || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const doc = parseXML(files.get(target));
    const sh = newSheet(name);
    if (!doc) { sheets.push(sh); continue; }
    for (const col of all(doc, 'col')) {
      const w = +attr(col, 'width');
      if (!w) continue;
      for (let c = +attr(col, 'min') - 1; c <= Math.min(+attr(col, 'max') - 1, 60); c++) sh.colW[c] = Math.round(w * PX_PER_CHAR);
    }
    const sharedF = {};
    for (const c of all(doc, 'c')) {
      const a = attr(c, 'r');
      if (!a) continue;
      const p = parseAddr(a);
      const t = attr(c, 't');
      const vEl = kid(c, 'v');
      const fEl = kid(c, 'f');
      let raw = '';
      if (fEl) {
        const si = attr(fEl, 'si');
        if (fEl.textContent) {
          raw = '=' + fEl.textContent;
          if (attr(fEl, 't') === 'shared' && si != null) sharedF[si] = { raw, p };
        } else if (si != null && sharedF[si]) {
          raw = shiftFormula(sharedF[si].raw, p.c - sharedF[si].p.c, p.r - sharedF[si].p.r);
        }
      }
      if (!raw) {
        if (t === 's') raw = shared[+(vEl ? vEl.textContent : 0)] ?? '';
        else if (t === 'inlineStr') raw = all(c, 't').map(x => x.textContent).join('');
        else if (t === 'b') raw = vEl && vEl.textContent === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'str' || t === 'e') raw = vEl ? vEl.textContent : '';
        else raw = vEl ? vEl.textContent : '';
        /* text that looks like a number/formula must stay text */
        if ((t === 's' || t === 'inlineStr' || t === 'str') && raw && (raw.startsWith('=') || typeof literal(raw) !== 'string')) raw = "'" + raw;
      }
      const style = styleOf[+attr(c, 's') || 0] || null;
      if (raw === '' && !style) continue;
      sh.cells[a] = style ? { v: raw, s: { ...style } } : { v: raw };
    }
    sheets.push(sh);
  }
  const book = new Book(sheets.length ? sheets : undefined);
  book.sheets.forEach(s => book.updateBounds(s));
  const activeTab = attr(all(wb, 'workbookView')[0], 'activeTab');
  book.active = Math.min(book.sheets.length - 1, +activeTab || 0);
  let extra = null;
  try { if (files.get('xl/webwin.json')) extra = JSON.parse(fromUtf8(files.get('xl/webwin.json'))); } catch { /* ignore */ }
  if (extra && extra.charts) book.sheets.forEach((s, i) => { s.charts = extra.charts[i] || []; });
  return book;
}

