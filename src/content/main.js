// MAIN world。编排：加载 → 建索引 → 锚定 → 渲染 → 监听变化重锚。
// 这里不放算法（在 core/anchor.js），也不放存储（在 bridge.js）。

import { resolve, makeSelector, LEVEL } from '../core/anchor.js';
import { buildTextIndex, makeRange, selectionOffsets, UI_ATTR } from '../core/textindex.js';
import { newItem, DEFAULT_COLOR } from '../core/schema.js';
import { supported, ensureStyles, paint, setFlash, teardown } from './render.js';
import { createToolbar } from './toolbar.js';
import { createPanel } from './panel.js';

// ---------- 与 bridge 通信 ----------
let seq = 0;
const pending = new Map();
const listeners = new Map();

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const m = e.data;
  if (!m) return;
  if (m.__pf === 'res' && pending.has(m.rid)) {
    pending.get(m.rid)(m.data);
    pending.delete(m.rid);
  } else if (m.__pf === 'evt') {
    emit(m.name, m.payload);
  }
});

// 事件可能比监听器先到：service worker 注入完 bridge 就立刻发「打开面板」，
// 而 MAIN 这边 boot() 还在等存储返回，listeners 还没注册。
// 直接丢弃的话，首次点图标就不会开面板 —— 而且是偶发的，最难查。
const earlyEvts = [];
function emit(name, payload) {
  const fn = listeners.get(name);
  if (fn) fn(payload);
  else earlyEvts.push({ name, payload });
}
function on(name, fn) {
  listeners.set(name, fn);
  for (let i = earlyEvts.length - 1; i >= 0; i--) {
    if (earlyEvts[i].name !== name) continue;
    const [e] = earlyEvts.splice(i, 1);
    fn(e.payload);
  }
}

function call(op, payload, timeout = 2000) {
  return new Promise((done) => {
    const rid = 'r' + ++seq;
    const t = setTimeout(() => { pending.delete(rid); done(undefined); }, timeout);
    pending.set(rid, (d) => { clearTimeout(t); done(d); });
    window.postMessage({ __pf: 'req', op, payload, rid }, '*');
  });
}

// ---------- 状态 ----------
let doc = null;
let stats = { ok: 0, orphan: 0, total: 0, cost: 0, runs: 0, levels: {}, saveError: null };
let timer = null;
let budget = 250;
let observer = null;
let toolbar = null;
let panel = null;
// 扩展被更新/重载后，本页残留的 content script 与扩展断了联系。
// 此时高亮还画着（渲染不依赖 chrome.*），但写不进存储 —— 必须停止接受修改，
// 否则用户划的东西看着成功、其实全丢。
let dead = false;
// 每次重锚记下每条高亮**当前**落在哪儿。命中测试必须用这个，
// 不能用 item.start —— 那是创建时的偏移，页面变过之后就不准了。
const anchored = new Map();

// ---------- 重锚 ----------
function reanchor(reason) {
  if (!doc) return;
  const t0 = performance.now();
  const idx = buildTextIndex();
  const cache = {};                       // 归一化结果在一批 selector 之间复用
  const byColor = new Map();
  const levels = { 1: 0, 2: 0, 3: 0, 4: 0 };
  anchored.clear();
  let ok = 0;
  let orphan = 0;

  for (const it of doc.items) {
    const r = resolve(idx.text, it, cache);
    levels[r.level] = (levels[r.level] || 0) + 1;
    if (r.level === LEVEL.ORPHAN) {
      // 🔴 锚不上不删数据。差评里最狠的一条就是「高亮消失了」。
      // 站点改版、A/B 分流、内容折叠都会让文字暂时不在页面上，明天可能又回来。
      it.orphaned = true;
      orphan++;
      continue;
    }
    const range = makeRange(idx, r.start, r.end);
    if (!range) { it.orphaned = true; orphan++; continue; }
    it.orphaned = false;
    // 补判「这条是不是代码」。创建时判过一次，但早期数据没有这个字段，
    // 在这里顺手补上就不需要单独写一版数据迁移 —— 锚都锚上了，
    // 现成的 range 就能问出答案，成本几乎为零。
    if (it.kind === undefined) {
      const c = classify(idx, r.start, r.end);
      it.kind = c.kind;
      if (c.parts) it.parts = c.parts;
    }
    // 把偏移更新到本次锚到的实际位置（只改内存，不每次都写存储）。
    // 不更新的话：① 下次重锚永远走不到 L1 快路径 ② 面板和导出的排序
    // 用的还是创建时的偏移，页面结构变过之后顺序就乱了。
    it.start = r.start;
    it.end = r.end;
    anchored.set(it.id, { start: r.start, end: r.end, range });
    ok++;
    // 上下文分不清时弱化显示，而不是画得和确定的一样确定
    const bucket = r.ambiguous ? 'ambiguous' : (it.color || DEFAULT_COLOR);
    if (!byColor.has(bucket)) byColor.set(bucket, []);
    byColor.get(bucket).push(range);
  }

  paint(byColor);

  const cost = performance.now() - t0;
  // 自适应退避：索引越贵就等越久，别把宿主页面拖卡
  budget = Math.min(2000, Math.max(250, Math.round(cost * 8)));
  stats = {
    ok, orphan, total: doc.items.length, runs: stats.runs + 1,
    cost: Math.round(cost * 10) / 10, budget, levels, reason,
    textLen: idx.text.length,
    saveError: stats.saveError,   // reanchor 不该顺手把错误状态抹掉
  };
  if (panel) panel.refresh();
  tryPendingLocate();
}

function scheduleReanchor(reason) {
  clearTimeout(timer);
  timer = setTimeout(() => reanchor(reason), budget);
}

// 必须排除我们自己造成的变化，否则会自激成死循环
function isOwn(rec) {
  const node = rec && rec.target;
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  return !!(el && el.closest && el.closest('[' + UI_ATTR + ']'));
}

// ---------- 操作 ----------
// 写操作一律传「做了什么」，不传整份 doc。多标签页并发时整份覆盖会丢数据，
// 理由写在 bridge.js 的 apply() 上。
//
// 🔴 写失败必须让用户知道。先乐观渲染是为了手感（点下去立刻有反应），
// 但如果存储那边失败了还继续显示，用户会以为存上了，刷新后凭空消失 ——
// 这正是我们要打的那条差评。所以失败要回滚 + 报错。
async function applyOps(ops, reason, optimistic) {
  if (dead) { showDeadNotice(); return false; }

  // 🔴 回滚必须靠本地快照，不能靠「从存储重新读一遍」。
  // 存储读不回来的场景（扩展被更新、配额满）恰恰就是写失败的场景 ——
  // 那时 reload 也失败，于是乐观加上的那条留在内存里继续显示，
  // 用户以为存上了，刷新后凭空消失。
  const snapshot = doc ? doc.items.slice() : [];
  if (optimistic) { optimistic(); reanchor(reason); }

  const d = await call('apply', ops);
  if (!d || d.error) {
    stats.saveError = (d && d.error) || 'timeout';
    // 扩展更新导致的失联是预期状态，已经有常驻提示条了，不必再记成 error ——
    // 否则每次商店推新版本，所有用户的扩展卡片上都会挂红。
    if (stats.saveError === 'context-invalidated') {
      console.debug('[pf] 扩展已更新，本页需刷新');
    } else {
      console.error('[pf] 保存失败，已回滚：', stats.saveError);
    }
    if (doc) { doc.items = snapshot; reanchor('rollback'); }
    if (stats.saveError === 'context-invalidated') { dead = true; showDeadNotice(); }
    return false;
  }
  stats.saveError = null;
  doc = d;
  reanchor(reason);
  return true;
}

async function addFromSelection(color) {
  if (!doc) return null;
  const idx = buildTextIndex();
  const off = selectionOffsets(idx);
  if (!off) return null;

  // exact 从索引里切，不用 selection.toString() —— 后者的空白规整方式与
  // DOM 拼接不一致，会造成「明明选中了却锚不上」的假象。
  const sel = makeSelector(idx.text, off.start, off.end);

  // 趁选区还在，把「渲染出来的样子」也留一份 —— 它带块元素之间的换行，
  // 导出时读起来才是分段的。必须在 removeAllRanges 之前取。
  const s = window.getSelection();
  const display = s ? s.toString() : '';
  // kind 交给重锚时统一判定（那里能拿到索引，判得更准）。
  // 这里不预判，省得两处逻辑分叉。
  const item = newItem(sel, color || DEFAULT_COLOR, display);

  if (s) s.removeAllRanges();

  const ok = await applyOps({ add: [item] }, 'add', () => doc.items.push(item));
  return ok ? item.id : null;
}

// 这段文字落在代码里吗。导出时据此决定用围栏还是引用块 ——
// 引用块会丢掉等宽字体和语法高亮，而技术文章里的高亮相当一部分是代码。
//
// 🔴 不能只看 commonAncestorContainer：从标题拖到代码块里，共同祖先落在
// <pre> 外面，整条会被当成散文；反过来也有一条混合选区被判成纯代码，
// 结果中文进了代码块。实测 14 条里 3 条是混合的（21%），必须按段拆。
function segmentKinds(idx, start, end) {
  const segs = [];
  for (const m of idx.map) {
    if (m.end <= start || m.start >= end) continue;
    const s = Math.max(m.start, start);
    const e = Math.min(m.end, end);
    const p = m.node.parentElement;
    const kind = (p && p.closest && p.closest('pre, code')) ? 'code' : 'text';
    const text = idx.text.slice(s, e);
    const last = segs[segs.length - 1];
    if (last && last.kind === kind) last.text += text;
    else segs.push({ kind, text });
  }
  return segs;
}

// 返回 {kind, parts}：kind 为 'code' / 'text' / 'mixed'，
// 只有 'mixed' 才需要连 parts 一起存
function classify(idx, start, end) {
  const segs = segmentKinds(idx, start, end).filter((s) => s.text.trim());
  if (segs.length === 0) return { kind: 'text' };
  if (segs.length === 1) return { kind: segs[0].kind };
  return { kind: 'mixed', parts: segs };
}

function remove(id) {
  if (!doc || !doc.items.some((it) => it.id === id)) return Promise.resolve(false);
  return applyOps({ remove: [id] }, 'remove',
    () => { doc.items = doc.items.filter((it) => it.id !== id); });
}

function setColor(id, color) {
  return applyOps({ patch: [{ id, color }] }, 'recolor', () => {
    const it = doc.items.find((x) => x.id === id);
    if (it) it.color = color;
  });
}

function setNote(id, note) {
  return applyOps({ patch: [{ id, note }] }, 'note', () => {
    const it = doc.items.find((x) => x.id === id);
    if (it) it.note = note;
  });
}

// ---------- 命中测试：点在哪条高亮上 ----------
function offsetFromPoint(idx, x, y) {
  let node = null;
  let off = 0;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (!p) return -1;
    node = p.offsetNode; off = p.offset;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (!r) return -1;
    node = r.startContainer; off = r.startOffset;
  } else return -1;
  if (!node || node.nodeType !== Node.TEXT_NODE) return -1;
  const base = idx.nodeStart.get(node);
  return base === undefined ? -1 : base + off;
}

function itemAtPoint(x, y) {
  if (!doc || anchored.size === 0) return null;
  const idx = buildTextIndex();
  const off = offsetFromPoint(idx, x, y);
  if (off < 0) return null;
  for (const it of doc.items) {
    const a = anchored.get(it.id);
    if (a && off >= a.start && off < a.end) return { item: it, range: a.range };
  }
  return null;
}

// 面板里点某一条 -> 滚到页面上对应的位置。
// Range 没有 scrollIntoView，只能自己算。
function locateItem(id, withFlash) {
  const a = anchored.get(id);
  if (!a || !a.range) return false;
  const r = a.range.getBoundingClientRect();
  if (!r.width && !r.height) return false;
  window.scrollTo({ top: window.scrollY + r.top - window.innerHeight / 3, behavior: 'smooth' });
  if (withFlash) flashItem(a.range);
  return true;
}

// 扩展更新后必须明确告诉用户「现在改不了了，刷新一下」。
// 不说的话，用户会以为划上了 —— 而画面上确实划上了，只是存不进去。
// 这是个罕见但后果严重的状态，所以用一个显眼的常驻条，不用一闪而过的 toast。
let deadNotice = null;
function showDeadNotice() {
  if (deadNotice) return;
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  host.style.cssText = 'all:initial';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML =
    '<style>' +
    '.b{position:fixed;right:16px;bottom:16px;z-index:2147483647;' +
    'background:#7a2b2b;color:#fff;padding:10px 14px;border-radius:10px;' +
    'font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.35);display:flex;align-items:center;gap:10px}' +
    'button{border:0;border-radius:6px;padding:5px 11px;font:inherit;cursor:pointer;' +
    'background:#fff;color:#7a2b2b}' +
    '</style>' +
    '<div class="b"><span>扩展已更新，本页需刷新后才能继续保存高亮</span>' +
    '<button>刷新</button></div>';
  root.querySelector('button').addEventListener('click', () => location.reload());
  (document.body || document.documentElement).appendChild(host);
  deadNotice = host;
}

// 从总览页跳过来时闪三下。不闪的话，页面滚过去了用户也不知道该看哪一句 ——
// 尤其目标本来就是黄色高亮，混在同页其它高亮里根本认不出来。
let flashTimer = null;
function flashItem(range) {
  clearTimeout(flashTimer);
  let n = 0;
  const tick = () => {
    setFlash(n % 2 === 0 ? [range] : []);
    n++;
    if (n < 6) flashTimer = setTimeout(tick, 240);
    else setFlash([]);
  };
  tick();
}

// 从总览页过来的定位请求。可能在高亮还没锚上时就到了（页面刚开始加载），
// 所以存起来，等某次重锚真的把它锚上了再执行。
let pendingLocate = null;
function tryPendingLocate() {
  if (!pendingLocate) return;
  if (locateItem(pendingLocate, true)) pendingLocate = null;
}

async function pullLocate() {
  const id = await call('takeLocate');
  if (id) { pendingLocate = id; tryPendingLocate(); }
}

async function reload(reason) {
  const d = await call('load');
  if (d && !d.error) { doc = d; reanchor(reason); }
}

// ---------- 启动 ----------
async function boot() {
  if (!supported()) {
    console.warn('[pf] 本浏览器不支持 CSS Custom Highlight API（需 Chrome/Edge 105+）');
    return;
  }
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    return;
  }
  ensureStyles();

  // bridge 可能还没就位，重试几次再放弃
  for (let i = 0; i < 12 && !doc; i++) {
    const d = await call('load');
    if (d && !d.error) doc = d;
    else await new Promise((r) => setTimeout(r, 150));
  }
  if (!doc) { console.warn('[pf] 连不上存储桥，放弃'); return; }

  reanchor('boot');
  pullLocate();

  observer = new MutationObserver((records) => {
    if (records.every(isOwn)) return;
    scheduleReanchor('mutation');
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // 快捷键有两条路，因为 chrome.commands 会静默失败：
  // 若 Alt+H 已被别的扩展占用，Chrome 不声不响地不给我们绑定，
  // chrome://extensions/shortcuts 里显示为空，用户只会觉得「按了没反应」。
  // 所以页面内再挂一个 keydown 兜底，两条路用时间戳去重。
  // 每个命令各自去重：同一个命令会同时从 chrome.commands 和页内 keydown 到达，
  // 不去重的话 Alt+D 会开一次关一次，看起来就是「按了没反应」。
  const lastAt = new Map();
  const trigger = (name, from) => {
    const now = Date.now();
    if (now - (lastAt.get(name) || 0) < 400) return;
    lastAt.set(name, now);
    if (name === 'highlight') addFromSelection();
    else if (name === 'toggle-panel') panel.toggle();
  };

  on('cmd', (name) => trigger(name, 'chrome.commands'));

  document.addEventListener('keydown', (e) => {
    // 事件来自我们自己的 UI（笔记框）时不处理，否则在框里按 Alt+H 会新建高亮
    if ((toolbar && toolbar.contains(e.target)) ||
        (panel && panel.contains(e.target))) return;
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    // e.key 在 Alt 组合下某些布局会变形，同时看 code 更稳
    if (e.key === 'h' || e.key === 'H' || e.code === 'KeyH') {
      e.preventDefault();
      trigger('highlight', 'keydown');
    } else if (e.key === 'd' || e.key === 'D' || e.code === 'KeyD') {
      e.preventDefault();
      trigger('toggle-panel', 'keydown');
    }
  }, true);

  // 同一页开在多个标签里时，别的标签改了要跟着变
  on('changed', (d) => {
    if (d && !d.error) { doc = d; reanchor('sync'); }
  });

  // 扩展被更新/重载：停掉一切会写数据的路径，并明确告知用户
  on('dead', () => {
    if (dead) return;
    dead = true;
    if (observer) observer.disconnect();     // 别再空转，也别再刷一屏报错
    clearTimeout(timer);
    showDeadNotice();
  });

  // SPA 路由切换不触发任何 load 事件，只能轮询 URL。
  // 换页 = 换存储 key，不重新加载会把上一页的高亮画到这一页上。
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      reload('route').then(pullLocate);
    }
  }, 400);

  // ---------- 划词工具条 ----------
  const st = (await call('strings')) || {};
  toolbar = createToolbar({
    strings: { note: st.uiNote, del: st.uiDelete, notePlaceholder: st.uiNotePlaceholder },
    onColor: (id, color) => (id ? setColor(id, color) : addFromSelection(color)),
    onDelete: (id) => remove(id),
    onNote: (id, text) => setNote(id, text),
  });
  toolbar.mount();

  panel = createPanel({
    strings: {
      panelTitle: st.uiPanelTitle, copyMd: st.uiCopyMd, download: st.uiDownload,
      copyText: st.uiCopyText, copied: st.uiCopied, copyFailed: st.uiCopyFailed,
      downloaded: st.uiDownloaded, nothing: st.uiNothing,
      emptyHint: st.uiEmptyHint, orphanTag: st.uiOrphanTag, del: st.uiDelete,
      library: st.uiLibrary, allShort: st.uiAllShort,
      keyHighlight: st.uiKeyHighlight, keyPanel: st.uiKeyPanel, keyUnset: st.uiKeyUnset,
    },
    getDoc: () => doc,
    onDelete: (id) => remove(id),
    onLocate: (id) => locateItem(id, true),
    getShortcuts: () => call('shortcuts'),
    onOpenLibrary: async () => {
      const r = await call('openLibrary');
      if (r && r.error) { dead = true; showDeadNotice(); }
    },
  });
  panel.mount();

  document.addEventListener('mouseup', (e) => {
    if (toolbar.contains(e.target) || panel.contains(e.target)) return;
    // 让浏览器先把选区结算完，否则拿到的还是上一次的
    setTimeout(() => {
      const s2 = window.getSelection();
      if (s2 && !s2.isCollapsed && s2.rangeCount > 0) {
        const rect = s2.getRangeAt(0).getBoundingClientRect();
        if (rect.width || rect.height) toolbar.showForSelection(rect);
        return;
      }
      // 命中测试要重建整页文本索引（长文约 5ms），所以只在确实没有选区时才做
      const hit = itemAtPoint(e.clientX, e.clientY);
      if (hit) {
        // 上次重锚留下的 Range 可能已经失效，取不到尺寸就退回鼠标位置，
        // 否则工具条会飞到左上角
        const r = hit.range.getBoundingClientRect();
        const rect = (r.width || r.height) ? r
          : { top: e.clientY, bottom: e.clientY, left: e.clientX, width: 0, height: 0 };
        toolbar.showForItem(hit.item, rect);
      } else if (!toolbar.isEditing()) toolbar.hide();
    }, 0);
  }, true);

  // 笔记展开时不能因为一次滚动就收起来，刚打的字会丢
  window.addEventListener('scroll', () => {
    if (toolbar && !toolbar.isEditing()) toolbar.hide();
  }, true);

  // 调试入口。产品不显示仪表盘，但排查时要能立刻拿到数字。
  window.__pfhl = {
    stats: () => stats,
    doc: () => doc,
    add: addFromSelection,
    remove,
    setColor,
    setNote,
    reanchor,
    hit: itemAtPoint,
    panel: () => panel,
    locate: (id) => locateItem(id, true),
    teardown: () => {
      if (observer) observer.disconnect();
      if (toolbar) toolbar.destroy();
      if (panel) panel.destroy();
      teardown();
    },
  };
  console.log('[pf] 就位，调试入口 window.__pfhl', stats);
}

// 防重复注入（注册的 content script 与首次手动注入会撞车）。
// 🔴 名字必须和验证 demo 区分开：两个扩展若共用 __pfMain，
// 谁先注入谁赢，后到的那个静默退出，表现就是「装了但完全没反应」。
if (!window.__pfHlMain) {
  window.__pfHlMain = true;
  boot();
}
