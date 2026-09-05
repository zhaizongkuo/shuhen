// 高亮列表面板。导出的入口在这里。
//
// 为什么做成页内面板而不是扩展 popup：popup 要占用 action 点击，
// 而 action 点击已经被「按站授权」占了（setPopup 得按 tab 动态切，
// 还要监听 tabs.onUpdated 对齐）。页内面板零新增机制，且和工具条共用一套
// Shadow DOM 隔离方案。代价是看不了别的页面的高亮 —— v1 的导出本来就是「导这一篇」。

import { UI_ATTR } from '../core/textindex.js';
import { toMarkdown, toPlainText, safeFilename } from '../core/export.js';

const SWATCH = { yellow: '#ffd600', green: '#4ade80', blue: '#60a5fa', pink: '#f472b6' };

const CSS_TEXT = `
:host { all: initial; }
.panel {
  position: fixed; top: 0; right: 0; bottom: 0; width: 340px; max-width: 92vw;
  z-index: 2147483646;
  display: flex; flex-direction: column;
  background: #1f2023; color: #e8e8ea;
  font: 13px/1.55 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  box-shadow: -8px 0 32px rgba(0,0,0,.34);
  transform: translateX(100%); transition: transform .18s ease;
  /* 关闭时必须彻底退出渲染：只靠 transform 移出视口，
     某些站点会因此撑出一条横向滚动条，用户会以为是我们把页面弄坏了 */
  visibility: hidden; pointer-events: none;
}
.panel.open { transform: none; visibility: visible; pointer-events: auto; }
.hd {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,.08);
}
.hd h2 { margin: 0; font-size: 14px; font-weight: 600; }
/* 计数紧跟标题，不要被推到最右边 —— 它是标题的一部分，不是独立信息 */
.count { color: #9a9aa2; font-size: 12px; }
.grow { flex: 1; }
.ghost {
  border: 1px solid rgba(255,255,255,.14); background: transparent;
  color: #cfcfd4; border-radius: 6px; padding: 3px 9px;
  font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.ghost:hover { background: rgba(255,255,255,.10); color: #fff; }
.x { border: 0; background: transparent; color: #9a9aa2; cursor: pointer;
     font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.x:hover { background: rgba(255,255,255,.1); color: #fff; }
.list { flex: 1; overflow: auto; padding: 6px 0; }
.empty { padding: 28px 16px; color: #8b8b93; text-align: center; }
.row {
  display: flex; gap: 9px; padding: 9px 14px; cursor: pointer;
  border-left: 3px solid transparent;
}
.row:hover { background: rgba(255,255,255,.05); }
.row.orphan { opacity: .55; }
.bar { width: 3px; border-radius: 2px; flex: none; align-self: stretch; }
.body { flex: 1; min-width: 0; }
.txt {
  margin: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-word;
}
.note { margin: 4px 0 0; color: #a8c7ff; font-size: 12px; word-break: break-word; }
.tag { margin: 4px 0 0; color: #d99; font-size: 11px; }
.del { border: 0; background: transparent; color: #7a7a82; cursor: pointer;
       padding: 0 4px; border-radius: 5px; flex: none; align-self: flex-start; }
.row:hover .del { color: #d88; }
.del:hover { background: rgba(255,80,80,.18); }
.ft { padding: 10px 14px; border-top: 1px solid rgba(255,255,255,.08); }
.keys { color: #8b8b93; font-size: 11px; margin-bottom: 8px; line-height: 1.7; }
.keys kbd {
  background: rgba(255,255,255,.10); border-radius: 4px; padding: 1px 5px;
  font: inherit; font-family: ui-monospace, Consolas, monospace; color: #cfcfd4;
}
.keys .unset { color: #d9a05b; }
.btns { display: flex; flex-wrap: wrap; gap: 8px; }
.btn { border: 0; border-radius: 7px; cursor: pointer; font: inherit;
       padding: 7px 11px; background: rgba(255,255,255,.09); color: #e8e8ea; }
.btn:hover { background: rgba(255,255,255,.16); }
.btn.primary { background: #3b7dd8; color: #fff; }
.btn.primary:hover { background: #4a8ceb; }
.toast { position: absolute; left: 50%; bottom: 62px; transform: translateX(-50%);
         background: #0d0d0f; color: #fff; padding: 7px 13px; border-radius: 8px;
         font-size: 12px; opacity: 0; transition: opacity .16s; pointer-events: none; }
.toast.show { opacity: 1; }
`;

export function createPanel(opts) {
  const s = opts.strings || {};
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  host.style.cssText = 'all:initial';
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = CSS_TEXT;

  // 按「动作作用在什么范围上」分区，而不是把按钮平铺：
  //   头部 = 跨页面的导航（去总览、关闭）
  //   底部 = 只作用于当前这一页的导出
  // 混在一起等于告诉用户这几件事一样重，而它们的作用域根本不同。
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<div class="hd"><h2></h2><span class="count"></span><span class="grow"></span>' +
    '<button class="ghost all"></button>' +
    '<button class="x" title="close">&times;</button></div>' +
    '<div class="list"></div>' +
    '<div class="ft"><div class="keys"></div><div class="btns"></div></div>' +
    '<div class="toast"></div>';

  const h2 = panel.querySelector('h2');
  const countEl = panel.querySelector('.count');
  const listEl = panel.querySelector('.list');
  const ftEl = panel.querySelector('.btns');
  const keysEl = panel.querySelector('.keys');
  const toastEl = panel.querySelector('.toast');
  h2.textContent = s.panelTitle || '本页高亮';

  const allBtn = panel.querySelector('.all');
  allBtn.textContent = (s.allShort || '全部') + ' ↗';
  allBtn.title = s.library || '全部高亮';
  allBtn.addEventListener('click', () => opts.onOpenLibrary());

  panel.querySelector('.x').addEventListener('click', () => setOpen(false));

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  // 剪贴板在页面上下文里要靠用户手势，而且 http 明文站没有
  // navigator.clipboard（非安全上下文）。所以必须有 execCommand 兜底，
  // 否则在一堆国内 http 站点上「复制」按钮就是个死键。
  async function copy(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* 落到兜底 */ }
    try {
      const ta = document.createElement('textarea');
      ta.setAttribute(UI_ATTR, '');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) { return false; }
  }

  function download(text, filename) {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute(UI_ATTR, '');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // 底部只放「本页导出」，三个同层级；主次靠 primary 区分，不靠排列顺序。
  // 跨页面的入口在头部，不混进来。
  const buttons = [
    ['primary', s.copyMd || '复制 Markdown', (doc) => copy(toMarkdown(doc))
      .then((ok) => toast(ok ? (s.copied || '已复制') : (s.copyFailed || '复制失败')))],
    ['', s.download || '下载 .md', (doc) => {
      download(toMarkdown(doc), safeFilename(doc.title));
      toast(s.downloaded || '已下载');
    }],
    ['', s.copyText || '纯文本', (doc) => copy(toPlainText(doc))
      .then((ok) => toast(ok ? (s.copied || '已复制') : (s.copyFailed || '复制失败')))],
  ];
  for (const [cls, label, fn] of buttons) {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', () => {
      const doc = opts.getDoc();
      if (!doc || !doc.items.length) { toast(s.nothing || '本页还没有高亮'); return; }
      fn(doc);
    });
    ftEl.appendChild(b);
  }

  // 显示真实绑定的快捷键。写死「Alt+H」是错的：用户能改，而且键位被别的扩展
  // 占用时 Chrome 会静默不绑定 —— 那种情况下用户按了没反应，只会以为插件坏了。
  // 把「未绑定」显示出来，并给出去哪儿设。
  function renderKeys(map) {
    keysEl.textContent = '';
    const rows = [
      [s.keyHighlight || '高亮', (map && map.highlight) || ''],
      [s.keyPanel || '本面板', (map && map['toggle-panel']) || ''],
    ];
    rows.forEach(([label, key], i) => {
      if (i) keysEl.appendChild(document.createTextNode('　·　'));
      keysEl.appendChild(document.createTextNode(label + ' '));
      if (key) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        keysEl.appendChild(kbd);
      } else {
        const em = document.createElement('span');
        em.className = 'unset';
        em.textContent = s.keyUnset || '未绑定';
        em.title = 'chrome://extensions/shortcuts';
        keysEl.appendChild(em);
      }
    });
  }
  renderKeys(null);
  if (opts.getShortcuts) {
    Promise.resolve(opts.getShortcuts()).then((m) => { if (m && !m.error) renderKeys(m); });
  }

  function render() {
    const doc = opts.getDoc();
    const items = doc ? doc.items.slice() : [];
    // 和导出保持同一个顺序：按在页面里出现的先后，不按创建时间
    items.sort((a, b) => (a.start || 0) - (b.start || 0));

    const orphan = items.filter((it) => it.orphaned).length;
    countEl.textContent = items.length
      ? items.length + (orphan ? ' · ' + orphan + ' 条失联' : '')
      : '';

    listEl.textContent = '';
    if (!items.length) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = s.emptyHint || '选中文字，或按 Alt+H';
      listEl.appendChild(d);
      return;
    }

    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'row' + (it.orphaned ? ' orphan' : '');

      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.background = SWATCH[it.color] || SWATCH.yellow;

      const body = document.createElement('div');
      body.className = 'body';
      const p = document.createElement('p');
      p.className = 'txt';
      p.textContent = it.display || it.exact;
      body.appendChild(p);
      if (it.note) {
        const n = document.createElement('p');
        n.className = 'note';
        n.textContent = it.note;
        body.appendChild(n);
      }
      if (it.orphaned) {
        const t = document.createElement('p');
        t.className = 'tag';
        t.textContent = s.orphanTag || '原文已找不到（数据仍保留）';
        body.appendChild(t);
      }

      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '×';
      del.title = s.del || '删除';
      del.addEventListener('click', (e) => { e.stopPropagation(); opts.onDelete(it.id); });

      row.addEventListener('click', () => opts.onLocate(it.id));
      row.appendChild(bar);
      row.appendChild(body);
      row.appendChild(del);
      listEl.appendChild(row);
    }
  }

  function setOpen(on) {
    panel.classList.toggle('open', on);
    if (on) render();
  }

  root.appendChild(style);
  root.appendChild(panel);

  return {
    mount() { (document.body || document.documentElement).appendChild(host); },
    toggle() { setOpen(!panel.classList.contains('open')); },
    isOpen() { return panel.classList.contains('open'); },
    refresh() { if (panel.classList.contains('open')) render(); },
    contains(node) { return host.contains(node); },
    destroy() { host.remove(); },
  };
}
