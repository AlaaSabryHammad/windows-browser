/* Sticky Notes — each note is its own little window; notes, colors and positions are saved. */
import { createWindow, appWindows } from '../wm.js';
import { I } from '../icons.js';
import { contextMenu, confirmDialog } from '../ui.js';

const KEY = 'webwin-notes-v1';
const COLORS = { yellow: 'Yellow', green: 'Green', pink: 'Pink', purple: 'Purple', blue: 'Blue', gray: 'Gray', charcoal: 'Charcoal' };

function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
function save(notes) { try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch { /* ignore */ } }
function update(id, patch) {
  const notes = load();
  const n = notes.find(x => x.id === id);
  if (n) { Object.assign(n, patch); save(notes); }
}

/* open(): show every saved note (or a new one); open({ new: true }): add a note */
export function open(arg = null) {
  const notes = load();
  if (arg && arg.new) return openNote(createNote());
  const openIds = new Set(appWindows('stickynotes').map(w => w.noteId));
  const toOpen = notes.filter(n => !openIds.has(n.id));
  if (!notes.length) return openNote(createNote());
  if (!toOpen.length) { const w = appWindows('stickynotes')[0]; if (w) w.focus(); return w; }
  let last = null;
  toOpen.forEach(n => { last = openNote(n); });
  return last;
}

function createNote(near = null) {
  const notes = load();
  const n = {
    id: 'note' + Date.now(), text: '', color: 'yellow',
    x: near ? near.x + 30 : Math.max(20, innerWidth - 320 - notes.length * 24), y: near ? near.y + 30 : 40 + notes.length * 24, w: 280, h: 280,
  };
  notes.push(n);
  save(notes);
  return n;
}

function openNote(note) {
  const win = createWindow({
    title: 'Sticky Notes', icon: I.sticky, appId: 'stickynotes', className: `sticky-win sn-${note.color}`, noRemember: true,
    x: note.x, y: note.y, w: note.w, h: note.h, minW: 200, minH: 160,
  });
  win.noteId = note.id;
  win.body.innerHTML = `
    <div class="sn">
      <div class="sn-bar">
        <button class="sn-b sn-new" title="New note (Ctrl+N)">+</button>
        <span class="sn-flex"></span>
        <button class="sn-b sn-menu" title="Menu">${I.more}</button>
      </div>
      <textarea class="sn-text selectable" placeholder="Take a note…" spellcheck="false"></textarea>
      <div class="sn-fmt">
        <button class="sn-b" data-w="**" title="Bold (wraps in **)"><b>B</b></button>
        <button class="sn-b" data-w="_" title="Italic (wraps in _)"><i>I</i></button>
        <button class="sn-b" data-l="• " title="Bullet">•</button>
        <button class="sn-b" data-l="☐ " title="Checkbox">☐</button>
      </div>
    </div>`;
  const ta = win.body.querySelector('.sn-text');
  ta.value = note.text || '';
  let saveT = null;
  ta.addEventListener('input', () => { clearTimeout(saveT); saveT = setTimeout(() => update(note.id, { text: ta.value }), 300); });

  const setColor = (c) => {
    win.el.className = win.el.className.replace(/\bsn-\w+\b/g, '').trim() + ` sn-${c}`;
    update(note.id, { color: c });
    note.color = c;
  };

  win.body.querySelector('.sn-new').addEventListener('click', () => openNote(createNote({ x: win.el.offsetLeft, y: win.el.offsetTop })));
  win.body.querySelector('.sn-menu').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left - 150, r.bottom + 4, [
      ...Object.entries(COLORS).map(([k, l]) => ({ label: l, checked: note.color === k, action: () => setColor(k) })),
      '-',
      { label: 'Notes list', icon: I.sticky, action: () => open() },
      { label: 'Delete note', icon: I.trash, action: async () => {
        if (ta.value.trim() && !(await confirmDialog('Sticky Notes', 'This will delete the note. Continue?', 'Delete', 'Keep', 'question'))) return;
        save(load().filter(x => x.id !== note.id));
        deleted = true;
        win.forceClose();
      } },
    ]);
  });
  win.body.querySelectorAll('.sn-fmt [data-w]').forEach(b => b.addEventListener('click', () => {
    const w = b.dataset.w;
    ta.focus();
    const s = ta.selectionStart, e2 = ta.selectionEnd;
    ta.setRangeText(w + ta.value.slice(s, e2) + w, s, e2, 'end');
    ta.dispatchEvent(new Event('input'));
  }));
  win.body.querySelectorAll('.sn-fmt [data-l]').forEach(b => b.addEventListener('click', () => {
    ta.focus();
    const s = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    ta.setRangeText(b.dataset.l, s, s, 'end');
    ta.dispatchEvent(new Event('input'));
  }));
  /* click a ☐ to tick it */
  ta.addEventListener('click', () => {
    const i = ta.selectionStart;
    const ch = ta.value[i - 1] === '☐' ? i - 1 : ta.value[i] === '☐' ? i : -1;
    const ch2 = ta.value[i - 1] === '☑' ? i - 1 : ta.value[i] === '☑' ? i : -1;
    if (ch >= 0) { ta.setRangeText('☑', ch, ch + 1, 'preserve'); ta.dispatchEvent(new Event('input')); }
    else if (ch2 >= 0) { ta.setRangeText('☐', ch2, ch2 + 1, 'preserve'); ta.dispatchEvent(new Event('input')); }
  });
  ta.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); openNote(createNote({ x: win.el.offsetLeft, y: win.el.offsetTop })); }
    if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); win.body.querySelector('.sn-menu').click(); }
  });

  let deleted = false;
  const savePos = () => { if (!deleted) update(note.id, { x: win.el.offsetLeft, y: win.el.offsetTop, w: win.el.offsetWidth, h: win.el.offsetHeight, text: ta.value }); };
  win.onclose(savePos);
  win.el.addEventListener('pointerup', () => setTimeout(savePos, 50));
  setTimeout(() => ta.focus(), 60);
  return win;
}
