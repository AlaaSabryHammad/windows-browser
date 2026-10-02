/* .docx ⇄ HTML. The writer produces a real Office Open XML document that opens in Microsoft Word / LibreOffice / Google Docs. */
import { zip, unzip, xmlEsc, parseXML, kids, kid, all, attr, dataURLToBytes, mimeOf, toDataURL } from './zip.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PX_TO_TWIP = 15;
const PX_TO_EMU = 9525;

/* ---------- colors ---------- */
let colorCtx = null;
export function toHex(c) {
  if (!c || c === 'transparent' || /rgba\([^)]*,\s*0\)/.test(c)) return null;
  if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d');
  colorCtx.fillStyle = '#000000';
  colorCtx.fillStyle = c;
  const v = colorCtx.fillStyle;
  if (v.startsWith('#')) return v.slice(1).toUpperCase();
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
}
const FONT_SIZES = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 };
function sizeToPt(v) {
  if (!v) return null;
  const n = parseFloat(v);
  if (isNaN(n)) return null;
  if (v.endsWith('pt')) return n;
  if (v.endsWith('px')) return n * 0.75;
  if (v.endsWith('em') || v.endsWith('rem')) return n * 11;
  return null;
}

/* =========================================================================
 *  HTML → DOCX
 * ========================================================================= */
export function htmlToDocx(root, { landscape = false, margin = 1440, title = '' } = {}) {
  const rels = [];          /* {id, type, target, external} */
  const media = [];         /* {name, data} */
  let relN = 3;             /* rId1 styles, rId2 numbering */
  let picN = 1;
  const contentWidthPx = ((landscape ? 15840 : 12240) - margin * 2) / PX_TO_TWIP;

  const addRel = (type, target, external = false) => {
    const id = 'rId' + relN++;
    rels.push({ id, type, target, external });
    return id;
  };

  /* ---- runs ---- */
  function rPr(f) {
    let x = '';
    if (f.font) x += `<w:rFonts w:ascii="${xmlEsc(f.font)}" w:hAnsi="${xmlEsc(f.font)}" w:cs="${xmlEsc(f.font)}"/>`;
    if (f.b) x += '<w:b/><w:bCs/>';
    if (f.i) x += '<w:i/><w:iCs/>';
    if (f.strike) x += '<w:strike/>';
    if (f.color) x += `<w:color w:val="${f.color}"/>`;
    if (f.sz) x += `<w:sz w:val="${Math.round(f.sz * 2)}"/><w:szCs w:val="${Math.round(f.sz * 2)}"/>`;
    if (f.hl) x += `<w:shd w:val="clear" w:color="auto" w:fill="${f.hl}"/>`;
    if (f.u) x += '<w:u w:val="single"/>';
    if (f.sup) x += '<w:vertAlign w:val="superscript"/>';
    if (f.sub) x += '<w:vertAlign w:val="subscript"/>';
    if (f.rtl) x += '<w:rtl/>';
    if (f.link) x = '<w:rStyle w:val="Hyperlink"/>' + x;
    return x ? `<w:rPr>${x}</w:rPr>` : '';
  }

  function textRuns(text, f) {
    const pieces = text.split('\t');
    return pieces.map((p, i) => (i ? `<w:r>${rPr(f)}<w:tab/></w:r>` : '') + (p ? `<w:r>${rPr(f)}<w:t xml:space="preserve">${xmlEsc(p)}</w:t></w:r>` : '')).join('');
  }

  function imageRun(img) {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('data:image/')) return '';
    const mime = mimeOf(src);
    const ext = mime === 'image/jpeg' ? 'jpeg' : mime === 'image/gif' ? 'gif' : mime === 'image/png' ? 'png' : null;
    if (!ext) return '';   /* svg/webp: Word can't take them without a fallback */
    const name = `image${picN}.${ext}`;
    media.push({ name: 'word/media/' + name, data: dataURLToBytes(src) });
    const rid = addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', 'media/' + name);
    let w = img.width || img.naturalWidth || 300, h = img.height || img.naturalHeight || 200;
    if (w > contentWidthPx) { h = h * contentWidthPx / w; w = contentWidthPx; }
    const cx = Math.round(w * PX_TO_EMU), cy = Math.round(h * PX_TO_EMU);
    const id = picN++;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  function inlineFmt(el, f) {
    const n = { ...f };
    const t = el.tagName;
    if (t === 'B' || t === 'STRONG') n.b = true;
    if (t === 'I' || t === 'EM') n.i = true;
    if (t === 'U' || t === 'INS') n.u = true;
    if (t === 'S' || t === 'STRIKE' || t === 'DEL') n.strike = true;
    if (t === 'SUP') n.sup = true;
    if (t === 'SUB') n.sub = true;
    if (t === 'FONT') {
      if (el.getAttribute('color')) n.color = toHex(el.getAttribute('color'));
      if (el.getAttribute('face')) n.font = el.getAttribute('face').split(',')[0].replace(/["']/g, '').trim();
      if (el.getAttribute('size')) n.sz = FONT_SIZES[el.getAttribute('size')] || n.sz;
    }
    const s = el.style;
    if (s) {
      if (s.fontWeight === 'bold' || +s.fontWeight >= 600) n.b = true;
      if (s.fontWeight === 'normal' || (s.fontWeight && +s.fontWeight < 600)) n.b = false;
      if (s.fontStyle === 'italic') n.i = true;
      const td = s.textDecorationLine || s.textDecoration || '';
      if (td.includes('underline')) n.u = true;
      if (td.includes('line-through')) n.strike = true;
      if (s.color) n.color = toHex(s.color);
      if (s.backgroundColor) n.hl = toHex(s.backgroundColor);
      if (s.fontSize) n.sz = sizeToPt(s.fontSize) || n.sz;
      if (s.fontFamily) n.font = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (s.verticalAlign === 'super') n.sup = true;
      if (s.verticalAlign === 'sub') n.sub = true;
    }
    if (el.getAttribute && el.getAttribute('dir') === 'rtl') n.rtl = true;
    return n;
  }

  function inline(node, f) {
    if (node.nodeType === 3) return textRuns(node.nodeValue.replace(/ /g, ' ').replace(/[\r\n]+/g, ' '), f);
    if (node.nodeType !== 1) return '';
    const t = node.tagName;
    if (t === 'BR') return '<w:r><w:br/></w:r>';
    if (t === 'IMG') return imageRun(node);
    if (t === 'STYLE' || t === 'SCRIPT') return '';
    const n = inlineFmt(node, f);
    if (t === 'A' && node.getAttribute('href')) {
      const rid = addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', node.getAttribute('href'), true);
      return `<w:hyperlink r:id="${rid}" w:history="1">${[...node.childNodes].map(c => inline(c, { ...n, link: true })).join('')}</w:hyperlink>`;
    }
    return [...node.childNodes].map(c => inline(c, n)).join('');
  }

  /* ---- paragraphs ---- */
  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'LI', 'TABLE', 'HR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);
  const isBlock = (n) => n.nodeType === 1 && BLOCK.has(n.tagName);

  function pPr(el, ctx) {
    let x = '';
    const t = el ? el.tagName : '';
    let style = null;
    if (/^H[1-6]$/.test(t)) style = el.classList.contains('title') ? 'Title' : 'Heading' + Math.min(3, +t[1]);
    else if (t === 'BLOCKQUOTE' && !(el.style.marginLeft || el.style.margin)) style = 'Quote';
    else if (ctx.list) style = 'ListParagraph';
    if (style) x += `<w:pStyle w:val="${style}"/>`;
    if (ctx.list) x += `<w:numPr><w:ilvl w:val="${Math.min(8, ctx.list.level)}"/><w:numId w:val="${ctx.list.ordered ? 2 : 1}"/></w:numPr>`;
    const align = (el && (el.style.textAlign || el.getAttribute('align'))) || ctx.align;
    const rtl = (el && el.getAttribute('dir') === 'rtl') || ctx.rtl;
    if (rtl) x += '<w:bidi/>';
    const indentPx = ctx.indent + (el && t === 'BLOCKQUOTE' && (el.style.marginLeft || el.style.margin) ? 40 : 0) + (el ? parseFloat(el.style.marginLeft || el.style.paddingLeft || 0) || 0 : 0);
    if (indentPx && !ctx.list) x += `<w:ind w:left="${Math.round(indentPx * PX_TO_TWIP)}"/>`;
    const jc = { left: rtl ? 'right' : 'left', center: 'center', right: rtl ? 'left' : 'right', justify: 'both', start: null, end: 'right' }[align];
    if (jc) x += `<w:jc w:val="${jc}"/>`;
    return x ? `<w:pPr>${x}</w:pPr>` : '';
  }

  function para(el, nodes, ctx) {
    const f = { rtl: (el && el.getAttribute('dir') === 'rtl') || ctx.rtl };
    if (el) Object.assign(f, inlineFmt(el, f));
    if (el && /^H[1-6]$/.test(el.tagName)) { delete f.b; delete f.sz; }
    return `<w:p>${pPr(el, ctx)}${nodes.map(n => inline(n, f)).join('')}</w:p>`;
  }

  function table(el, ctx) {
    const rows = [...el.querySelectorAll(':scope > tr, :scope > tbody > tr, :scope > thead > tr, :scope > tfoot > tr')];
    const cols = Math.max(1, ...rows.map(r => [...r.cells].reduce((a, c) => a + (c.colSpan || 1), 0)));
    const colW = Math.floor(((landscape ? 15840 : 12240) - margin * 2) / cols);
    let x = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('') +
      `</w:tblBorders><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${colW}"/>`).join('')}</w:tblGrid>`;
    for (const r of rows) {
      x += '<w:tr>';
      for (const c of r.cells) {
        const span = c.colSpan || 1;
        const shade = toHex(c.style.backgroundColor);
        const inner = blocks(c, { ...ctx, list: null, indent: 0 }) || '<w:p/>';
        x += `<w:tc><w:tcPr><w:tcW w:w="${colW * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}</w:tcPr>${inner.endsWith('</w:tbl>') ? inner + '<w:p/>' : inner}</w:tc>`;
      }
      x += '</w:tr>';
    }
    return x + '</w:tbl>';
  }

  /* convert a container's children into block XML */
  function blocks(container, ctx) {
    let out = '';
    let buf = [];
    const flush = () => {
      if (buf.some(n => n.nodeType === 1 || n.nodeValue.trim())) out += para(null, buf, ctx);
      buf = [];
    };
    for (const n of container.childNodes) {
      if (!isBlock(n)) { buf.push(n); continue; }
      flush();
      const t = n.tagName;
      if (n.classList.contains('page-break')) { out += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; continue; }
      if (t === 'HR') { out += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>'; continue; }
      if (t === 'TABLE') { out += table(n, ctx); continue; }
      const nctx = { ...ctx };
      if (n.getAttribute('dir') === 'rtl') nctx.rtl = true;
      if (n.style.textAlign) nctx.align = n.style.textAlign;
      if (t === 'UL' || t === 'OL') {
        const level = ctx.list ? ctx.list.level + 1 : 0;
        for (const li of n.children) {
          if (li.tagName !== 'LI') { out += blocks(li, nctx); continue; }
          const lctx = { ...nctx, list: { ordered: t === 'OL', level } };
          const inlineKids = [...li.childNodes].filter(c => !isBlock(c));
          const blockKids = [...li.childNodes].filter(isBlock);
          out += para(li, inlineKids, lctx);
          for (const b of blockKids) {
            const tmp = document.createElement('div');
            tmp.appendChild(b.cloneNode(true));
            out += blocks(tmp, { ...lctx, list: b.tagName === 'UL' || b.tagName === 'OL' ? lctx.list : null });
          }
        }
        continue;
      }
      /* does it contain nested blocks? */
      if ([...n.childNodes].some(isBlock) && !/^H[1-6]$/.test(t)) {
        if (t === 'BLOCKQUOTE') nctx.indent = (ctx.indent || 0) + 40;
        out += blocks(n, nctx);
        continue;
      }
      out += para(n, [...n.childNodes], ctx);
    }
    flush();
    return out;
  }

  let body = blocks(root, { list: null, indent: 0, rtl: false, align: null });
  if (!body || body.endsWith('</w:tbl>')) body += '<w:p/>';
  const pg = landscape ? '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>' : '<w:pgSz w:w="12240" w:h="15840"/>';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr>${pg}<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/></w:sectPr></w:body></w:document>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${rels.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEsc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return zip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>Windows 10 Web</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/numbering.xml', data: NUMBERING },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    ...media,
  ]);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const heading = (id, name, sz, color, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="${id.slice(-1) - 1}"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:color w:val="${color}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>${extra}</w:rPr></w:style>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:bidi="ar-EG"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${heading('Heading1', 'heading 1', 32, '2F5496')}${heading('Heading2', 'heading 2', 26, '2F5496')}${heading('Heading3', 'heading 3', 24, '1F3763')}
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:spacing w:val="-10"/><w:kern w:val="28"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="200"/><w:ind w:left="864" w:right="864"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="404040"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

const lvl = (i, fmt, text) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W_NS}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => lvl(i, 'bullet', ['•', 'o', '▪'][i % 3])).join('')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => lvl(i, ['decimal', 'lowerLetter', 'lowerRoman'][i % 3], `%${i + 1}.`)).join('')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

/* =========================================================================
 *  DOCX → HTML
 * ========================================================================= */
const escHTML = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const HL = { yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000', darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000', darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0', black: '000000' };
const on = (el) => el && attr(el, 'val') !== '0' && attr(el, 'val') !== 'false' && attr(el, 'val') !== 'none';

export async function docxToHtml(bytes) {
  const files = await unzip(bytes);
  const doc = parseXML(files.get('word/document.xml'));
  if (!doc) throw new Error('This file is not a Word document.');
  const relDoc = parseXML(files.get('word/_rels/document.xml.rels'));
  const rels = {};
  for (const r of all(relDoc, 'Relationship')) rels[attr(r, 'Id')] = { target: attr(r, 'Target'), type: attr(r, 'Type') };

  /* styles: id → { heading level | title | quote } */
  const styleInfo = {};
  const stylesDoc = parseXML(files.get('word/styles.xml'));
  for (const s of all(stylesDoc, 'style')) {
    const id = attr(s, 'styleId');
    const name = (attr(kid(s, 'name'), 'val') || id || '').toLowerCase();
    const m = name.match(/heading\s*(\d)/) || (id || '').match(/^Heading(\d)$/i);
    const outline = attr(all(s, 'outlineLvl')[0], 'val');
    styleInfo[id] = m ? { h: Math.min(3, +m[1]) } : name === 'title' ? { title: true } : /quote/.test(name) ? { quote: true } : outline != null && +outline < 3 ? { h: +outline + 1 } : {};
  }

  /* numbering: numId → ilvl → ordered? */
  const numFmt = {};
  const numDoc = parseXML(files.get('word/numbering.xml'));
  if (numDoc) {
    const abs = {};
    for (const a of all(numDoc, 'abstractNum')) {
      abs[attr(a, 'abstractNumId')] = Object.fromEntries(kids(a, 'lvl').map(l => [attr(l, 'ilvl'), attr(kid(l, 'numFmt'), 'val')]));
    }
    for (const n of all(numDoc, 'num')) numFmt[attr(n, 'numId')] = abs[attr(kid(n, 'abstractNumId'), 'val')] || {};
  }

  const mediaURL = (rid) => {
    const r = rels[rid];
    if (!r) return null;
    const path = r.target.startsWith('/') ? r.target.slice(1) : 'word/' + r.target.replace(/^\.\//, '');
    const data = files.get(path);
    if (!data) return null;
    const ext = path.split('.').pop().toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' }[ext];
    return mime ? toDataURL(data, mime) : null;
  };

  function runHTML(r) {
    const pr = kid(r, 'rPr');
    const styles = [];
    let open = '', close = '';
    const wrap = (tag) => { open += `<${tag}>`; close = `</${tag}>` + close; };
    if (pr) {
      if (on(kid(pr, 'b'))) wrap('b');
      if (on(kid(pr, 'i'))) wrap('i');
      if (on(kid(pr, 'u'))) wrap('u');
      if (on(kid(pr, 'strike')) || on(kid(pr, 'dstrike'))) wrap('s');
      const va = attr(kid(pr, 'vertAlign'), 'val');
      if (va === 'superscript') wrap('sup');
      if (va === 'subscript') wrap('sub');
      const color = attr(kid(pr, 'color'), 'val');
      if (color && color !== 'auto') styles.push(`color:#${color}`);
      const hl = attr(kid(pr, 'highlight'), 'val');
      const shd = attr(kid(pr, 'shd'), 'fill');
      if (hl && HL[hl]) styles.push(`background-color:#${HL[hl]}`);
      else if (shd && shd !== 'auto') styles.push(`background-color:#${shd}`);
      const sz = attr(kid(pr, 'sz'), 'val');
      if (sz) styles.push(`font-size:${+sz / 2}pt`);
      const font = attr(kid(pr, 'rFonts'), 'ascii') || attr(kid(pr, 'rFonts'), 'hAnsi');
      if (font) styles.push(`font-family:'${font.replace(/'/g, '')}'`);
    }
    const rtl = pr && on(kid(pr, 'rtl'));
    let inner = '';
    for (const c of r.children) {
      const n = c.localName;
      if (n === 't') inner += escHTML(c.textContent);
      else if (n === 'tab') inner += '<span class="tab">\t</span>';
      else if (n === 'br' || n === 'cr') inner += attr(c, 'type') === 'page' ? '\u0000PAGEBREAK\u0000' : '<br>';
      else if (n === 'noBreakHyphen') inner += '-';
      else if (n === 'sym') inner += '•';
      else if (n === 'drawing' || n === 'pict' || n === 'object') {
        const blip = all(c, 'blip')[0];
        const rid = blip ? attr(blip, 'embed') : attr(all(c, 'imagedata')[0], 'id');
        const src = rid && mediaURL(rid);
        const ext = all(c, 'extent')[0];
        const w = ext ? Math.round(+attr(ext, 'cx') / PX_TO_EMU) : null;
        if (src) inner += `<img src="${src}"${w ? ` width="${w}"` : ''}>`;
      }
    }
    if (!inner) return '';
    if (styles.length || rtl) return `<span${rtl ? ' dir="rtl"' : ''}${styles.length ? ` style="${styles.join(';')}"` : ''}>${open}${inner}${close}</span>`;
    return open + inner + close;
  }

  function inlineHTML(el) {
    let h = '';
    for (const c of el.children) {
      const n = c.localName;
      if (n === 'r') h += runHTML(c);
      else if (n === 'hyperlink') {
        const r = rels[attr(c, 'id')];
        const href = r ? r.target : attr(c, 'anchor') ? '#' + attr(c, 'anchor') : null;
        const inner = inlineHTML(c);
        h += href ? `<a href="${escHTML(href)}">${inner}</a>` : inner;
      } else if (['ins', 'smartTag', 'fldSimple', 'sdt', 'sdtContent', 'customXml', 'bdo', 'dir'].includes(n)) h += inlineHTML(c);
    }
    return h;
  }

  const lists = [];   /* stack of {tag} */
  let html = '';
  const closeLists = (depth = 0) => { while (lists.length > depth) html += `</li></${lists.pop()}>`; };

  function paragraph(p) {
    const pr = kid(p, 'pPr');
    const sid = attr(kid(pr, 'pStyle'), 'val');
    const info = styleInfo[sid] || {};
    const jc = attr(kid(pr, 'jc'), 'val');
    const bidi = on(kid(pr, 'bidi'));
    const align = { center: 'center', right: bidi ? 'left' : 'right', end: 'right', both: 'justify', distribute: 'justify', left: bidi ? 'right' : null, start: null }[jc];
    const numPr = kid(pr, 'numPr');
    const numId = attr(kid(numPr, 'numId'), 'val');
    const ilvl = +(attr(kid(numPr, 'ilvl'), 'val') || 0);
    const indLeft = +(attr(kid(pr, 'ind'), 'left') || attr(kid(pr, 'ind'), 'start') || 0);
    let inner = inlineHTML(p);
    const attrs = (align ? ` style="text-align:${align}${!numPr && indLeft ? `;margin-left:${Math.round(indLeft / PX_TO_TWIP)}px` : ''}"` : !numPr && indLeft && !info.quote ? ` style="margin-left:${Math.round(indLeft / PX_TO_TWIP)}px"` : '') + (bidi ? ' dir="rtl"' : '');

    /* split on page breaks */
    const breaks = inner.split('\u0000PAGEBREAK\u0000');
    inner = breaks.shift();

    if (numPr && numId && numId !== '0') {
      const ordered = (numFmt[numId] || {})[ilvl] && (numFmt[numId] || {})[ilvl] !== 'bullet';
      const tag = ordered ? 'ol' : 'ul';
      if (lists.length > ilvl + 1) closeLists(ilvl + 1);
      if (lists.length === ilvl + 1 && lists[ilvl] !== tag) closeLists(ilvl);
      if (lists.length === ilvl + 1) html += '</li>';
      while (lists.length < ilvl + 1) { html += `<${tag}>`; lists.push(tag); if (lists.length < ilvl + 1) html += '<li>'; }
      html += `<li${attrs}>${inner || '<br>'}`;
    } else {
      closeLists();
      const tag = info.h ? `h${info.h}` : info.title ? 'h1' : info.quote ? 'blockquote' : 'p';
      html += `<${tag}${info.title ? ' class="title"' : ''}${attrs}>${inner || '<br>'}</${tag}>`;
    }
    for (const rest of breaks) { closeLists(); html += `<div class="page-break" contenteditable="false"></div>${rest ? `<p${attrs}>${rest}</p>` : ''}`; }
  }

  function tableHTML(tbl) {
    let h = '<table>';
    for (const tr of kids(tbl, 'tr')) {
      h += '<tr>';
      for (const tc of kids(tr, 'tc')) {
        const pr = kid(tc, 'tcPr');
        const span = +(attr(kid(pr, 'gridSpan'), 'val') || 1);
        const vm = kid(pr, 'vMerge');
        if (vm && attr(vm, 'val') !== 'restart') continue;
        const fill = attr(kid(pr, 'shd'), 'fill');
        const saved = html; html = '';
        bodyChildren(tc);
        closeLists();
        const cell = html; html = saved;
        h += `<td${span > 1 ? ` colspan="${span}"` : ''}${fill && fill !== 'auto' ? ` style="background-color:#${fill}"` : ''}>${cell || '<br>'}</td>`;
      }
      h += '</tr>';
    }
    return h + '</table>';
  }

  function bodyChildren(el) {
    for (const c of el.children) {
      const n = c.localName;
      if (n === 'p') paragraph(c);
      else if (n === 'tbl') { closeLists(); html += tableHTML(c); }
      else if (n === 'sdt') bodyChildren(kid(c, 'sdtContent') || c);
      else if (n === 'customXml' || n === 'sdtContent') bodyChildren(c);
    }
  }

  const body = all(doc, 'body')[0];
  bodyChildren(body);
  closeLists();

  const sect = all(body, 'sectPr').pop();
  const pgSz = kid(sect, 'pgSz');
  const landscape = attr(pgSz, 'orient') === 'landscape' || (+attr(pgSz, 'w') > +attr(pgSz, 'h'));
  const margin = +(attr(kid(sect, 'pgMar'), 'left') || 1440);
  return { html: html || '<p><br></p>', landscape, margin };
}

/* document text for previews / search */
export async function docxText(bytes) {
  const { html } = await docxToHtml(bytes);
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.innerText;
}
