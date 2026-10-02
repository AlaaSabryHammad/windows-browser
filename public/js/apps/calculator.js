/* Calculator — Windows 10 standard mode */
import { createWindow } from '../wm.js';
import { I } from '../icons.js';

export function open() {
  const win = createWindow({ title: 'Calculator', icon: I.calc, appId: 'calculator', w: 320, h: 500, minW: 280, minH: 420 });
  win.body.innerHTML = `
    <div class="calc">
      <div class="calc-mode">Standard</div>
      <div class="calc-history"></div>
      <div class="calc-display">0</div>
      <div class="calc-keys">
        <button data-k="pct">%</button><button data-k="ce">CE</button><button data-k="c">C</button><button data-k="back">⌫</button>
        <button data-k="inv">1/x</button><button data-k="sqr">x²</button><button data-k="sqrt">²√x</button><button data-k="/" op>÷</button>
        <button class="num" data-k="7">7</button><button class="num" data-k="8">8</button><button class="num" data-k="9">9</button><button data-k="*" op>×</button>
        <button class="num" data-k="4">4</button><button class="num" data-k="5">5</button><button class="num" data-k="6">6</button><button data-k="-" op>−</button>
        <button class="num" data-k="1">1</button><button class="num" data-k="2">2</button><button class="num" data-k="3">3</button><button data-k="+" op>+</button>
        <button class="num" data-k="neg">±</button><button class="num" data-k="0">0</button><button class="num" data-k=".">.</button><button class="eq" data-k="=">=</button>
      </div>
    </div>`;

  const disp = win.body.querySelector('.calc-display');
  const hist = win.body.querySelector('.calc-history');

  const st = { disp: '0', acc: null, op: null, fresh: true, lastOp: null, lastOperand: null };

  const fmt = (n) => {
    if (!isFinite(n)) return 'Cannot divide by zero';
    const r = Math.round(n * 1e10) / 1e10;
    let s = String(r);
    if (s.includes('e')) return s;
    const [i, d] = s.split('.');
    return Number(i).toLocaleString('en-US') + (d !== undefined ? '.' + d : '');
  };
  const unfmt = (s) => parseFloat(s.replace(/,/g, ''));

  function apply(a, b, op) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? Infinity : a / b;
    }
    return b;
  }

  function press(k) {
    const isDigit = /^[0-9]$/.test(k);
    if (isDigit) {
      if (st.fresh) { st.disp = k; st.fresh = false; }
      else if (st.disp.replace(/[-.,]/g, '').length < 15) {
        st.disp = st.disp === '0' ? k : st.disp + k;
      }
    } else if (k === '.') {
      if (st.fresh) { st.disp = '0.'; st.fresh = false; }
      else if (!st.disp.includes('.')) st.disp += '.';
    } else if (k === 'c') {
      st.disp = '0'; st.acc = null; st.op = null; st.fresh = true; hist.textContent = '';
    } else if (k === 'ce') {
      st.disp = '0'; st.fresh = true;
    } else if (k === 'back') {
      if (!st.fresh) {
        st.disp = st.disp.length > 1 ? st.disp.slice(0, -1) : '0';
        if (st.disp === '-' || st.disp === '') st.disp = '0';
      }
    } else if (k === 'neg') {
      st.disp = st.disp.startsWith('-') ? st.disp.slice(1) : (st.disp === '0' ? '0' : '-' + st.disp);
    } else if (k === 'sqr') {
      const v = unfmt(st.disp); st.disp = fmt(v * v); st.fresh = true;
      hist.textContent = `sqr(${fmt(v)})`;
    } else if (k === 'sqrt') {
      const v = unfmt(st.disp); st.disp = v < 0 ? 'Invalid input' : fmt(Math.sqrt(v)); st.fresh = true;
      hist.textContent = `√(${fmt(v)})`;
    } else if (k === 'inv') {
      const v = unfmt(st.disp); st.disp = v === 0 ? 'Cannot divide by zero' : fmt(1 / v); st.fresh = true;
      hist.textContent = `1/(${fmt(v)})`;
    } else if (k === 'pct') {
      const v = unfmt(st.disp);
      const base = st.acc !== null ? st.acc : 0;
      st.disp = fmt(base * v / 100); st.fresh = true;
    } else if (['+', '-', '*', '/'].includes(k)) {
      const v = unfmt(st.disp);
      if (st.op !== null && !st.fresh) {
        const r = apply(st.acc, v, st.op);
        st.acc = r; st.disp = fmt(r);
      } else {
        st.acc = st.fresh && st.acc !== null ? st.acc : v;
      }
      st.op = k; st.fresh = true;
      const sym = { '+': '+', '-': '−', '*': '×', '/': '÷' }[k];
      hist.textContent = `${fmt(st.acc)} ${sym}`;
    } else if (k === '=') {
      if (st.op !== null) {
        const v = st.fresh && st.lastOp === st.op ? st.lastOperand : unfmt(st.disp);
        const r = apply(st.acc, v, st.op);
        hist.textContent = `${fmt(st.acc)} ${({ '+': '+', '-': '−', '*': '×', '/': '÷' })[st.op]} ${fmt(v)} =`;
        st.disp = fmt(r);
        st.acc = r; st.lastOp = st.op; st.lastOperand = v;
        st.op = null; st.fresh = true;
      }
    }
    render();
  }

  function fmtNum(s) {
    if (typeof s === 'string' && /[a-z]/i.test(s)) return s; /* messages like "Cannot divide by zero" */
    const v = unfmt(String(s));
    return isNaN(v) ? s : fmt(v);
  }
  function render() {
    const text = fmtNum(st.disp);
    disp.style.fontSize = String(text).length > 13 ? '26px' : '';
    disp.textContent = text;
  }

  win.body.querySelectorAll('button').forEach(b => b.addEventListener('click', () => press(b.dataset.k)));

  const keymap = { 'Enter': '=', 'Escape': 'c', 'Backspace': 'back', '+': '+', '-': '-', '*': '*', '/': '/', '.': '.', ',': '.', '%': 'pct', 'r': 'inv', 'q': 'sqr' };
  const onKey = async (e) => {
    if (!getFocusedIsThis() || e.altKey || e.metaKey) return;
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      try { await navigator.clipboard.writeText(String(unfmt(st.disp))); } catch { /* ignore */ }
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      try {
        const t = (await navigator.clipboard.readText()).replace(/,/g, '').trim();
        if (/^-?\d+(\.\d+)?$/.test(t)) { st.disp = t; st.fresh = false; render(); }
      } catch { /* ignore */ }
      return;
    }
    if (e.ctrlKey) return;
    const k = /^[0-9]$/.test(e.key) ? e.key : keymap[e.key];
    if (k) { e.preventDefault(); press(k); }
  };
  function getFocusedIsThis() {
    return document.querySelector('.window.active') === win.el;
  }
  document.addEventListener('keydown', onKey);
  win.onclose(() => document.removeEventListener('keydown', onKey));

  return win;
}
