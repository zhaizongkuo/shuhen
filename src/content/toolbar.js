// 划词工具条。主交互靠它 —— 大部分人不用快捷键。
//
// 三条硬约束：
// 1. 必须挂 Shadow DOM。宿主站点的 CSS 会顺着标签选择器渗进来（button{}、
//    div{box-sizing}、*{font-family} 都很常见），不隔离就会在某些站点上错位、变形。
// 2. 根节点必须带 UI_ATTR。否则被文本索引收进去，或者触发 MutationObserver 自激。
// 3. 文案由外部传进来。这里是 MAIN world，拿不到 chrome.i18n。

import { COLORS } from '../core/schema.js';
import { UI_ATTR } from '../core/textindex.js';

const SWATCH = {
  yellow: '#ffd600',
  green:  '#4ade80',
  blue:   '#60a5fa',
  pink:   '#f472b6',
};

const CSS_TEXT = `
:host { all: initial; }
.bar {
  position: fixed;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 10px;
  background: #1f2023;
  box-shadow: 0 6px 24px rgba(0,0,0,.28), 0 0 0 1px rgba(255,255,255,.06);
  font: 13px/1.4 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #e8e8ea;
  user-select: none;
}
.dot {
  width: 20px; height: 20px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}
.dot:hover { transform: scale(1.12); }
.dot[aria-pressed="true"] { border-color: #fff; }
.sep { width: 1px; height: 18px; background: rgba(255,255,255,.16); }
.btn {
  border: 0; background: transparent; color: #cfcfd4;
  cursor: pointer; padding: 3px 7px; border-radius: 6px;
  font: inherit; white-space: nowrap;
}
.btn:hover { background: rgba(255,255,255,.10); color: #fff; }
.btn.danger:hover { background: rgba(255,80,80,.22); color: #ff9a9a; }
.note {
  display: none; width: 100%; margin-top: 6px;
  background: #2a2b2f; color: #e8e8ea;
  border: 1px solid rgba(255,255,255,.12); border-radius: 6px;
  padding: 6px 8px; font: inherit; resize: vertical; min-height: 52px;
  box-sizing: border-box;
}
.wrap { display: flex; flex-direction: column; }
.open .note { display: block; }
`;

export function createToolbar(opts) {
  const strings = opts.strings || {};
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  // 宿主自身不占位、不拦事件；真正的交互面在内部的 .bar 上
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = CSS_TEXT;

  const bar = document.createElement('div');
  bar.className = 'bar wrap';
  bar.style.display = 'none';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:6px';

  const dots = COLORS.map((c) => {
    const b = document.createElement('button');
    b.className = 'dot';
    b.style.background = SWATCH[c] || SWATCH.yellow;
    b.title = c;
    b.dataset.color = c;
    return b;
  });
  dots.forEach((d) => row.appendChild(d));

  const sep = document.createElement('div');
  sep.className = 'sep';

  const noteBtn = document.createElement('button');
  noteBtn.className = 'btn';
  noteBtn.textContent = strings.note || 'Note';

  const delBtn = document.createElement('button');
  delBtn.className = 'btn danger';
  delBtn.textContent = strings.del || 'Delete';

  const note = document.createElement('textarea');
  note.className = 'note';
  note.placeholder = strings.notePlaceholder || 'Write something… (saved on blur)';

  row.appendChild(sep);
  row.appendChild(noteBtn);
  row.appendChild(delBtn);
  bar.appendChild(row);
  bar.appendChild(note);
  root.appendChild(style);
  root.appendChild(bar);

  let mode = 'idle';        // 'select' 划词中 | 'item' 点在已有高亮上
  let current = null;       // mode==='item' 时的条目

  function setVisible(on) {
    bar.style.display = on ? '' : 'none';
    if (!on) { bar.classList.remove('open'); mode = 'idle'; current = null; }
  }

  // 定位：优先放在选区上方；顶部放不下就翻到下方。左右夹在视口内，
  // 不然在页面边缘划词时工具条会跑到屏幕外面去。
  function place(rect) {
    bar.style.visibility = 'hidden';
    bar.style.display = '';
    const w = bar.offsetWidth || 220;
    const h = bar.offsetHeight || 34;
    const gap = 8;
    let top = rect.top - h - gap;
    if (top < gap) top = rect.bottom + gap;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(gap, Math.min(left, window.innerWidth - w - gap));
    bar.style.top = Math.round(top) + 'px';
    bar.style.left = Math.round(left) + 'px';
    bar.style.visibility = '';
  }

  function markActive(color) {
    dots.forEach((d) => d.setAttribute('aria-pressed', String(d.dataset.color === color)));
  }

  dots.forEach((d) => {
    d.addEventListener('mousedown', (e) => e.preventDefault());  // 别让按钮抢走选区
    d.addEventListener('click', () => {
      const color = d.dataset.color;
      if (mode === 'item' && current) opts.onColor(current.id, color);
      else opts.onColor(null, color);
      markActive(color);
      if (mode !== 'item') setVisible(false);
    });
  });

  noteBtn.addEventListener('mousedown', (e) => e.preventDefault());
  noteBtn.addEventListener('click', () => {
    // 划词状态下点笔记：先按默认色建出来，再展开输入框 ——
    // 否则没有 id 可挂笔记
    if (mode !== 'item') {
      const id = opts.onColor(null, COLORS[0]);
      if (id && id.then) { id.then(finishNote); return; }
      finishNote(id);
      return;
    }
    toggleNote();
  });

  function finishNote(id) {
    if (!id) { setVisible(false); return; }
    mode = 'item';
    current = { id, note: '' };
    toggleNote();
  }

  function toggleNote() {
    bar.classList.toggle('open');
    if (bar.classList.contains('open')) {
      note.value = (current && current.note) || '';
      note.focus();
    }
  }

  note.addEventListener('blur', () => {
    if (current) opts.onNote(current.id, note.value);
  });
  note.addEventListener('keydown', (e) => {
    e.stopPropagation();                       // 别让站点的快捷键吃掉输入
    if (e.key === 'Escape') { setVisible(false); }
  });

  delBtn.addEventListener('mousedown', (e) => e.preventDefault());
  delBtn.addEventListener('click', () => {
    if (mode === 'item' && current) opts.onDelete(current.id);
    setVisible(false);
  });

  return {
    mount() {
      (document.body || document.documentElement).appendChild(host);
    },
    /** 划词后弹出：只有颜色和「笔记」有意义 */
    showForSelection(rect) {
      mode = 'select';
      current = null;
      delBtn.style.display = 'none';
      markActive(null);
      bar.classList.remove('open');
      place(rect);
    },
    /** 点在已有高亮上：可改色、写笔记、删除 */
    showForItem(item, rect) {
      mode = 'item';
      current = item;
      delBtn.style.display = '';
      markActive(item.color);
      bar.classList.remove('open');
      place(rect);
    },
    isOpen() { return bar.style.display !== 'none'; },
    /** 笔记展开时不要因为一次点击就关掉，否则刚打的字就没了 */
    isEditing() { return bar.classList.contains('open'); },
    contains(node) { return host.contains(node); },
    hide() { setVisible(false); },
    destroy() { host.remove(); },
  };
}
