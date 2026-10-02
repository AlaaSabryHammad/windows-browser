/* Spreadsheet model + formula engine (Excel-style). */

/* ---------- addresses ---------- */
export function colName(c) {
  let s = '';
  c++;
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}
export function colIndex(name) {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export const addr = (c, r) => colName(c) + (r + 1);
export function parseAddr(a) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a);
  return m ? { c: colIndex(m[1]), r: +m[2] - 1 } : null;
}

/* ---------- values ---------- */
export class XLError { constructor(code) { this.error = code; } toString() { return this.error; } }
export const ERR = (code) => new XLError(code);
export const isErr = (v) => v instanceof XLError;
const EPOCH = Date.UTC(1899, 11, 30);
export const dateToSerial = (d) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - EPOCH) / 86400000;
export const serialToDate = (n) => { const d = new Date(EPOCH + Math.round(n * 86400000)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()); };

/* literal typed into a cell → value */
export function literal(raw) {
  if (raw == null || raw === '') return null;
  if (raw.startsWith("'")) return raw.slice(1);
  const t = raw.trim();
  if (/^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i.test(t)) return Number(t);
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (/^[-+]?(\d+(\.\d*)?|\.\d+)%$/.test(t)) return Number(t.slice(0, -1)) / 100;
  if (/^[$€£][-+]?\d[\d,]*(\.\d+)?$/.test(t)) return Number(t.slice(1).replace(/,/g, ''));
  if (/^(true|false)$/i.test(t)) return t.toUpperCase() === 'TRUE';
  if (/^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!)$/.test(t)) return ERR(t);
  /* dates: 2026-10-02, 10/2/2026 */
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return { date: dateToSerial(new Date(+m[1], +m[2] - 1, +m[3])) };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return { date: dateToSerial(new Date(+m[3], +m[1] - 1, +m[2])) };
  return raw;
}

/* ---------- tokenizer ---------- */
const SHEET = "(?:'((?:[^']|'')+)'|([A-Za-z_][\\w.]*))!";
const REF = '(\\$?[A-Za-z]{1,3}\\$?\\d+)';
const TOKEN_RE = new RegExp(
  '\\s+|' +
  `(?<str>"(?:[^"]|"")*")|` +
  `(?<err>#(?:DIV\\/0!|N\\/A|NAME\\?|NULL!|NUM!|REF!|VALUE!))|` +
  `(?<range>(?:${SHEET})?${REF}:${REF})|` +
  `(?<colrange>(?:${SHEET})?\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3})|` +
  `(?<ref>(?:${SHEET})?${REF}(?![\\w(]))|` +
  `(?<num>\\d+(?:\\.\\d*)?(?:[eE][-+]?\\d+)?|\\.\\d+(?:[eE][-+]?\\d+)?)|` +
  `(?<func>[A-Za-z_][\\w.]*(?=\\s*\\())|` +
  `(?<bool>TRUE|FALSE)(?![\\w(])|` +
  `(?<name>[A-Za-z_][\\w.]*)|` +
  `(?<op><>|<=|>=|[-+*/^&=<>%(),;:])`,
  'gy');

function sheetFrom(text) {
  const m = /^(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!/.exec(text);
  return m ? { sheet: (m[1] || m[2]).replace(/''/g, "'"), rest: text.slice(m[0].length) } : { sheet: null, rest: text };
}

export function tokenize(src) {
  const out = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while (TOKEN_RE.lastIndex < src.length && (m = TOKEN_RE.exec(src))) {
    const g = m.groups;
    if (g.str != null) out.push({ t: 'str', v: g.str.slice(1, -1).replace(/""/g, '"') });
    else if (g.err) out.push({ t: 'err', v: g.err });
    else if (g.range) {
      const { sheet, rest } = sheetFrom(g.range);
      const [a, b] = rest.split(':');
      out.push({ t: 'range', sheet, a: parseAddr(a), b: parseAddr(b) });
    } else if (g.colrange) {
      const { sheet, rest } = sheetFrom(g.colrange);
      const [a, b] = rest.replace(/\$/g, '').split(':');
      out.push({ t: 'range', sheet, a: { c: colIndex(a), r: 0 }, b: { c: colIndex(b), r: 1048575 } });
    } else if (g.ref) {
      const { sheet, rest } = sheetFrom(g.ref);
      out.push({ t: 'ref', sheet, a: parseAddr(rest) });
    } else if (g.num) out.push({ t: 'num', v: Number(g.num) });
    else if (g.func) out.push({ t: 'func', v: g.func.toUpperCase() });
    else if (g.bool) out.push({ t: 'bool', v: g.bool.toUpperCase() === 'TRUE' });
    else if (g.name) out.push({ t: 'name', v: g.name });
    else if (g.op) out.push({ t: 'op', v: g.op === ';' ? ',' : g.op });
  }
  if (TOKEN_RE.lastIndex < src.length) throw new Error('bad token');
  return out;
}

/* ---------- parser ---------- */
export function parse(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
  const expect = (v) => { if (!isOp(v)) throw new Error('expected ' + v); i++; };

  function cmp() {
    let a = concat();
    while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) { const op = toks[i++].v; a = { t: 'bin', op, a, b: concat() }; }
    return a;
  }
  function concat() {
    let a = add();
    while (isOp('&')) { i++; a = { t: 'bin', op: '&', a, b: add() }; }
    return a;
  }
  function add() {
    let a = mul();
    while (isOp('+') || isOp('-')) { const op = toks[i++].v; a = { t: 'bin', op, a, b: mul() }; }
    return a;
  }
  function mul() {
    let a = pow();
    while (isOp('*') || isOp('/')) { const op = toks[i++].v; a = { t: 'bin', op, a, b: pow() }; }
    return a;
  }
  function pow() {
    let a = unary();
    while (isOp('^')) { i++; a = { t: 'bin', op: '^', a, b: unary() }; }
    return a;
  }
  function unary() {
    if (isOp('-')) { i++; return { t: 'neg', a: unary() }; }
    if (isOp('+')) { i++; return unary(); }
    return postfix();
  }
  function postfix() {
    let a = primary();
    while (isOp('%')) { i++; a = { t: 'pct', a }; }
    return a;
  }
  function primary() {
    const tk = toks[i++];
    if (!tk) throw new Error('unexpected end');
    if (tk.t === 'num') return { t: 'lit', v: tk.v };
    if (tk.t === 'str') return { t: 'lit', v: tk.v };
    if (tk.t === 'bool') return { t: 'lit', v: tk.v };
    if (tk.t === 'err') return { t: 'lit', v: ERR(tk.v) };
    if (tk.t === 'ref') return { t: 'ref', sheet: tk.sheet, c: tk.a.c, r: tk.a.r };
    if (tk.t === 'range') return { t: 'range', sheet: tk.sheet, c1: Math.min(tk.a.c, tk.b.c), r1: Math.min(tk.a.r, tk.b.r), c2: Math.max(tk.a.c, tk.b.c), r2: Math.max(tk.a.r, tk.b.r) };
    if (tk.t === 'func') {
      expect('(');
      const args = [];
      if (!isOp(')')) {
        do {
          if (isOp(',') || isOp(')')) args.push({ t: 'lit', v: null });
          else args.push(cmp());
        } while (isOp(',') && ++i);
      }
      expect(')');
      return { t: 'fn', name: tk.v, args };
    }
    if (tk.t === 'name') return { t: 'name', v: tk.v.toUpperCase() };
    if (tk.t === 'op' && tk.v === '(') { const e = cmp(); expect(')'); return e; }
    throw new Error('unexpected ' + tk.v);
  }
  const ast = cmp();
  if (i < toks.length) throw new Error('unexpected ' + toks[i].v);
  return ast;
}

/* ---------- coercion ---------- */
const num = (v) => {
  if (isErr(v)) return v;
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v && v.date != null) return v.date;
  const t = String(v).trim();
  const l = literal(t);
  if (typeof l === 'number') return l;
  if (l && l.date != null) return l.date;
  return ERR('#VALUE!');
};
const str = (v) => {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return fmtGeneral(v);
  if (v && v.date != null) return fmtGeneral(v.date);
  return String(v);
};
const bool = (v) => {
  if (isErr(v)) return v;
  if (typeof v === 'boolean') return v;
  if (v == null || v === '') return false;
  if (typeof v === 'number') return v !== 0;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  return ERR('#VALUE!');
};
const plain = (v) => (v && v.date != null ? v.date : v);

export function fmtGeneral(n) {
  if (!isFinite(n)) return '#NUM!';
  if (Number.isInteger(n) && Math.abs(n) < 1e11) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e11 || a < 1e-9)) return n.toExponential(5).replace(/\.?0+e/, 'E').replace('e', 'E');
  /* like Excel: at most 11 characters including sign and decimal point */
  for (let pr = 10; pr > 1; pr--) {
    const t = String(parseFloat(n.toPrecision(pr)));
    if (t.length <= 11) return t;
  }
  return String(parseFloat(n.toPrecision(1)));
}

/* flatten function arguments; ranges become arrays */
function flat(args, ctx) {
  const out = [];
  for (const a of args) {
    const v = ev(a, ctx);
    if (Array.isArray(v)) { for (const row of v) for (const x of row) out.push({ v: plain(x), fromRange: true }); }
    else out.push({ v: plain(v), fromRange: false });
  }
  return out;
}
function numbers(args, ctx) {
  const out = [];
  for (const { v, fromRange } of flat(args, ctx)) {
    if (isErr(v)) return v;
    if (typeof v === 'number') out.push(v);
    else if (!fromRange && (typeof v === 'boolean' || (typeof v === 'string' && v !== ''))) {
      const n = num(v);
      if (isErr(n)) return n;
      out.push(n);
    }
  }
  return out;
}

function criteria(c) {
  const s = str(plain(c));
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(s);
  const op = m[1] || '=';
  const rhs = m[2];
  const rnum = rhs !== '' && !isNaN(Number(rhs)) ? Number(rhs) : null;
  const re = /[*?]/.test(rhs) ? new RegExp('^' + rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
  return (v) => {
    v = plain(v);
    if (rnum != null && typeof v === 'number') {
      return { '=': v === rnum, '<>': v !== rnum, '<': v < rnum, '>': v > rnum, '<=': v <= rnum, '>=': v >= rnum }[op];
    }
    const sv = str(v).toLowerCase(), r = rhs.toLowerCase();
    if (op === '=') return re ? re.test(str(v)) : sv === r;
    if (op === '<>') return re ? !re.test(str(v)) : sv !== r;
    if (rnum != null) return false;
    return { '<': sv < r, '>': sv > r, '<=': sv <= r, '>=': sv >= r }[op];
  };
}

const round = (n, d) => { const f = Math.pow(10, d); return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f; };

const FN = {
  SUM: (a, c) => { const n = numbers(a, c); return isErr(n) ? n : n.reduce((x, y) => x + y, 0); },
  AVERAGE: (a, c) => { const n = numbers(a, c); return isErr(n) ? n : n.length ? n.reduce((x, y) => x + y, 0) / n.length : ERR('#DIV/0!'); },
  MIN: (a, c) => { const n = numbers(a, c); return isErr(n) ? n : n.length ? Math.min(...n) : 0; },
  MAX: (a, c) => { const n = numbers(a, c); return isErr(n) ? n : n.length ? Math.max(...n) : 0; },
  COUNT: (a, c) => flat(a, c).filter(x => typeof x.v === 'number').length,
  COUNTA: (a, c) => flat(a, c).filter(x => x.v != null && x.v !== '').length,
  COUNTBLANK: (a, c) => flat(a, c).filter(x => x.v == null || x.v === '').length,
  PRODUCT: (a, c) => { const n = numbers(a, c); return isErr(n) ? n : n.reduce((x, y) => x * y, 1); },
  MEDIAN: (a, c) => { const n = numbers(a, c); if (isErr(n)) return n; if (!n.length) return ERR('#NUM!'); n.sort((x, y) => x - y); const m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
  STDEV: (a, c) => { const n = numbers(a, c); if (isErr(n)) return n; if (n.length < 2) return ERR('#DIV/0!'); const mean = n.reduce((x, y) => x + y, 0) / n.length; return Math.sqrt(n.reduce((s, x) => s + (x - mean) ** 2, 0) / (n.length - 1)); },
  LARGE: (a, c) => { const n = numbers([a[0]], c); const k = num(ev(a[1], c)); if (isErr(n)) return n; n.sort((x, y) => y - x); return n[k - 1] ?? ERR('#NUM!'); },
  SMALL: (a, c) => { const n = numbers([a[0]], c); const k = num(ev(a[1], c)); if (isErr(n)) return n; n.sort((x, y) => x - y); return n[k - 1] ?? ERR('#NUM!'); },
  ROUND: (a, c) => { const n = num(ev(a[0], c)), d = a[1] ? num(ev(a[1], c)) : 0; return isErr(n) ? n : isErr(d) ? d : round(n, d); },
  ROUNDUP: (a, c) => { const n = num(ev(a[0], c)), d = a[1] ? num(ev(a[1], c)) : 0; if (isErr(n)) return n; const f = 10 ** d; return Math.sign(n) * Math.ceil(Math.abs(n) * f - 1e-9) / f; },
  ROUNDDOWN: (a, c) => { const n = num(ev(a[0], c)), d = a[1] ? num(ev(a[1], c)) : 0; if (isErr(n)) return n; const f = 10 ** d; return Math.sign(n) * Math.floor(Math.abs(n) * f + 1e-9) / f; },
  INT: (a, c) => { const n = num(ev(a[0], c)); return isErr(n) ? n : Math.floor(n); },
  ABS: (a, c) => { const n = num(ev(a[0], c)); return isErr(n) ? n : Math.abs(n); },
  SQRT: (a, c) => { const n = num(ev(a[0], c)); return isErr(n) ? n : n < 0 ? ERR('#NUM!') : Math.sqrt(n); },
  POWER: (a, c) => { const x = num(ev(a[0], c)), y = num(ev(a[1], c)); return isErr(x) ? x : isErr(y) ? y : x ** y; },
  MOD: (a, c) => { const x = num(ev(a[0], c)), y = num(ev(a[1], c)); if (isErr(x)) return x; if (isErr(y)) return y; return y === 0 ? ERR('#DIV/0!') : x - y * Math.floor(x / y); },
  PI: () => Math.PI,
  RAND: () => Math.random(),
  RANDBETWEEN: (a, c) => { const lo = num(ev(a[0], c)), hi = num(ev(a[1], c)); return Math.floor(Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1)) + Math.ceil(lo); },
  IF: (a, c) => { const t = bool(plain(ev(a[0], c))); if (isErr(t)) return t; return t ? (a[1] ? ev(a[1], c) : true) : (a[2] ? ev(a[2], c) : false); },
  IFERROR: (a, c) => { const v = ev(a[0], c); return isErr(v) ? ev(a[1], c) : v; },
  AND: (a, c) => { for (const { v } of flat(a, c)) { if (v == null) continue; const b = bool(v); if (isErr(b)) return b; if (!b) return false; } return true; },
  OR: (a, c) => { for (const { v } of flat(a, c)) { if (v == null) continue; const b = bool(v); if (isErr(b)) return b; if (b) return true; } return false; },
  NOT: (a, c) => { const b = bool(plain(ev(a[0], c))); return isErr(b) ? b : !b; },
  CONCAT: (a, c) => { let s = ''; for (const { v } of flat(a, c)) { if (isErr(v)) return v; s += str(v); } return s; },
  LEN: (a, c) => str(plain(ev(a[0], c))).length,
  UPPER: (a, c) => str(plain(ev(a[0], c))).toUpperCase(),
  LOWER: (a, c) => str(plain(ev(a[0], c))).toLowerCase(),
  PROPER: (a, c) => str(plain(ev(a[0], c))).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (m, p, ch) => p + ch.toUpperCase()),
  TRIM: (a, c) => str(plain(ev(a[0], c))).trim().replace(/\s+/g, ' '),
  LEFT: (a, c) => str(plain(ev(a[0], c))).slice(0, a[1] ? num(ev(a[1], c)) : 1),
  RIGHT: (a, c) => { const s = str(plain(ev(a[0], c))); const n = a[1] ? num(ev(a[1], c)) : 1; return n ? s.slice(-n) : ''; },
  MID: (a, c) => { const s = str(plain(ev(a[0], c))); const st = num(ev(a[1], c)), n = num(ev(a[2], c)); return s.substr(st - 1, n); },
  SUBSTITUTE: (a, c) => str(plain(ev(a[0], c))).split(str(plain(ev(a[1], c)))).join(str(plain(ev(a[2], c)))),
  REPT: (a, c) => str(plain(ev(a[0], c))).repeat(Math.max(0, num(ev(a[1], c)))),
  VALUE: (a, c) => num(plain(ev(a[0], c))),
  TEXT: (a, c) => { const v = plain(ev(a[0], c)); const f = str(plain(ev(a[1], c))); return formatValue(typeof v === 'number' ? v : num(v), fmtFromCode(f)); },
  TODAY: () => ({ date: Math.floor(dateToSerial(new Date())) }),
  NOW: () => ({ date: dateToSerial(new Date()), time: true }),
  DATE: (a, c) => ({ date: dateToSerial(new Date(num(ev(a[0], c)), num(ev(a[1], c)) - 1, num(ev(a[2], c)))) }),
  YEAR: (a, c) => serialToDate(num(plain(ev(a[0], c)))).getFullYear(),
  MONTH: (a, c) => serialToDate(num(plain(ev(a[0], c)))).getMonth() + 1,
  DAY: (a, c) => serialToDate(num(plain(ev(a[0], c)))).getDate(),
  WEEKDAY: (a, c) => serialToDate(num(plain(ev(a[0], c)))).getDay() + 1,
  ISBLANK: (a, c) => { const v = ev(a[0], c); return v == null || v === ''; },
  ISNUMBER: (a, c) => typeof plain(ev(a[0], c)) === 'number',
  ISTEXT: (a, c) => typeof ev(a[0], c) === 'string',
  ISERROR: (a, c) => isErr(ev(a[0], c)),
  SUMIF: (a, c) => {
    const range = ev(a[0], c), test = criteria(ev(a[1], c)), sum = a[2] ? ev(a[2], c) : range;
    if (!Array.isArray(range)) return ERR('#VALUE!');
    let s = 0;
    range.forEach((row, i) => row.forEach((v, j) => { if (test(v)) { const x = plain(sum[i] && sum[i][j]); if (typeof x === 'number') s += x; } }));
    return s;
  },
  COUNTIF: (a, c) => {
    const range = ev(a[0], c), test = criteria(ev(a[1], c));
    if (!Array.isArray(range)) return ERR('#VALUE!');
    let n = 0;
    range.forEach(row => row.forEach(v => { if (test(v)) n++; }));
    return n;
  },
  AVERAGEIF: (a, c) => {
    const range = ev(a[0], c), test = criteria(ev(a[1], c)), avg = a[2] ? ev(a[2], c) : range;
    let s = 0, n = 0;
    range.forEach((row, i) => row.forEach((v, j) => { if (test(v)) { const x = plain(avg[i] && avg[i][j]); if (typeof x === 'number') { s += x; n++; } } }));
    return n ? s / n : ERR('#DIV/0!');
  },
  VLOOKUP: (a, c) => {
    const key = plain(ev(a[0], c)), table = ev(a[1], c), col = num(ev(a[2], c));
    const approx = a[3] ? bool(plain(ev(a[3], c))) : true;
    if (!Array.isArray(table)) return ERR('#VALUE!');
    if (col < 1 || col > (table[0] || []).length) return ERR('#REF!');
    let hit = -1;
    for (let i = 0; i < table.length; i++) {
      const v = plain(table[i][0]);
      if (approx === false) { if (str(v).toLowerCase() === str(key).toLowerCase() || v === key) { hit = i; break; } }
      else if (v != null && (typeof key === 'number' ? v <= key : str(v).toLowerCase() <= str(key).toLowerCase())) hit = i;
      else if (v != null) break;
    }
    return hit < 0 ? ERR('#N/A') : table[hit][col - 1];
  },
  HLOOKUP: (a, c) => {
    const table = ev(a[1], c);
    if (!Array.isArray(table)) return ERR('#VALUE!');
    const t = table[0].map((_, j) => table.map(r => r[j]));
    return FN.VLOOKUP([a[0], { t: 'lit', v: t }, a[2], a[3] || { t: 'lit', v: true }], c);
  },
  INDEX: (a, c) => {
    const t = ev(a[0], c), r = num(ev(a[1], c)), col = a[2] ? num(ev(a[2], c)) : 1;
    if (!Array.isArray(t)) return t;
    const row = t[(t.length === 1 ? 1 : r) - 1];
    if (!row) return ERR('#REF!');
    const v = t.length === 1 ? row[r - 1] : row[col - 1];
    return v === undefined ? ERR('#REF!') : v;
  },
  MATCH: (a, c) => {
    const key = plain(ev(a[0], c)), arr = ev(a[1], c), type = a[2] ? num(ev(a[2], c)) : 1;
    if (!Array.isArray(arr)) return ERR('#N/A');
    const list = arr.length === 1 ? arr[0] : arr.map(r => r[0]);
    if (type === 0) { const i = list.findIndex(v => str(plain(v)).toLowerCase() === str(key).toLowerCase()); return i < 0 ? ERR('#N/A') : i + 1; }
    let hit = -1;
    list.forEach((v, i) => { v = plain(v); if (v != null && (type > 0 ? v <= key : v >= key)) hit = i; });
    return hit < 0 ? ERR('#N/A') : hit + 1;
  },
};
FN.CONCATENATE = FN.CONCAT;
FN['STDEV.S'] = FN.STDEV;
export const FUNCTIONS = Object.keys(FN).sort();

function binop(op, x, y) {
  x = plain(x); y = plain(y);
  if (op === '&') { if (isErr(x)) return x; if (isErr(y)) return y; return str(x) + str(y); }
  if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
    if (isErr(x)) return x; if (isErr(y)) return y;
    let a = x == null ? (typeof y === 'string' ? '' : 0) : x, b = y == null ? (typeof x === 'string' ? '' : 0) : y;
    if (typeof a === 'string' && typeof b === 'string') { a = a.toLowerCase(); b = b.toLowerCase(); }
    else if (typeof a !== typeof b) { const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2); a = rank(a); b = rank(b); }
    return { '=': a === b, '<>': a !== b, '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b }[op];
  }
  const a = num(x), b = num(y);
  if (isErr(a)) return a; if (isErr(b)) return b;
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? ERR('#DIV/0!') : a / b;
    case '^': { const r = a ** b; return isFinite(r) ? r : ERR('#NUM!'); }
  }
  return ERR('#VALUE!');
}

/* evaluate AST; ctx = { book, sheet } */
function ev(n, ctx) {
  switch (n.t) {
    case 'lit': return n.v;
    case 'ref': {
      const sh = n.sheet ? ctx.book.sheetByName(n.sheet) : ctx.sheet;
      if (!sh) return ERR('#REF!');
      const v = ctx.book.value(sh, n.c, n.r);
      return v;
    }
    case 'range': {
      const sh = n.sheet ? ctx.book.sheetByName(n.sheet) : ctx.sheet;
      if (!sh) return ERR('#REF!');
      const r2 = Math.min(n.r2, ctx.book.maxRow(sh)), c2 = Math.min(n.c2, ctx.book.maxCol(sh));
      const out = [];
      for (let r = n.r1; r <= Math.max(n.r1, r2); r++) {
        const row = [];
        for (let c = n.c1; c <= Math.max(n.c1, c2); c++) row.push(ctx.book.value(sh, c, r));
        out.push(row);
      }
      return out;
    }
    case 'neg': { const v = num(plain(single(ev(n.a, ctx)))); return isErr(v) ? v : -v; }
    case 'pct': { const v = num(plain(single(ev(n.a, ctx)))); return isErr(v) ? v : v / 100; }
    case 'bin': return binop(n.op, single(ev(n.a, ctx)), single(ev(n.b, ctx)));
    case 'fn': {
      const f = FN[n.name];
      if (!f) return ERR('#NAME?');
      try { const v = f(n.args, ctx); return v === undefined ? ERR('#VALUE!') : v; } catch { return ERR('#VALUE!'); }
    }
    case 'name': return ERR('#NAME?');
  }
  return ERR('#VALUE!');
}
/* a range used where a single value is expected → top-left value */
const single = (v) => (Array.isArray(v) ? (v[0] ? v[0][0] : null) : v);

/* ---------- workbook ---------- */
export class Book {
  constructor(sheets = null) {
    this.sheets = sheets || [newSheet('Sheet1')];
    this.cache = new Map();
    this.computing = new Set();
    this.astCache = new Map();
  }
  sheetByName(name) { return this.sheets.find(s => s.name.toLowerCase() === name.toLowerCase()) || null; }
  invalidate() { this.cache.clear(); }
  maxRow(sh) { return sh.maxR ?? 0; }
  maxCol(sh) { return sh.maxC ?? 0; }
  updateBounds(sh) {
    let mr = 0, mc = 0;
    for (const k of Object.keys(sh.cells)) { const a = parseAddr(k); if (a.r > mr) mr = a.r; if (a.c > mc) mc = a.c; }
    sh.maxR = mr; sh.maxC = mc;
  }
  raw(sh, c, r) { const cell = sh.cells[addr(c, r)]; return cell ? cell.v : ''; }
  ast(src) {
    if (!this.astCache.has(src)) {
      let a;
      try { a = parse(src); } catch { a = { t: 'lit', v: ERR('#NAME?') }; }
      this.astCache.set(src, a);
    }
    return this.astCache.get(src);
  }
  value(sh, c, r) {
    const raw = this.raw(sh, c, r);
    if (!raw || raw[0] !== '=' || raw.length === 1) return literal(raw);
    const key = sh.name + '!' + c + ',' + r;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.computing.has(key)) return ERR('#CIRC!');
    this.computing.add(key);
    let v = ev(this.ast(raw.slice(1)), { book: this, sheet: sh });
    if (Array.isArray(v)) v = single(v);
    this.computing.delete(key);
    this.cache.set(key, v);
    return v;
  }
}
export function newSheet(name) { return { name, cells: {}, colW: {}, charts: [], maxR: 0, maxC: 0 }; }

/* ---------- reference rewriting (fill, copy/paste, insert/delete) ---------- */
/* fn({ sheet, c, r, absC, absR }) → { c, r } | null (null = #REF!) */
export function mapRefs(formula, fn) {
  let out = '';
  let i = 0;
  const re = /("(?:[^"]|"")*")|((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/gy;
  const src = formula;
  while (i < src.length) {
    re.lastIndex = i;
    const prev = src[i - 1];
    const m = /[\w.$]/.test(prev || '') ? null : re.exec(src);
    if (!m) { out += src[i]; i++; continue; }
    if (m[1]) { out += m[1]; i = re.lastIndex; continue; }
    const sheet = m[2] ? m[2].slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") : null;
    const res = fn({ sheet, c: colIndex(m[4]), r: +m[6] - 1, absC: !!m[3], absR: !!m[5] });
    if (!res || res.c < 0 || res.r < 0) out += (m[2] || '') + '#REF!';
    else out += (m[2] || '') + m[3] + colName(res.c) + m[5] + (res.r + 1);
    i = re.lastIndex;
  }
  return out;
}
export function shiftFormula(raw, dc, dr) {
  if (!raw || raw[0] !== '=') return raw;
  return '=' + mapRefs(raw.slice(1), (x) => ({ c: x.absC ? x.c : x.c + dc, r: x.absR ? x.r : x.r + dr }));
}

/* ---------- number formats ---------- */
/* style.fmt: 'general' | 'number' | 'currency' | 'percent' | 'date' | 'time' | 'text', style.dec: decimals */
export function fmtFromCode(code) {
  if (!code || /general/i.test(code)) return { fmt: 'general' };
  if (code === '@') return { fmt: 'text' };
  const dec = ((code.split(';')[0].match(/\.(0+)/) || [])[1] || '').length;
  if (/[yd]|mmm|m\/|\/m|h:mm/i.test(code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, ''))) return { fmt: /h/i.test(code) && !/[yd]/i.test(code) ? 'time' : 'date' };
  if (code.includes('%')) return { fmt: 'percent', dec };
  if (/[$€£¥]|"\$"|\[\$/.test(code)) return { fmt: 'currency', dec, sym: (code.match(/[$€£¥]/) || ['$'])[0] };
  if (/0|#/.test(code)) return { fmt: 'number', dec, grouping: code.includes(',') };
  return { fmt: 'general' };
}

export function formatValue(v, st = {}) {
  if (isErr(v)) return v.error;
  if (v && v.date != null) {
    const d = serialToDate(v.date);
    if (!st.fmt || st.fmt === 'general' || st.fmt === 'date') return v.time ? d.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('en-US');
    v = v.date;
  }
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v;
  const dec = st.dec ?? 2;
  switch (st.fmt) {
    case 'number': return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: st.grouping !== false });
    case 'currency': return (v < 0 ? '-' : '') + (st.sym || '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    case 'percent': return (v * 100).toLocaleString('en-US', { minimumFractionDigits: st.dec ?? 0, maximumFractionDigits: st.dec ?? 0 }) + '%';
    case 'date': return serialToDate(v).toLocaleDateString('en-US');
    case 'time': return serialToDate(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    case 'text': return fmtGeneral(v);
    default: {
      if (st.dec != null) return v.toFixed(st.dec);
      return fmtGeneral(v);
    }
  }
}

/* ---------- CSV ---------- */
export function parseCSV(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : text.includes('\t') && !text.includes(',') ? '\t' : ',';
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
export function toCSV(book, sh) {
  book.updateBounds(sh);
  const lines = [];
  for (let r = 0; r <= sh.maxR; r++) {
    const cells = [];
    for (let c = 0; c <= sh.maxC; c++) {
      const v = book.value(sh, c, r);
      const s = v == null ? '' : formatValue(v, { fmt: 'general' });
      cells.push(/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    }
    lines.push(cells.join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
