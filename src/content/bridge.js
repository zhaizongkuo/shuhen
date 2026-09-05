// ISOLATED world。唯一职责：替 MAIN world 读写 chrome.storage，并转发快捷键。
//
// 为什么要拆成两个 world：渲染必须在 MAIN（页面自己的 JS 世界）里做，
// 否则 CSS.highlights 注册表可能和页面的 ::highlight() 规则不在同一个 realm；
// 而 MAIN world 拿不到 chrome.*。于是存储留在这边，两边只传纯 JSON。
// （DOM 节点无法跨 world 结构化克隆，所以锚点只能是纯字符偏移 —— 这是架构约束，
//   不是实现选择。）
//
// 安全边界，如实记录：MAIN world 的代码页面能看见也能改，postMessage 页面也能监听。
// 本扩展只在「当前这一页」的数据上通信，页面能看到的只是它自己的文本 —— 它本来就有。
// 唯一额外暴露的是用户写的笔记。在敌意站点上写私密笔记是这套架构的已知风险，
// v1 不解决，但必须写进文档，不许假装没有。

import { storageKey, LOCATE_KEY, LOCATE_TTL } from '../core/pagekey.js';
import { migrate, newDoc } from '../core/schema.js';

const TAG = 'pf';

function key() {
  return storageKey(location.href);
}

async function readDoc(k) {
  const got = await chrome.storage.local.get(k);
  return migrate(got[k]) || newDoc(location.href, document.title);
}

async function load() {
  const k = key();
  if (!k) return { error: 'unsupported page' };
  return readDoc(k);
}

/**
 * 🔴 所有写操作都走这里，而且是「读-改-写」，不是整份覆盖。
 *
 * 为什么不能整份覆盖：同一篇文章可能开在两个标签页里。A 加了一条高亮，
 * B 手上还是旧的 doc；B 再加一条时把整份写回去，A 那条就没了 ——
 * 用户看到的现象正是「我的高亮自己消失了」，也就是差评里最狠的那条。
 * 传操作而不是传整份状态，这类丢失从根上就不存在。
 *
 * @param {{add?:object[], remove?:string[], patch?:object[]}} ops
 */
async function apply(ops) {
  const k = key();
  if (!k) return { error: 'unsupported page' };

  const doc = await readDoc(k);          // 以存储里的最新版本为基准，不是调用方手上的
  const o = ops || {};

  if (Array.isArray(o.remove) && o.remove.length) {
    const kill = new Set(o.remove);
    doc.items = doc.items.filter((it) => !kill.has(it.id));
  }
  if (Array.isArray(o.patch)) {
    const byId = new Map(doc.items.map((it) => [it.id, it]));
    for (const p of o.patch) {
      const it = byId.get(p.id);
      if (it) Object.assign(it, p);
    }
  }
  if (Array.isArray(o.add)) {
    const have = new Set(doc.items.map((it) => it.id));
    for (const it of o.add) if (!have.has(it.id)) doc.items.push(it);
  }

  doc.url = location.href;
  doc.title = document.title;
  doc.updated = Date.now();

  // 一条不剩就整条删掉，不留空壳占配额
  if (doc.items.length === 0) await chrome.storage.local.remove(k);
  else await chrome.storage.local.set({ [k]: doc });

  return doc;
}

// MAIN world 没有 chrome.i18n，界面文案只能从这边送过去。
// 键写死成一张表，别让 MAIN 随便点名要 —— 那等于把 i18n 接口暴露给页面。
const UI_KEYS = [
  'uiNote', 'uiDelete', 'uiNotePlaceholder',
  'uiPanelTitle', 'uiCopyMd', 'uiDownload', 'uiCopyText',
  'uiCopied', 'uiCopyFailed', 'uiDownloaded',
  'uiNothing', 'uiEmptyHint', 'uiOrphanTag', 'uiLibrary', 'uiAllShort',
  'uiKeyHighlight', 'uiKeyPanel', 'uiKeyUnset', 'uiKeySetLink',
];
function strings() {
  const out = {};
  for (const k of UI_KEYS) out[k] = chrome.i18n.getMessage(k) || k;
  return out;
}

// content script 里没有 chrome.runtime.openOptionsPage，只能让 SW 去开
async function openLibrary() {
  await chrome.runtime.sendMessage({ type: 'openLibrary' });
  return true;
}

// 取走「跳到某条高亮」的请求。取完就清 —— 留着的话，下次再打开这一页
// 会莫名其妙又闪一下，用户不知道发生了什么。
async function takeLocate() {
  const got = await chrome.storage.local.get(LOCATE_KEY);
  const req = got[LOCATE_KEY];
  if (!req) return null;
  const stale = Date.now() - (req.at || 0) > LOCATE_TTL;
  const mine = req.key === key();
  if (!mine && !stale) return null;          // 是给别的页面的，留着别动
  await chrome.storage.local.remove(LOCATE_KEY);
  return (mine && !stale) ? req.id : null;
}

// 显示快捷键必须读实际绑定值，不能写死「Alt+H」：
// ① 用户可以在 chrome://extensions/shortcuts 里改
// ② 键位被别的扩展占用时 Chrome 会静默不绑定，此处返回空字符串 ——
//    把这件事显示出来，用户才知道该去设一个，而不是以为插件坏了
async function shortcuts() {
  const list = await chrome.commands.getAll();
  const out = {};
  for (const c of list) out[c.name] = c.shortcut || '';
  return out;
}

const OPS = { load, apply, strings, openLibrary, takeLocate, shortcuts };

// 扩展被更新或重载后，页面里残留的 content script 会失去 chrome.* ——
// 报 "Extension context invalidated"。商店自动更新时**所有开着的标签页**
// 都会进这个状态，不是只有开发时才遇到。
//
// 🔴 必须让 MAIN 知道。否则用户照样能划高亮、画面上也出现了，但存不进去，
// 刷新后凭空消失 —— 正是我们要打的那条差评。
function alive() {
  try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
}

let deadNotified = false;
function notifyDead() {
  if (deadNotified) return;
  deadNotified = true;
  window.postMessage({ __pf: 'evt', name: 'dead' }, '*');
}

window.addEventListener('message', async (e) => {
  if (e.source !== window) return;                 // 只收本窗口，挡掉 iframe 串扰
  const m = e.data;
  if (!m || m.__pf !== 'req' || typeof m.rid !== 'string') return;

  if (!alive()) {
    notifyDead();
    window.postMessage({ __pf: 'res', rid: m.rid, data: { error: 'context-invalidated' } }, '*');
    return;
  }

  const fn = OPS[m.op];
  let data;
  try {
    data = fn ? await fn(m.payload) : { error: 'unknown op: ' + m.op };
  } catch (err) {
    if (!alive() || String(err && err.message).includes('context invalidated')) {
      notifyDead();
      window.postMessage({ __pf: 'res', rid: m.rid, data: { error: 'context-invalidated' } }, '*');
      return;
    }
    // 配额满、storage 被禁用等等。绝不能静默 —— 静默的后果是
    // 「界面上画出来了，其实没存上」，刷新之后高亮凭空消失。
    // 这一支是真异常，该记成 error（上面的失联属于预期状态，已经提前返回了）。
    console.error('[' + TAG + '] 存储操作失败', m.op, err);
    data = { error: String((err && err.message) || err) };
  }
  window.postMessage({ __pf: 'res', rid: m.rid, data }, '*');
});

// 同一页开在多个标签里时，一边改了另一边要跟着变
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const k = key();
  if (!k || !(k in changes)) return;
  const doc = migrate(changes[k].newValue) || newDoc(location.href, document.title);
  window.postMessage({ __pf: 'evt', name: 'changed', payload: doc }, '*');
});

// SW 把快捷键送到这里，再转进 MAIN world
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'cmd') {
    window.postMessage({ __pf: 'evt', name: 'cmd', payload: msg.name }, '*');
  }
});

console.log('[' + TAG + '] bridge 就位');
