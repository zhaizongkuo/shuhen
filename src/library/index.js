// 跨页面总览。跑在扩展自己的页面里，所以 chrome.* 全都能用，
// 不需要经过 bridge，也不受宿主站点 CSP 影响。
//
// 这个页面决定产品是「顺手划两下」还是「值得留着」：
// 只能看当前页的话，攒了一周想回顾时就没法回顾。

import { migrate } from '../core/schema.js';
import { LOCATE_KEY } from '../core/pagekey.js';
import { toMarkdown, toMarkdownAll, safeFilename, isoDate } from '../core/export.js';

const SWATCH = { yellow: '#ffd600', green: '#4ade80', blue: '#60a5fa', pink: '#f472b6' };
const PREFIX = 'pg:';

const $ = (id) => document.getElementById(id);
let docs = [];        // [{key, doc}]
let currentKey = null;
let query = '';

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 1600);
}

async function loadAll() {
  const all = await chrome.storage.local.get(null);
  docs = Object.keys(all)
    .filter((k) => k.startsWith(PREFIX))
    .map((k) => ({ key: k, doc: migrate(all[k]) }))
    .filter((x) => x.doc && x.doc.items.length)
    .sort((a, b) => (b.doc.updated || 0) - (a.doc.updated || 0));
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

// 搜索命中要能看出命中在哪儿。用 textContent 拼 <mark>，不用 innerHTML ——
// 高亮内容来自任意网页，拼进 HTML 就是把别人的站点内容当代码执行。
function markInto(el, text, q) {
  el.textContent = '';
  if (!q) { el.textContent = text; return; }
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  for (;;) {
    const at = lower.indexOf(needle, i);
    if (at === -1) { el.appendChild(document.createTextNode(text.slice(i))); break; }
    el.appendChild(document.createTextNode(text.slice(i, at)));
    const m = document.createElement('mark');
    m.textContent = text.slice(at, at + needle.length);
    el.appendChild(m);
    i = at + needle.length;
  }
}

function matches(entry, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  if ((entry.doc.title || '').toLowerCase().includes(s)) return true;
  if ((entry.doc.url || '').toLowerCase().includes(s)) return true;
  return entry.doc.items.some((it) =>
    (it.display || it.exact).toLowerCase().includes(s) ||
    (it.note || '').toLowerCase().includes(s));
}

function visible() {
  return docs.filter((e) => matches(e, query));
}

function renderPages() {
  const list = visible();
  const box = $('pages');
  box.textContent = '';

  const total = docs.reduce((n, e) => n + e.doc.items.length, 0);
  $('stat').textContent = query
    ? `${list.length} / ${docs.length} 个页面`
    : `${docs.length} 个页面 · ${total} 条高亮`;

  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = docs.length ? '没有匹配的结果' : '还没有高亮。去任意网页点一下扩展图标试试。';
    box.appendChild(d);
    return;
  }

  for (const e of list) {
    const row = document.createElement('div');
    row.className = 'page' + (e.key === currentKey ? ' on' : '');

    const t = document.createElement('div');
    t.className = 't';
    t.title = e.doc.title || e.doc.url;
    markInto(t, e.doc.title || e.doc.url || '未命名', query);

    const m = document.createElement('div');
    m.className = 'm';
    const host = document.createElement('span');
    host.textContent = hostOf(e.doc.url);
    const cnt = document.createElement('span');
    cnt.textContent = e.doc.items.length + ' 条';
    const dt = document.createElement('span');
    dt.textContent = isoDate(e.doc.updated || e.doc.created);
    m.append(host, cnt, dt);

    row.append(t, m);
    row.addEventListener('click', () => { currentKey = e.key; render(); });
    box.appendChild(row);
  }
}

function renderDetail() {
  const box = $('detail');
  box.textContent = '';
  const entry = docs.find((e) => e.key === currentKey) || visible()[0];
  if (!entry) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = '左侧选一个页面';
    box.appendChild(d);
    return;
  }
  currentKey = entry.key;
  const doc = entry.doc;

  const h = document.createElement('h2');
  h.textContent = doc.title || doc.url || '未命名';
  const src = document.createElement('div');
  src.className = 'src';
  if (doc.url) {
    const a = document.createElement('a');
    a.href = doc.url;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.textContent = doc.url;
    src.appendChild(a);
  }

  const acts = document.createElement('div');
  acts.className = 'acts';
  acts.append(
    button('复制 Markdown', 'primary', async () => {
      await navigator.clipboard.writeText(toMarkdown(doc));
      toast('已复制');
    }),
    button('下载 .md', '', () => {
      download(toMarkdown(doc), safeFilename(doc.title));
      toast('已下载');
    }),
    button('打开原文', '', () => doc.url && chrome.tabs.create({ url: doc.url })),
    button('删除本页高亮', '', async () => {
      // 不做二次确认对话框，但删除是可撤销的：先存一份，顶部给撤销
      const backup = { key: entry.key, value: doc };
      await chrome.storage.local.remove(entry.key);
      await refresh();
      toastUndo('已删除 ' + doc.items.length + ' 条', async () => {
        await chrome.storage.local.set({ [backup.key]: backup.value });
        await refresh();
        toast('已恢复');
      });
    }),
  );

  box.append(h, src, acts);

  const items = doc.items.slice().sort((a, b) => (a.start || 0) - (b.start || 0));
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'hl' + (it.kind === 'code' ? ' code' : '');

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.background = SWATCH[it.color] || SWATCH.yellow;

    const body = document.createElement('div');
    body.className = 'body';
    const p = document.createElement('p');
    markInto(p, it.display || it.exact, query);
    body.appendChild(p);
    if (it.note) {
      const n = document.createElement('p');
      n.className = 'note';
      markInto(n, it.note, query);
      body.appendChild(n);
    }
    if (it.orphaned) {
      const tg = document.createElement('p');
      tg.className = 'tag';
      tg.textContent = '原文已找不到（数据仍保留）';
      body.appendChild(tg);
    }
    row.append(bar, body);

    // 点一条 -> 打开原文并滚到那句话上，闪三下。
    // 没有这个的话，「我记得划过一句话，在哪儿？」搜到了也跳不过去，
    // 总览页只完成了一半。
    row.title = it.orphaned ? '原文已找不到，无法定位' : '点击跳到原文中的位置';
    row.style.cursor = it.orphaned ? 'default' : 'pointer';
    if (!it.orphaned && doc.url) {
      row.addEventListener('click', async () => {
        // 先写请求再开标签页：反过来的话页面可能已经加载完并取过一次了
        await chrome.storage.local.set({
          [LOCATE_KEY]: { key: entry.key, id: it.id, at: Date.now() },
        });
        chrome.tabs.create({ url: doc.url });
      });
    }
    box.appendChild(row);
  }
}

function button(label, cls, fn) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

// 删除必须能撤销。这是一个「不丢东西」的产品，
// 一个误点就永久清掉一整页高亮，跟卖点直接矛盾。
function toastUndo(msg, undo) {
  const el = $('toast');
  el.textContent = msg + '　';
  const b = document.createElement('button');
  b.textContent = '撤销';
  b.style.cssText = 'pointer-events:auto;margin-left:6px;padding:3px 9px;font-size:12px';
  b.addEventListener('click', async () => { el.classList.remove('show'); await undo(); });
  el.appendChild(b);
  el.style.pointerEvents = 'auto';
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => {
    el.classList.remove('show');
    el.style.pointerEvents = 'none';
  }, 8000);
}

function download(text, filename) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function render() {
  renderPages();
  renderDetail();
}

async function refresh() {
  await loadAll();
  if (!docs.some((e) => e.key === currentKey)) currentKey = null;
  render();
}

$('q').addEventListener('input', (e) => {
  query = e.target.value.trim();
  currentKey = null;          // 搜索后跳到第一个命中，别停在看不见的那一项上
  render();
});

$('exportAll').addEventListener('click', () => {
  const list = visible().map((e) => e.doc);
  if (!list.length) { toast('没有可导出的内容'); return; }
  download(toMarkdownAll(list), safeFilename('网页高亮汇总 ' + isoDate(Date.now())));
  toast('已导出 ' + list.length + ' 个页面');
});

// 别的标签页在划高亮时，这个页面要跟着更新
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((k) => k.startsWith(PREFIX))) refresh();
});

refresh();
