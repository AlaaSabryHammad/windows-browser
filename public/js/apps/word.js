/* Word — rich-text word processor with a ribbon. Saves real .docx files (opens in Microsoft Word), also .html / .txt, prints / exports PDF. */
import { createWindow } from '../wm.js';
import { I } from '../icons.js';
import { getNode, canonical, writeFile, KNOWN, extOf, kindOf } from '../fs.js';
import { contextMenu, promptDialog, msgDialog, dialog, esc, notify } from '../ui.js';
import { fileDialog } from '../filedialog.js';
import { dragKind, currentDrag, downloadNode } from '../fileops.js';
import { htmlToDocx, docxToHtml } from '../office/docx.js';
import { toDataURL, dataURLToBytes } from '../office/zip.js';
import { launch } from './registry.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FONTS = ['Calibri', 'Calibri Light', 'Arial', 'Times New Roman', 'Georgia', 'Cambria', 'Segoe UI', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Courier New', 'Consolas', 'Comic Sans MS', 'Arial Black', 'Impact'];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
const MARGINS = { normal: 1440, narrow: 720, moderate: 1080, wide: 2160 };
const SYMBOLS = ['©', '®', '™', '€', '£', '¥', '°', '±', '×', '÷', '≠', '≤', '≥', '∞', '√', 'π', 'Ω', 'µ', '§', '¶', '•', '…', '—', '→', '←', '✓', '★', '☺', '♥', '☎'];
const HILITES = ['#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#ff0000', '#c0c0c0', 'transparent'];

const TEMPLATES = {
  letter: `<p style="text-align:right">${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p><p>Dear [Recipient Name],</p><p>Write your letter here. Keep it short and friendly — a couple of paragraphs is usually plenty.</p><p>Thank you for your time.</p><p>Sincerely,</p><p><b>[Your Name]</b></p>`,
  resume: `<h1 class="title">Your Name</h1><p>City, Country · email@example.com · +00 000 000 000</p><h2>Profile</h2><p>A short summary of who you are and what you're great at.</p><h2>Experience</h2><h3>Job Title — Company</h3><p><i>2022 – Present</i></p><ul><li>An achievement you're proud of</li><li>Another result, with numbers if possible</li></ul><h2>Education</h2><p><b>Degree</b>, University — 2021</p><h2>Skills</h2><ul><li>Skill one</li><li>Skill two</li></ul>`,
  report: `<h1 class="title">Report Title</h1><p><i>Prepared by [Name] · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</i></p><h1>Introduction</h1><p>Start writing here.</p><h1>Findings</h1><table><tr><td><b>Item</b></td><td><b>Value</b></td></tr><tr><td>First</td><td>0</td></tr><tr><td>Second</td><td>0</td></tr></table><p><br></p><h1>Conclusion</h1><p>Wrap it up.</p>`,
};

/* strip anything unsafe/unwanted from pasted or loaded HTML */
function sanitize(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, meta, link, iframe, object, embed, title, noscript, svg, form, input, button, select, textarea').forEach(n => n.remove());
  doc.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'id' || (n === 'class' && !/\b(title|page-break|tab)\b/.test(a.value)) || n === 'contenteditable' && !el.classList.contains('page-break')) el.removeAttribute(a.name);
      if ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}

export function open(arg = null) {
  const win = createWindow({ title: 'Document1 - Word', icon: I.word, appId: 'word', w: 1060, h: 700, minW: 620, minH: 400 });
  win.body.innerHTML = `
    <div class="wd">
      <div class="wd-titlebar"><span class="wd-autosave">${I.save} <span class="wd-saved">Not saved</span></span><span class="wd-docname">Document1</span></div>
      <div class="wd-tabs">
        <div class="wd-tab file" data-t="file">File</div>
        <div class="wd-tab sel" data-t="home">Home</div>
        <div class="wd-tab" data-t="insert">Insert</div>
        <div class="wd-tab" data-t="layout">Layout</div>
        <div class="wd-tab" data-t="view">View</div>
      </div>
      <div class="wd-ribbon">
        <div class="wd-pane" data-p="home">
          <div class="rg">
            <div class="rg-body"><button class="rb big" data-c="paste" title="Paste (Ctrl+V)">${I.paste}<span>Paste</span></button>
              <div class="rg-col"><button class="rb" data-c="cut" title="Cut (Ctrl+X)">${I.cut}</button><button class="rb" data-c="copy" title="Copy (Ctrl+C)">${I.copy}</button><button class="rb" data-c="undo" title="Undo (Ctrl+Z)">${I.undo}</button><button class="rb" data-c="redo" title="Redo (Ctrl+Y)">${I.redo}</button></div></div>
            <div class="rg-name">Clipboard</div>
          </div>
          <div class="rg">
            <div class="rg-body col">
              <div class="rg-row"><select class="wd-font" title="Font">${FONTS.map(f => `<option style="font-family:'${f}'">${f}</option>`).join('')}</select><select class="wd-size" title="Font size">${SIZES.map(s => `<option>${s}</option>`).join('')}</select>
                <button class="rb" data-c="grow" title="Increase font size (Ctrl+])">A<sup>+</sup></button><button class="rb" data-c="shrink" title="Decrease font size (Ctrl+[)">A<sup>-</sup></button><button class="rb" data-c="removeFormat" title="Clear all formatting">A<span class="x">✕</span></button></div>
              <div class="rg-row"><button class="rb t" data-c="bold" title="Bold (Ctrl+B)"><b>B</b></button><button class="rb t" data-c="italic" title="Italic (Ctrl+I)"><i>I</i></button><button class="rb t" data-c="underline" title="Underline (Ctrl+U)"><u>U</u></button><button class="rb t" data-c="strikeThrough" title="Strikethrough"><s>ab</s></button><button class="rb t" data-c="subscript" title="Subscript (Ctrl+=)">x<sub>2</sub></button><button class="rb t" data-c="superscript" title="Superscript (Ctrl+Shift+=)">x<sup>2</sup></button>
                <span class="rb-split"><button class="rb" data-c="hilite" title="Text highlight color"><span class="hl-ic">ab</span><span class="bar hl-bar"></span></button><button class="rb drop" data-c="hilitePick">▾</button></span>
                <span class="rb-split"><button class="rb" data-c="color" title="Font color"><span class="fc-ic">A</span><span class="bar fc-bar"></span></button><label class="rb drop" title="More colors">▾<input type="color" class="wd-color" value="#c00000"></label></span></div>
            </div>
            <div class="rg-name">Font</div>
          </div>
          <div class="rg">
            <div class="rg-body col">
              <div class="rg-row"><button class="rb t" data-c="insertUnorderedList" title="Bullets">${I.viewList}</button><button class="rb t" data-c="insertOrderedList" title="Numbering"><span class="num-ic">1.<br>2.</span></button><button class="rb" data-c="outdent" title="Decrease indent">⇤</button><button class="rb" data-c="indent" title="Increase indent">⇥</button><button class="rb t" data-c="rtl" title="Right-to-left text direction (Arabic)">¶◂</button><button class="rb" data-c="ltr" title="Left-to-right text direction">▸¶</button></div>
              <div class="rg-row"><button class="rb t" data-c="justifyLeft" title="Align left (Ctrl+L)">${alignIcon('l')}</button><button class="rb t" data-c="justifyCenter" title="Center (Ctrl+E)">${alignIcon('c')}</button><button class="rb t" data-c="justifyRight" title="Align right (Ctrl+R)">${alignIcon('r')}</button><button class="rb t" data-c="justifyFull" title="Justify (Ctrl+J)">${alignIcon('j')}</button>
                <select class="wd-spacing" title="Line and paragraph spacing"><option value="">Spacing</option><option>1.0</option><option>1.15</option><option>1.5</option><option>2.0</option><option>2.5</option><option>3.0</option></select></div>
            </div>
            <div class="rg-name">Paragraph</div>
          </div>
          <div class="rg">
            <div class="rg-body styles">
              <button class="st-btn" data-s="p"><span style="font-size:13px">AaBbCc</span><small>Normal</small></button>
              <button class="st-btn" data-s="title"><span style="font-size:18px;font-family:'Calibri Light'">AaB</span><small>Title</small></button>
              <button class="st-btn" data-s="h1"><span style="font-size:15px;color:#2f5496">AaBbC</span><small>Heading 1</small></button>
              <button class="st-btn" data-s="h2"><span style="font-size:13px;color:#2f5496">AaBbCc</span><small>Heading 2</small></button>
              <button class="st-btn" data-s="h3"><span style="font-size:12px;color:#1f3763">AaBbCc</span><small>Heading 3</small></button>
              <button class="st-btn" data-s="blockquote"><span style="font-size:12px;font-style:italic;color:#404040">AaBbCc</span><small>Quote</small></button>
            </div>
            <div class="rg-name">Styles</div>
          </div>
          <div class="rg">
            <div class="rg-body col"><button class="rb wide" data-c="find">${I.search}<span>Find</span></button><button class="rb wide" data-c="replace">⇄<span>Replace</span></button><button class="rb wide" data-c="selectAll">⬚<span>Select all</span></button></div>
            <div class="rg-name">Editing</div>
          </div>
        </div>
        <div class="wd-pane hidden" data-p="insert">
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="pageBreak">${I.file}<span>Page Break</span></button></div><div class="rg-name">Pages</div></div>
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="table">${I.grid}<span>Table ▾</span></button></div><div class="rg-name">Tables</div></div>
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="picturePC">${I.upload}<span>Picture from PC</span></button><button class="rb big" data-c="pictureFS">${I.photos}<span>This PC</span></button></div><div class="rg-name">Illustrations</div></div>
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="link">${I.globe}<span>Link</span></button></div><div class="rg-name">Links</div></div>
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="hr">―<span>Line</span></button><button class="rb big" data-c="date">${I.clock}<span>Date &amp; Time</span></button><button class="rb big" data-c="symbol"><b style="font-size:20px">Ω</b><span>Symbol ▾</span></button></div><div class="rg-name">Text</div></div>
        </div>
        <div class="wd-pane hidden" data-p="layout">
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="margins">${I.file}<span>Margins ▾</span></button><button class="rb big" data-c="orientation">${I.rotate}<span>Orientation ▾</span></button></div><div class="rg-name">Page Setup</div></div>
          <div class="rg"><div class="rg-body col"><button class="rb wide" data-c="indent">⇥<span>Indent</span></button><button class="rb wide" data-c="outdent">⇤<span>Outdent</span></button></div><div class="rg-name">Paragraph</div></div>
        </div>
        <div class="wd-pane hidden" data-p="view">
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="zoomOut"><b style="font-size:20px">−</b><span>Zoom out</span></button><button class="rb big" data-c="zoom100"><b style="font-size:16px">100%</b><span>100%</span></button><button class="rb big" data-c="zoomIn"><b style="font-size:20px">+</b><span>Zoom in</span></button><button class="rb big" data-c="pageWidth">↔<span>Page Width</span></button></div><div class="rg-name">Zoom</div></div>
          <div class="rg"><div class="rg-body"><button class="rb big" data-c="wordCount"><b style="font-size:16px">123</b><span>Word Count</span></button><button class="rb big" data-c="focus">${I.fullscreen}<span>Focus</span></button></div><div class="rg-name">Tools</div></div>
        </div>
      </div>
      <div class="np-find wd-find hidden">
        <input class="nf-find" placeholder="Find" spellcheck="false"><input class="nf-repl" placeholder="Replace with" spellcheck="false">
        <button class="btn nf-next">Find next</button><button class="btn nf-one">Replace</button><button class="btn nf-all">Replace all</button>
        <span class="nf-count"></span><button class="toolbar-btn nf-x" title="Close">${I.x}</button>
      </div>
      <div class="wd-canvas">
        <div class="wd-zoom"><div class="wd-page selectable" contenteditable="true" spellcheck="true"><p><br></p></div></div>
      </div>
      <div class="wd-status">
        <span class="ws-page">Page 1 of 1</span><span class="ws-words">0 words</span><span class="ws-lang">English (United States)</span>
        <span class="ws-flex"></span>
        <button class="ws-z" data-z="-">−</button><input type="range" class="ws-zoom" min="50" max="200" step="10" value="100"><button class="ws-z" data-z="+">+</button><span class="ws-zv">100%</span>
      </div>
    </div>`;

  const root = win.body.querySelector('.wd');
  const page = root.querySelector('.wd-page');
  const canvas = root.querySelector('.wd-canvas');
  const zoomBox = root.querySelector('.wd-zoom');
  const fontSel = root.querySelector('.wd-font');
  const sizeSel = root.querySelector('.wd-size');
  const findBar = root.querySelector('.wd-find');

  const st = { path: null, dirty: false, landscape: false, margin: 1440, zoom: 100, hilite: '#ffff00', color: '#c00000', untitled: nextUntitled() };
  let savedRange = null;

  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* ignore */ }

  /* ---------- document state ---------- */
  const docName = () => st.path ? st.path[st.path.length - 1] : st.untitled;
  function refreshTitle() {
    win.setTitle(`${docName()}${st.dirty ? '*' : ''} - Word`);
    root.querySelector('.wd-docname').textContent = docName().replace(/\.docx$/i, '') + (st.dirty ? ' •' : '');
    root.querySelector('.wd-saved').textContent = st.path ? (st.dirty ? 'Edited' : 'Saved to This PC') : 'Not saved';
  }
  const setDirty = (v) => { if (st.dirty !== v) { st.dirty = v; refreshTitle(); } };

  function applyPage() {
    const wTw = st.landscape ? 15840 : 12240;
    const hTw = st.landscape ? 12240 : 15840;
    page.style.width = wTw / 15 + 'px';
    page.style.minHeight = hTw / 15 + 'px';
    page.style.padding = `${st.margin / 15}px`;
    page.style.setProperty('--page-h', hTw / 15 + 'px');
    zoomBox.style.zoom = st.zoom / 100;
    root.querySelector('.ws-zoom').value = st.zoom;
    root.querySelector('.ws-zv').textContent = st.zoom + '%';
    updateStatus();
  }

  function setContent(html) {
    page.innerHTML = sanitize(html) || '<p><br></p>';
    if (!page.firstElementChild) page.innerHTML = '<p><br></p>';
    updateStatus();
  }

  async function load(path) {
    const node = path && getNode(path);
    if (!node) { setContent('<p><br></p>'); st.path = null; st.dirty = false; refreshTitle(); return; }
    st.path = canonical(path);
    const ext = extOf(node.name);
    const content = node.content || '';
    try {
      if (!content) setContent('<p><br></p>');
      else if (ext === 'docx' || (content.startsWith('data:') && kindOf(node) === 'doc')) {
        const res = await docxToHtml(dataURLToBytes(content));
        st.landscape = res.landscape; st.margin = res.margin;
        setContent(res.html);
      } else if (ext === 'html' || ext === 'htm') {
        const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(content);
        setContent(body ? body[1] : content);
      } else if (content.startsWith('data:')) {
        throw new Error('Word can only open .docx, .html and text files here.');
      } else {
        setContent(content.split(/\r?\n/).map(l => `<p>${esc(l) || '<br>'}</p>`).join(''));
      }
    } catch (e) {
      msgDialog('Word', `Word experienced an error trying to open the file.<br><br>${esc(e.message || e)}`, 'error');
      setContent('<p><br></p>');
    }
    st.dirty = false;
    applyPage();
    refreshTitle();
    page.focus();
    placeCaretAtStart();
  }

  function atEndOfStyledBlock() {
    const s = getSelection();
    if (!s.rangeCount || !s.isCollapsed) return false;
    const blk = blocksInSelection(false)[0];
    if (!blk || !/^(H[1-6]|BLOCKQUOTE)$/.test(blk.tagName) || blk.parentNode !== page) return false;
    const r = document.createRange();
    r.selectNodeContents(blk);
    r.setStart(s.anchorNode, s.anchorOffset);
    return !r.toString().length;
  }

  function placeCaretAtStart() {
    const r = document.createRange();
    let n = page;
    while (n.firstChild && !/^(BR|IMG|HR|TABLE)$/.test(n.firstChild.nodeName)) n = n.firstChild;
    r.setStart(n, 0); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  /* ---------- saving ---------- */
  async function save(as = false) {
    let path = st.path;
    if (path && !/^(docx|html?|txt)$/i.test(extOf(path[path.length - 1]))) path = null;
    if (!path || as) {
      path = await fileDialog({
        mode: 'save', title: 'Save As', startDir: st.path ? st.path.slice(0, -1) : KNOWN.documents,
        defaultName: (st.path ? docName() : st.untitled).replace(/\.[^.]+$/, '') + '.docx', defaultExt: 'docx', filterLabel: 'Word Document (*.docx)', kinds: ['doc'],
      });
      if (!path) return false;
    }
    const ext = extOf(path[path.length - 1]);
    if (ext === 'txt') writeFile(path, page.innerText.replace(/\n/g, '\r\n'), 'txt');
    else if (ext === 'html' || ext === 'htm') writeFile(path, `<!doctype html><html><head><meta charset="utf-8"><title>${esc(docName())}</title></head><body>${page.innerHTML}</body></html>`, 'html');
    else {
      const bytes = htmlToDocx(page, { landscape: st.landscape, margin: st.margin, title: path[path.length - 1].replace(/\.docx$/i, '') });
      writeFile(path, toDataURL(bytes, DOCX_MIME), 'doc');
    }
    st.path = canonical(path);
    st.dirty = false;
    refreshTitle();
    return true;
  }

  async function confirmDiscard() {
    if (!st.dirty) return true;
    win.focus();
    const choice = await dialog({
      title: 'Microsoft Word',
      bodyHTML: `<div class="np-save-q">Do you want to save changes to ${esc(docName())}?</div><div style="margin-top:6px;color:var(--text-muted)">If you don't save, your changes will be lost.</div>`,
      buttons: [{ label: 'Save', primary: true, value: 'save' }, { label: "Don't Save", value: 'discard' }, { label: 'Cancel', value: 'cancel' }],
      cancelValue: 'cancel',
    });
    if (choice === 'save') return save(false);
    return choice === 'discard';
  }
  win.beforeClose(confirmDiscard);

  async function openFile() {
    if (!(await confirmDiscard())) return;
    const path = await fileDialog({ mode: 'open', title: 'Open', startDir: st.path ? st.path.slice(0, -1) : KNOWN.documents, kinds: ['doc', 'txt', 'html'], filterLabel: 'All Word Documents' });
    if (path) await load(path);
  }
  async function newDoc(template = null) {
    if (!(await confirmDiscard())) return;
    st.path = null; st.untitled = nextUntitled(); st.landscape = false; st.margin = 1440;
    setContent(template ? TEMPLATES[template] : '<p><br></p>');
    st.dirty = false;
    applyPage(); refreshTitle();
    page.focus(); placeCaretAtStart();
  }

  function print() {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(fr);
    const m = st.margin / 1440;
    fr.contentDocument.write(`<!doctype html><title>${esc(docName())}</title><style>@page{size:${st.landscape ? 'letter landscape' : 'letter'};margin:${m}in}
      body{font:11pt Calibri,Arial,sans-serif;line-height:1.08}p{margin:0 0 8pt}h1{font:16pt 'Calibri Light',Arial;color:#2f5496;margin:12pt 0 3pt}h1.title{font-size:28pt;color:#000}
      h2{font:13pt 'Calibri Light',Arial;color:#2f5496;margin:10pt 0 3pt}h3{font:12pt 'Calibri Light',Arial;color:#1f3763}blockquote{font-style:italic;color:#404040;text-align:center;margin:10pt 0.6in}
      table{border-collapse:collapse}td,th{border:1px solid #000;padding:2pt 6pt;vertical-align:top}img{max-width:100%}.page-break{break-after:page}</style>${page.innerHTML}`);
    fr.contentDocument.close();
    setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 1500); }, 150);
  }

  /* ---------- selection helpers ---------- */
  document.addEventListener('selectionchange', onSelChange);
  function onSelChange() {
    const s = getSelection();
    if (!s.rangeCount || !page.contains(s.anchorNode)) return;
    savedRange = s.getRangeAt(0).cloneRange();
    updateRibbonState();
  }
  function restore() {
    page.focus({ preventScroll: true });
    if (savedRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
  }
  const exec = (cmd, val = null) => { restore(); document.execCommand(cmd, false, val); setDirty(true); updateRibbonState(); };

  /* blocks touched by the selection; `create` wraps loose text in a <p> when none is found */
  function blocksInSelection(create = true) {
    const s = getSelection();
    if (!s.rangeCount) return [];
    const r = s.getRangeAt(0);
    const blockOf = (n, off) => {
      if (n === page) n = page.childNodes[Math.min(off, page.childNodes.length - 1)];
      while (n && n !== page) {
        if (n.nodeType === 1 && /^(P|H[1-6]|LI|BLOCKQUOTE|DIV|TD|TH|PRE)$/.test(n.tagName)) return n;
        n = n.parentNode;
      }
      return null;
    };
    const out = new Set();
    const a = blockOf(r.startContainer, r.startOffset), b = blockOf(r.endContainer, Math.max(0, r.endOffset - 1));
    if (a) out.add(a);
    if (b) out.add(b);
    page.querySelectorAll('p, h1, h2, h3, h4, li, blockquote, td').forEach(el => { if (r.intersectsNode(el) && !el.querySelector('p, li')) out.add(el); });
    if (!out.size && create) { document.execCommand('formatBlock', false, 'p'); const n = blockOf(getSelection().anchorNode); if (n) out.add(n); }
    return [...out];
  }

  function setFontSize(pt) {
    restore();
    document.execCommand('fontSize', false, '7');
    page.querySelectorAll('font[size="7"]').forEach(f => {
      const span = document.createElement('span');
      span.style.fontSize = pt + 'pt';
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
      span.querySelectorAll('span[style*="font-size"]').forEach(inner => { inner.style.fontSize = ''; if (!inner.getAttribute('style')) inner.replaceWith(...inner.childNodes); });
    });
    setDirty(true);
    updateRibbonState();
  }
  function currentPt() {
    const s = getSelection();
    let n = s.anchorNode;
    if (!n || !page.contains(n)) return 11;
    if (n.nodeType === 3) n = n.parentNode;
    return Math.round(parseFloat(getComputedStyle(n).fontSize) * 0.75 * 2) / 2;
  }

  function updateRibbonState() {
    root.querySelectorAll('.rb.t[data-c]').forEach(b => {
      const c = b.dataset.c;
      let on = false;
      try { on = c === 'rtl' ? blocksInSelection(false).some(x => x.closest('[dir="rtl"]')) : document.queryCommandState(c); } catch { on = false; }
      b.classList.toggle('on', !!on);
    });
    const s = getSelection();
    let n = s.anchorNode;
    if (!n || !page.contains(n)) return;
    if (n.nodeType === 3) n = n.parentNode;
    const fam = getComputedStyle(n).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    if (document.activeElement !== fontSel) {
      if (![...fontSel.options].some(o => o.value === fam)) fontSel.add(new Option(fam));
      fontSel.value = fam;
    }
    if (document.activeElement !== sizeSel) {
      const pt = currentPt();
      if (![...sizeSel.options].some(o => +o.value === pt)) sizeSel.add(new Option(String(pt)));
      sizeSel.value = String(pt);
    }
    const blk = n.closest('h1, h2, h3, blockquote, p, li');
    root.querySelectorAll('.st-btn').forEach(b => {
      const s2 = b.dataset.s;
      const tag = blk ? blk.tagName.toLowerCase() : 'p';
      b.classList.toggle('on', s2 === 'title' ? !!(blk && blk.classList.contains('title')) : s2 === tag && !(blk && blk.classList.contains('title')));
    });
  }

  /* ---------- insertions ---------- */
  function insertHTML(html) { restore(); document.execCommand('insertHTML', false, html); setDirty(true); }

  async function toEmbeddable(src) {
    if (/^data:image\/(png|jpeg|gif)/.test(src)) return src;
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || 600; c.height = img.naturalHeight || 400;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/png'));
      };
      img.onerror = () => res(null);
      img.src = src;
    });
  }
  async function insertImage(src) {
    const s = await toEmbeddable(src);
    if (!s) { msgDialog('Word', 'This picture can\'t be inserted.', 'error'); return; }
    const img = new Image();
    img.onload = () => {
      const maxW = (st.landscape ? 1056 : 816) - 2 * st.margin / 15;
      const w = Math.min(img.naturalWidth, maxW);
      insertHTML(`<img src="${s}" width="${Math.round(w)}">`);
    };
    img.src = s;
  }

  function tablePicker(btn) {
    const r = btn.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'wd-tablepick';
    pop.innerHTML = `<div class="tp-label">Insert Table</div><div class="tp-grid">${Array.from({ length: 80 }, (_, i) => `<span data-r="${Math.floor(i / 10)}" data-c="${i % 10}"></span>`).join('')}</div>`;
    pop.style.left = r.left + 'px'; pop.style.top = r.bottom + 4 + 'px';
    document.body.appendChild(pop);
    const label = pop.querySelector('.tp-label');
    pop.addEventListener('pointerover', (e) => {
      const t = e.target.closest('span'); if (!t) return;
      const rr = +t.dataset.r, cc = +t.dataset.c;
      pop.querySelectorAll('span').forEach(s => s.classList.toggle('on', +s.dataset.r <= rr && +s.dataset.c <= cc));
      label.textContent = `${cc + 1}x${rr + 1} Table`;
    });
    pop.addEventListener('click', (e) => {
      const t = e.target.closest('span'); if (!t) return;
      const rows = +t.dataset.r + 1, cols = +t.dataset.c + 1;
      close();
      insertHTML(`<table>${Array.from({ length: rows }, () => `<tr>${'<td><br></td>'.repeat(cols)}</tr>`).join('')}</table><p><br></p>`);
    });
    const close = () => { pop.remove(); document.removeEventListener('pointerdown', outside, true); };
    const outside = (e) => { if (!pop.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }

  /* ---------- ribbon commands ---------- */
  const commands = {
    paste: async () => {
      restore();
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          if (it.types.includes('text/html')) { insertHTML(sanitize(await (await it.getType('text/html')).text())); return; }
          const imgT = it.types.find(t => t.startsWith('image/'));
          if (imgT) { const b = await it.getType(imgT); const fr = new FileReader(); fr.onload = () => insertImage(fr.result); fr.readAsDataURL(b); return; }
          if (it.types.includes('text/plain')) { exec('insertText', await (await it.getType('text/plain')).text()); return; }
        }
      } catch { msgDialog('Word', 'Use Ctrl+V to paste — the browser needs a keyboard shortcut for that.', 'info'); }
    },
    cut: () => exec('cut'), copy: () => exec('copy'), undo: () => exec('undo'), redo: () => exec('redo'),
    bold: () => exec('bold'), italic: () => exec('italic'), underline: () => exec('underline'), strikeThrough: () => exec('strikeThrough'),
    subscript: () => exec('subscript'), superscript: () => exec('superscript'), removeFormat: () => { exec('removeFormat'); exec('unlink'); },
    grow: () => setFontSize(SIZES.find(s => s > currentPt()) || currentPt() + 4),
    shrink: () => setFontSize([...SIZES].reverse().find(s => s < currentPt()) || Math.max(1, currentPt() - 1)),
    hilite: () => { restore(); if (!document.execCommand('hiliteColor', false, st.hilite)) document.execCommand('backColor', false, st.hilite); setDirty(true); },
    hilitePick: (btn) => {
      const r = btn.getBoundingClientRect();
      contextMenu(r.left, r.bottom + 2, HILITES.map(c => ({ label: c === 'transparent' ? 'No Color' : c.toUpperCase(), icon: `<span style="display:block;width:14px;height:14px;background:${c};border:1px solid #999"></span>`, action: () => { st.hilite = c; root.querySelector('.hl-bar').style.background = c; commands.hilite(); } })));
    },
    color: () => exec('foreColor', st.color),
    insertUnorderedList: () => exec('insertUnorderedList'), insertOrderedList: () => exec('insertOrderedList'),
    indent: () => exec('indent'), outdent: () => exec('outdent'),
    justifyLeft: () => exec('justifyLeft'), justifyCenter: () => exec('justifyCenter'), justifyRight: () => exec('justifyRight'), justifyFull: () => exec('justifyFull'),
    rtl: () => { restore(); blocksInSelection().forEach(b => b.setAttribute('dir', 'rtl')); setDirty(true); updateRibbonState(); },
    ltr: () => { restore(); blocksInSelection().forEach(b => b.removeAttribute('dir')); setDirty(true); updateRibbonState(); },
    selectAll: () => { page.focus(); document.execCommand('selectAll'); },
    find: () => showFind(false), replace: () => showFind(true),
    pageBreak: () => insertHTML('<div class="page-break" contenteditable="false"></div><p><br></p>'),
    table: (btn) => tablePicker(btn),
    picturePC: () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.addEventListener('change', () => { const f = inp.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => insertImage(fr.result); fr.readAsDataURL(f); });
      inp.click();
    },
    pictureFS: async () => {
      const p = await fileDialog({ mode: 'open', title: 'Insert Picture', startDir: KNOWN.pictures, kinds: ['img'], filterLabel: 'All Pictures' });
      if (p) insertImage(getNode(p).content);
    },
    link: async () => {
      const text = savedRange ? savedRange.toString() : '';
      const url = await promptDialog('Insert Hyperlink', 'Address:', 'https://', '', { validate: (v) => (/^(https?:|mailto:|#)/i.test(v) ? null : 'Enter a web address like https://example.com') });
      if (!url) return;
      if (text) exec('createLink', url);
      else insertHTML(`<a href="${esc(url)}">${esc(url)}</a>&nbsp;`);
    },
    hr: () => insertHTML('<hr><p><br></p>'),
    date: (btn) => {
      const r = btn.getBoundingClientRect();
      const d = new Date();
      const fmts = [d.toLocaleDateString('en-US'), d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), d.toISOString().slice(0, 10), d.toLocaleString('en-US'), d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })];
      contextMenu(r.left, r.bottom + 2, fmts.map(f => ({ label: f, action: () => exec('insertText', f) })));
    },
    symbol: (btn) => {
      const r = btn.getBoundingClientRect();
      const pop = document.createElement('div');
      pop.className = 'wd-tablepick sym';
      pop.innerHTML = `<div class="tp-label">Symbol</div><div class="sym-grid">${SYMBOLS.map(s => `<button>${s}</button>`).join('')}</div>`;
      pop.style.left = r.left + 'px'; pop.style.top = r.bottom + 4 + 'px';
      document.body.appendChild(pop);
      const close = () => { pop.remove(); document.removeEventListener('pointerdown', outside, true); };
      const outside = (e) => { if (!pop.contains(e.target)) close(); };
      setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
      pop.addEventListener('mousedown', (e) => e.preventDefault());
      pop.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { exec('insertText', b.textContent); close(); } });
    },
    margins: (btn) => {
      const r = btn.getBoundingClientRect();
      contextMenu(r.left, r.bottom + 2, [['normal', 'Normal (1")'], ['narrow', 'Narrow (0.5")'], ['moderate', 'Moderate (0.75")'], ['wide', 'Wide (1.5")']].map(([k, l]) => ({ label: l, checked: st.margin === MARGINS[k], action: () => { st.margin = MARGINS[k]; setDirty(true); applyPage(); } })));
    },
    orientation: (btn) => {
      const r = btn.getBoundingClientRect();
      contextMenu(r.left, r.bottom + 2, [
        { label: 'Portrait', checked: !st.landscape, action: () => { st.landscape = false; setDirty(true); applyPage(); } },
        { label: 'Landscape', checked: st.landscape, action: () => { st.landscape = true; setDirty(true); applyPage(); } },
      ]);
    },
    zoomIn: () => setZoom(st.zoom + 10), zoomOut: () => setZoom(st.zoom - 10), zoom100: () => setZoom(100),
    pageWidth: () => setZoom(Math.floor((canvas.clientWidth - 40) / page.offsetWidth * 10) * 10),
    wordCount: () => {
      const t = page.innerText;
      const words = (t.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
      msgDialog('Word Count', `<table class="props-table"><tr><td>Pages</td><td>${pageCount()}</td></tr><tr><td>Words</td><td>${words.toLocaleString()}</td></tr><tr><td>Characters (no spaces)</td><td>${t.replace(/\s/g, '').length.toLocaleString()}</td></tr><tr><td>Characters (with spaces)</td><td>${t.replace(/\n/g, '').length.toLocaleString()}</td></tr><tr><td>Paragraphs</td><td>${page.querySelectorAll('p, h1, h2, h3, li, blockquote').length}</td></tr></table>`);
    },
    focus: () => { root.classList.toggle('focus-mode'); if (root.classList.contains('focus-mode') && !win.maximized) win.toggleMax(); },
  };
  root.querySelectorAll('.wd-ribbon [data-c]').forEach(b => {
    b.addEventListener('mousedown', (e) => { if (b.tagName === 'BUTTON') e.preventDefault(); });
    if (b.tagName === 'BUTTON') b.addEventListener('click', () => commands[b.dataset.c] && commands[b.dataset.c](b));
  });
  root.querySelectorAll('.st-btn').forEach(b => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      const s = b.dataset.s;
      restore();
      document.execCommand('formatBlock', false, s === 'title' ? 'h1' : s);
      blocksInSelection().forEach(x => x.classList.toggle('title', s === 'title' && x.tagName === 'H1'));
      page.querySelectorAll('[class=""]').forEach(x => x.removeAttribute('class'));
      setDirty(true); updateRibbonState();
    });
  });
  fontSel.addEventListener('change', () => { exec('fontName', fontSel.value); });
  sizeSel.addEventListener('change', () => setFontSize(+sizeSel.value));
  root.querySelector('.wd-color').addEventListener('input', (e) => { st.color = e.target.value; root.querySelector('.fc-bar').style.background = st.color; });
  root.querySelector('.wd-color').addEventListener('change', () => commands.color());
  root.querySelector('.fc-bar').style.background = st.color;
  root.querySelector('.hl-bar').style.background = st.hilite;
  root.querySelector('.wd-spacing').addEventListener('change', (e) => {
    const v = e.target.value;
    e.target.value = '';
    if (!v) return;
    restore();
    blocksInSelection().forEach(b => { b.style.lineHeight = v; });
    setDirty(true);
  });

  /* tabs */
  root.querySelectorAll('.wd-tab').forEach(t => t.addEventListener('click', () => {
    if (t.dataset.t === 'file') { fileMenu(t); return; }
    root.querySelectorAll('.wd-tab').forEach(x => x.classList.toggle('sel', x === t));
    root.querySelectorAll('.wd-pane').forEach(p => p.classList.toggle('hidden', p.dataset.p !== t.dataset.t));
  }));
  function fileMenu(t) {
    const r = t.getBoundingClientRect();
    contextMenu(r.left, r.bottom, [
      { label: 'New blank document', hint: 'Ctrl+N', icon: I.file, action: () => newDoc() },
      { label: 'New from template', submenu: [
        { label: 'Letter', action: () => newDoc('letter') },
        { label: 'Resume', action: () => newDoc('resume') },
        { label: 'Report', action: () => newDoc('report') },
      ] },
      { label: 'Open…', hint: 'Ctrl+O', icon: I.open, action: openFile },
      '-',
      { label: 'Save', hint: 'Ctrl+S', icon: I.save, action: () => save(false) },
      { label: 'Save As…', hint: 'F12', action: () => save(true) },
      { label: 'Download a copy (.docx)', icon: I.download, action: async () => { if (await save(false)) downloadNode(getNode(st.path)); } },
      '-',
      { label: 'Print…', hint: 'Ctrl+P', action: print },
      { label: 'Export as PDF…', action: () => { notify('Word', 'Choose "Save as PDF" as the printer.', I.word, { silent: true }); print(); } },
      '-',
      { label: 'Open file location', icon: I.folder, disabled: !st.path, action: () => launch('explorer', { path: st.path.slice(0, -1) }) },
      { label: 'Close', action: () => win.close() },
    ]);
  }

  /* ---------- find & replace ---------- */
  const fInput = findBar.querySelector('.nf-find'), rInput = findBar.querySelector('.nf-repl');
  function showFind(replace) {
    findBar.classList.remove('hidden');
    findBar.classList.toggle('with-replace', replace);
    const sel = getSelection().toString();
    if (sel && !sel.includes('\n')) fInput.value = sel;
    fInput.focus(); fInput.select();
    countMatches();
  }
  function textNodes() {
    const out = [];
    const w = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }
  function countMatches() {
    const q = fInput.value.toLowerCase();
    findBar.querySelector('.nf-count').textContent = q ? `${(page.innerText.toLowerCase().split(q).length - 1)} results` : '';
  }
  function findNext() {
    const q = fInput.value.toLowerCase();
    if (!q) return false;
    const nodes = textNodes();
    const s = getSelection();
    let startNode = null, startOff = 0;
    if (s.rangeCount && page.contains(s.anchorNode)) { const r = s.getRangeAt(0); startNode = r.endContainer; startOff = r.endOffset; }
    let idx = startNode ? nodes.indexOf(startNode) : 0;
    if (idx < 0) { idx = 0; startOff = 0; }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = pass ? 0 : idx; i < nodes.length; i++) {
        const from = !pass && i === idx ? startOff : 0;
        const at = nodes[i].nodeValue.toLowerCase().indexOf(q, from);
        if (at >= 0) {
          const r = document.createRange();
          r.setStart(nodes[i], at); r.setEnd(nodes[i], at + q.length);
          s.removeAllRanges(); s.addRange(r);
          savedRange = r.cloneRange();
          const rect = r.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
          if (rect.top < cr.top || rect.bottom > cr.bottom) canvas.scrollTop += rect.top - cr.top - cr.height / 3;
          return true;
        }
      }
    }
    msgDialog('Word', `We couldn't find what you were looking for: "${esc(fInput.value)}"`, 'info');
    return false;
  }
  function replaceOne() {
    const s = getSelection();
    if (s.toString().toLowerCase() === fInput.value.toLowerCase() && fInput.value) {
      document.execCommand('insertText', false, rInput.value);
      setDirty(true);
    }
    findNext();
    countMatches();
  }
  function replaceAll() {
    const q = fInput.value;
    if (!q) return;
    let n = 0;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    for (const t of textNodes()) {
      const v = t.nodeValue.replace(re, () => { n++; return rInput.value; });
      if (v !== t.nodeValue) t.nodeValue = v;
    }
    if (n) setDirty(true);
    msgDialog('Word', `All done. We made ${n} replacement${n === 1 ? '' : 's'}.`, 'info');
    countMatches();
  }
  findBar.querySelector('.nf-next').addEventListener('click', findNext);
  findBar.querySelector('.nf-one').addEventListener('click', replaceOne);
  findBar.querySelector('.nf-all').addEventListener('click', replaceAll);
  findBar.querySelector('.nf-x').addEventListener('click', () => { findBar.classList.add('hidden'); restore(); });
  fInput.addEventListener('input', countMatches);
  fInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(); } if (e.key === 'Escape') { findBar.classList.add('hidden'); restore(); } });
  rInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } if (e.key === 'Escape') findBar.classList.add('hidden'); });

  /* ---------- status bar ---------- */
  const pageH = () => (st.landscape ? 12240 : 15840) / 15;
  const pageCount = () => Math.max(1, Math.ceil((page.scrollHeight - 1) / pageH()) + page.querySelectorAll('.page-break').length);
  let statusT = null;
  function updateStatus() {
    clearTimeout(statusT);
    statusT = setTimeout(() => {
      const words = (page.innerText.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
      const total = pageCount();
      const cur = Math.min(total, Math.floor(canvas.scrollTop / (zoomBox.offsetHeight / total || 1)) + 1);
      root.querySelector('.ws-page').textContent = `Page ${cur} of ${total}`;
      root.querySelector('.ws-words').textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'}`;
      root.querySelector('.ws-lang').textContent = /[؀-ۿ]/.test(page.innerText) ? 'Arabic (Egypt)' : 'English (United States)';
    }, 120);
  }
  canvas.addEventListener('scroll', updateStatus);
  function setZoom(z) { st.zoom = Math.max(30, Math.min(300, z)); applyPage(); }
  root.querySelector('.ws-zoom').addEventListener('input', (e) => setZoom(+e.target.value));
  root.querySelectorAll('.ws-z').forEach(b => b.addEventListener('click', () => setZoom(st.zoom + (b.dataset.z === '+' ? 10 : -10))));
  root.querySelector('.ws-words').addEventListener('click', commands.wordCount);

  /* ---------- editing events ---------- */
  page.addEventListener('input', () => {
    setDirty(true);
    if (!page.firstElementChild) page.innerHTML = '<p><br></p>';
    updateStatus();
  });
  page.addEventListener('paste', (e) => {
    const dt = e.clipboardData;
    if (!dt) return;
    const img = [...dt.items].find(i => i.type.startsWith('image/'));
    if (img) {
      e.preventDefault();
      const fr = new FileReader(); fr.onload = () => insertImage(fr.result); fr.readAsDataURL(img.getAsFile());
      return;
    }
    const html = dt.getData('text/html');
    if (html) { e.preventDefault(); document.execCommand('insertHTML', false, sanitize(html)); setDirty(true); }
  });
  page.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 's') { e.preventDefault(); save(e.shiftKey); }
    else if (e.key === 'F12') { e.preventDefault(); save(true); }
    else if (ctrl && k === 'o') { e.preventDefault(); openFile(); }
    else if (ctrl && k === 'n') { e.preventDefault(); newDoc(); }
    else if (ctrl && k === 'p') { e.preventDefault(); print(); }
    else if (ctrl && k === 'f') { e.preventDefault(); showFind(false); }
    else if (ctrl && k === 'h') { e.preventDefault(); showFind(true); }
    else if (ctrl && k === 'k') { e.preventDefault(); commands.link(); }
    else if (ctrl && k === 'e') { e.preventDefault(); exec('justifyCenter'); }
    else if (ctrl && k === 'l') { e.preventDefault(); exec('justifyLeft'); }
    else if (ctrl && k === 'r') { e.preventDefault(); exec('justifyRight'); }
    else if (ctrl && k === 'j') { e.preventDefault(); exec('justifyFull'); }
    else if (ctrl && k === ']') { e.preventDefault(); commands.grow(); }
    else if (ctrl && k === '[') { e.preventDefault(); commands.shrink(); }
    else if (ctrl && k === '=') { e.preventDefault(); exec(e.shiftKey ? 'superscript' : 'subscript'); }
    else if (ctrl && e.key === 'Enter') { e.preventDefault(); commands.pageBreak(); }
    else if (e.key === 'Enter' && !e.shiftKey && atEndOfStyledBlock()) {
      /* like Word: Enter at the end of a heading/title/quote continues in Normal style */
      e.preventDefault();
      const blk = blocksInSelection(false)[0];
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      if (blk.dir) p.dir = blk.dir;
      blk.after(p);
      const r = document.createRange(); r.setStart(p, 0); r.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      setDirty(true); updateStatus(); updateRibbonState();
    }
    else if (e.key === 'Tab' && !e.target.closest('li')) {
      e.preventDefault();
      const cell = getSelection().anchorNode && getSelection().anchorNode.parentElement && getSelection().anchorNode.parentElement.closest('td, th');
      if (cell) {
        const cells = [...cell.closest('table').querySelectorAll('td, th')];
        const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
        if (next) { const r = document.createRange(); r.selectNodeContents(next); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); }
      } else document.execCommand('insertText', false, '\t');
    } else if (e.key === 'Tab') { e.preventDefault(); document.execCommand(e.shiftKey ? 'outdent' : 'indent'); }
  });

  /* context menu on the page: tables, pictures, links */
  page.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const img = e.target.closest('img');
    const cell = e.target.closest('td, th');
    const a = e.target.closest('a');
    const items = [
      { label: 'Cut', icon: I.cut, hint: 'Ctrl+X', action: () => exec('cut') },
      { label: 'Copy', icon: I.copy, hint: 'Ctrl+C', action: () => exec('copy') },
      { label: 'Paste', icon: I.paste, hint: 'Ctrl+V', action: commands.paste },
    ];
    if (img) {
      items.push('-', { label: 'Picture size', submenu: [25, 50, 75, 100].map(p => ({ label: `${p}% of page width`, action: () => { img.width = Math.round(((st.landscape ? 1056 : 816) - 2 * st.margin / 15) * p / 100); img.removeAttribute('height'); setDirty(true); } })) },
        { label: 'Delete picture', icon: I.trash, action: () => { img.remove(); setDirty(true); } });
    }
    if (cell) {
      const tr = cell.parentElement, table = cell.closest('table');
      const ci = [...tr.cells].indexOf(cell);
      const newRow = () => { const r = tr.cloneNode(true); r.querySelectorAll('td, th').forEach(c => { c.innerHTML = '<br>'; }); return r; };
      items.push('-', { label: 'Insert', submenu: [
        { label: 'Insert Row Above', action: () => { tr.before(newRow()); setDirty(true); } },
        { label: 'Insert Row Below', action: () => { tr.after(newRow()); setDirty(true); } },
        { label: 'Insert Column Left', action: () => { [...table.rows].forEach(r => { const c = document.createElement('td'); c.innerHTML = '<br>'; r.cells[ci] ? r.cells[ci].before(c) : r.appendChild(c); }); setDirty(true); } },
        { label: 'Insert Column Right', action: () => { [...table.rows].forEach(r => { const c = document.createElement('td'); c.innerHTML = '<br>'; r.cells[ci] ? r.cells[ci].after(c) : r.appendChild(c); }); setDirty(true); } },
      ] }, { label: 'Delete', submenu: [
        { label: 'Delete Row', action: () => { if (table.rows.length > 1) tr.remove(); else table.remove(); setDirty(true); } },
        { label: 'Delete Column', action: () => { [...table.rows].forEach(r => r.cells[ci] && r.cells[ci].remove()); if (!table.rows[0] || !table.rows[0].cells.length) table.remove(); setDirty(true); } },
        { label: 'Delete Table', action: () => { table.remove(); setDirty(true); } },
      ] }, { label: 'Shade cell', submenu: ['#ffffff', '#f2f2f2', '#deeaf6', '#e2efd9', '#fff2cc', '#fbe4d5'].map(c => ({ label: c === '#ffffff' ? 'No color' : c, icon: `<span style="display:block;width:14px;height:14px;background:${c};border:1px solid #999"></span>`, action: () => { cell.style.backgroundColor = c === '#ffffff' ? '' : c; setDirty(true); } })) });
    }
    if (a) items.push('-', { label: 'Open Hyperlink', icon: I.globe, action: () => launch('edge', { url: a.href }) }, { label: 'Remove Hyperlink', action: () => { a.replaceWith(...a.childNodes); setDirty(true); } });
    items.push('-', { label: 'Font…', action: () => { root.querySelector('.wd-tab[data-t="home"]').click(); fontSel.focus(); } },
      { label: 'Search with Bing', icon: I.search, disabled: !getSelection().toString().trim(), action: () => launch('edge', { url: 'https://www.bing.com/search?q=' + encodeURIComponent(getSelection().toString().trim()) }) });
    contextMenu(e.clientX, e.clientY, items);
  });
  page.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); launch('edge', { url: a.href }); }
  });

  /* drop: pictures from Explorer/PC, or a document to open */
  page.addEventListener('dragover', (e) => { if (dragKind(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  page.addEventListener('drop', async (e) => {
    const k = dragKind(e);
    if (!k) return;
    e.preventDefault();
    if (k === 'internal') {
      const p = currentDrag();
      const node = p && getNode([...p.dir, p.names[0]]);
      if (!node) return;
      if (kindOf(node) === 'img') insertImage(node.content);
      else if (await confirmDiscard()) load([...p.dir, node.name]);
    } else {
      const f = e.dataTransfer.files[0];
      if (!f) return;
      const fr = new FileReader();
      if (f.type.startsWith('image/')) { fr.onload = () => insertImage(fr.result); fr.readAsDataURL(f); }
      else if (/\.docx$/i.test(f.name)) {
        if (!(await confirmDiscard())) return;
        const res = await docxToHtml(new Uint8Array(await f.arrayBuffer()));
        st.path = null; st.untitled = f.name; st.landscape = res.landscape; st.margin = res.margin;
        setContent(res.html); st.dirty = true; applyPage(); refreshTitle();
      }
    }
  });

  const onWinKey = (e) => {
    if (document.querySelector('.window.active') !== win.el || page.contains(e.target)) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); save(e.shiftKey); }
    if ((e.ctrlKey || e.metaKey) && k === 'o') { e.preventDefault(); openFile(); }
  };
  document.addEventListener('keydown', onWinKey);
  win.onclose(() => { document.removeEventListener('selectionchange', onSelChange); document.removeEventListener('keydown', onWinKey); });
  win.onRelaunch = null;

  applyPage();
  refreshTitle();
  if (arg && arg.path) load(arg.path);
  else { page.focus(); placeCaretAtStart(); }
  return win;
}

let untitledN = 0;
function nextUntitled() { untitledN++; return `Document${untitledN}`; }

function alignIcon(t) {
  const lines = { l: [[4, 20], [4, 14], [4, 20], [4, 12]], c: [[4, 20], [7, 17], [4, 20], [8, 16]], r: [[4, 20], [10, 20], [4, 20], [12, 20]], j: [[4, 20], [4, 20], [4, 20], [4, 20]] }[t];
  return `<svg viewBox="0 0 24 24">${lines.map(([a, b], i) => `<path d="M${a} ${6 + i * 4} H${b}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`).join('')}</svg>`;
}
