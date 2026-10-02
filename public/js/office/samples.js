/* Sample Office documents seeded into a fresh "Documents" folder. */
import { htmlToDocx } from './docx.js';
import { writeXlsx } from './xlsx.js';
import { Book, newSheet } from './formula.js';
import { toDataURL } from './zip.js';

export function sampleDocx() {
  const div = document.createElement('div');
  div.innerHTML = `<h1 class="title">Welcome to Word</h1>
    <p>This document was made with <b>Word</b> on Windows 10 Web. It's a real <i>.docx</i> file — download it and it opens in Microsoft Word, LibreOffice or Google Docs.</p>
    <h1>Things to try</h1>
    <ul><li>Make text <b>bold</b>, <i>italic</i>, <u>underlined</u> or <span style="color:#c00000">colored</span>.</li><li>Use the <b>Styles</b> gallery for headings.</li><li>Insert a table, a picture or a page break from the <b>Insert</b> tab.</li><li>Switch a paragraph to right-to-left for Arabic: <span dir="rtl">مرحبًا بك في وورد</span></li></ul>
    <h2>A small table</h2>
    <table><tr><td><b>Shortcut</b></td><td><b>Does</b></td></tr><tr><td>Ctrl+S</td><td>Save</td></tr><tr><td>Ctrl+F</td><td>Find</td></tr><tr><td>Ctrl+Enter</td><td>Page break</td></tr></table>
    <p><br></p><blockquote>“The best way to get started is to quit talking and begin doing.”</blockquote>`;
  return toDataURL(htmlToDocx(div, { title: 'Welcome to Word' }), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

export function sampleXlsx() {
  const s = newSheet('Budget');
  const put = (a, v, st) => { s.cells[a] = st ? { v, s: st } : { v }; };
  const head = { b: true, fill: '#4472c4', color: '#ffffff' };
  put('A1', 'Monthly Budget', { b: true, size: 14 });
  put('A3', 'Category', head); put('B3', 'Planned', { ...head, align: 'right' }); put('C3', 'Actual', { ...head, align: 'right' }); put('D3', 'Difference', { ...head, align: 'right' });
  const rows = [['Rent', 900, 900], ['Groceries', 350, 412.5], ['Transport', 120, 96], ['Utilities', 150, 171.3], ['Internet', 40, 40], ['Fun', 200, 145]];
  const money = { fmt: 'currency', dec: 2 };
  rows.forEach(([n, p, a], i) => {
    const r = i + 4;
    put('A' + r, n); put('B' + r, String(p), money); put('C' + r, String(a), money); put('D' + r, `=B${r}-C${r}`, money);
  });
  put('A10', 'Total', { b: true });
  put('B10', '=SUM(B4:B9)', { ...money, b: true }); put('C10', '=SUM(C4:C9)', { ...money, b: true }); put('D10', '=SUM(D4:D9)', { ...money, b: true });
  put('A12', 'Over budget in'); put('B12', '=COUNTIF(D4:D9,"<0")&" categories"');
  put('A13', 'Biggest expense'); put('B13', '=INDEX(A4:A9,MATCH(MAX(C4:C9),C4:C9,0))');
  s.colW = { 0: 120, 1: 90, 2: 90, 3: 100 };
  s.charts = [{ id: 'ch1', type: 'column', range: 'A3:C9', x: 470, y: 44, w: 440, h: 270, title: 'Planned vs Actual' }];
  const book = new Book([s]);
  book.updateBounds(s);
  return toDataURL(writeXlsx(book, { charts: [s.charts] }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
