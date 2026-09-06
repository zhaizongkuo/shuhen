// 跨页面总览。跑在扩展自己的页面里，所以 chrome.* 全都能用，
// 不需要经过 bridge，也不受宿主站点 CSP 影响。
//
// 这个页面决定产品是「顺手划两下」还是「值得留着」：
// 只能看当前页的话，攒了一周想回顾时就没法回顾。

import { migrate } from '../core/schema.js';
import { toBackup, parseBackup, mergeBackup } from '../core/backup.js';
import { LOCATE_KEY } from '../core/pagekey.js';
import { toMarkdown, toMarkdownAll, safeFilename, isoDate } from '../core/export.js';

const SWATCH = { yellow: '#ffd600', green: '#4ade80', blue: '#60a5fa', pink: '#f472b6' };
const PREFIX = 'pg:';

const $ = (id) => document.getElementById(id);

// 总览页跑在扩展自己的页面里，chrome.i18n 直接可用 ——
// 不像划词工具条在 MAIN world 里拿不到，得由 bridge 把文案送过去。
// 取不到时回落成 key 本身：界面会难看，但不会变成空白让人以为坏了。
// substitutions 一律转成字符串 —— getMessage 传数字不生效，
// 而它不报错，只是占位符原样留在界面上。
const i18n = (k, subs) =>
  chrome.i18n.getMessage(k, subs == null ? undefined : [].concat(subs).map(String)) || k;

// HTML 里的静态文案用 data-i18n 标记，标签里写英文当兜底 ——
// key 拼错或 messages.json 漏了的时候，英文比空白强。
function applyI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = i18n(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = i18n(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = i18n(el.dataset.i18nPlaceholder);
}
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
    ? i18n('libStatFiltered', [list.length, docs.length])
    : i18n('libStatAll', [docs.length, total]);

  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = docs.length ? i18n('libNoMatch') : i18n('libEmpty');
    box.appendChild(d);
    return;
  }

  for (const e of list) {
    const row = document.createElement('div');
    row.className = 'page' + (e.key === currentKey ? ' on' : '');

    const t = document.createElement('div');
    t.className = 't';
    t.title = e.doc.title || e.doc.url;
    markInto(t, e.doc.title || e.doc.url || i18n('libUntitled'), query);

    const m = document.createElement('div');
    m.className = 'm';
    const host = document.createElement('span');
    host.textContent = hostOf(e.doc.url);
    const cnt = document.createElement('span');
    cnt.textContent = i18n('libNItems', e.doc.items.length);
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
    d.textContent = i18n('libPickPage');
    box.appendChild(d);
    return;
  }
  currentKey = entry.key;
  const doc = entry.doc;

  const h = document.createElement('h2');
  h.textContent = doc.title || doc.url || i18n('libUntitled');
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
    button(i18n('uiCopyMd'), 'primary', async () => {
      await navigator.clipboard.writeText(toMarkdown(doc));
      toast(i18n('uiCopied'));
    }),
    button(i18n('uiDownload'), '', () => {
      download(toMarkdown(doc), safeFilename(doc.title));
      toast(i18n('uiDownloaded'));
    }),
    button(i18n('libOpenSource'), '', () => doc.url && chrome.tabs.create({ url: doc.url })),
    button(i18n('libDeletePage'), '', async () => {
      // 不做二次确认对话框，但删除是可撤销的：先存一份，顶部给撤销
      const backup = { key: entry.key, value: doc };
      await chrome.storage.local.remove(entry.key);
      await refresh();
      toastUndo(i18n('libDeleted', doc.items.length), async () => {
        await chrome.storage.local.set({ [backup.key]: backup.value });
        await refresh();
        toast(i18n('libRestored'));
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
      tg.textContent = i18n('uiOrphanTag');
      body.appendChild(tg);
    }
    row.append(bar, body);

    // 点一条 -> 打开原文并滚到那句话上，闪三下。
    // 没有这个的话，「我记得划过一句话，在哪儿？」搜到了也跳不过去，
    // 总览页只完成了一半。
    row.title = it.orphaned ? i18n('libOrphanNoJump') : i18n('libJumpHint');
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
  el.textContent = msg + ' ';
  const b = document.createElement('button');
  b.textContent = i18n('libUndo');
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
  if (!list.length) { toast(i18n('libNothingToExport')); return; }
  download(toMarkdownAll(list), safeFilename(i18n('libAllTitle') + ' ' + isoDate(Date.now())));
  toast(i18n('libExported', list.length));
});

// 别的标签页在划高亮时，这个页面要跟着更新
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((k) => k.startsWith(PREFIX))) refresh();
});

// 先把界面文案按当前语言填好，再渲染数据 —— 顺序反过来会闪一下英文。
applyI18n();
refresh();

// ---- 备份与恢复 ----------------------------------------------------------
//
// 为什么这个功能必须有：安装已解压的扩展时，扩展 ID 由文件夹路径决定 ——
// 挪一下目录高亮就全丢；而商店版又是另一个 ID，测试版攒的数据一条都带不过来。
// 再加上换电脑、重装浏览器。一个卖点是「痕迹不会丢」的产品缺了它，
// 是定位上的自相矛盾。

$('backup').addEventListener('click', () => {
  // 备份要包含全部页面，不受当前搜索框过滤影响 ——
  // 「导出全部 .md」按 visible() 走是对的（那是内容导出），
  // 但备份按搜索结果走就会悄悄少几页，而用户直到恢复那天才发现。
  const b = toBackup(docs.map((e) => ({ key: e.key, doc: e.doc })));
  downloadJSON(JSON.stringify(b, null, 2), safeFilename(i18n('libBackupName') + ' ' + isoDate(Date.now()), '.json'));
  toast(i18n('libBackedUp', b.pages.length));
});

$('restore').addEventListener('click', () => $('restoreFile').click());

$('restoreFile').addEventListener('change', async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  // 选完同一个文件第二次不会再触发 change，除非把 value 清掉。
  // 用户第一次选错文件、改完再选同一个名字时就会卡在这里。
  ev.target.value = '';
  if (!file) return;

  let text;
  try {
    text = await file.text();
  } catch {
    toast(i18n('libReadFail'));
    return;
  }

  const parsed = parseBackup(text);
  // core 只给错误码，文案在这一层查表：那一层是纯函数、拿不到 chrome.i18n。
  if (!parsed.ok) { toast(i18n('err' + parsed.code[0].toUpperCase() + parsed.code.slice(1))); return; }

  // 读当前全量 -> 合并 -> 只写回有变化的页。
  // 中间这段时间别的标签页可能也在写，但导入只往 items 里追加、
  // 且只写有新条目的页，最坏情况是那一页的新高亮被这次写覆盖 ——
  // 所以窗口要尽量短，读和写之间不做任何等待用户的操作。
  const all = await chrome.storage.local.get(null);
  const existing = {};
  for (const k of Object.keys(all)) if (k.startsWith(PREFIX)) existing[k] = migrate(all[k]) || all[k];

  const r = mergeBackup(existing, parsed.entries);
  const keys = Object.keys(r.merged);
  if (keys.length) {
    // 写失败必须说出来。storage.local 有配额，一份攒了很久的备份完全可能超；
    // 不接住的话这里是一个未处理的 rejection，函数当场中断 ——
    // 后面的 toast 不会执行，用户看到的是「点了没反应」，
    // 然后以为导入成功了。悄悄失败比报错更糟，这个产品尤其不能这样。
    try {
      await chrome.storage.local.set(r.merged);
    } catch (err) {
      toast(i18n('libImportFail', err && err.message ? err.message : i18n('libStorageRejected')));
      return;
    }
  }
  await refresh();

  // 如实报数，包含跳过的。只说「导入成功」的话，
  // 用户没法判断少掉的那几条是本来就有、还是被吃了。
  const bits = [];
  bits.push(i18n('libImported', r.addedItems));
  if (r.addedPages) bits.push(i18n('libNewPages', r.addedPages));
  if (r.skippedItems) bits.push(i18n('libDupSkipped', r.skippedItems));
  if (parsed.skippedPages) bits.push(i18n('libBadPages', parsed.skippedPages));
  toast(bits.join(i18n('libJoin')));
});

function downloadJSON(text, filename) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
