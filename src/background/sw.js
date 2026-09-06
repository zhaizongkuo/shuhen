// 权限模型本身就是差异化：安装时不要任何主机权限，用户点图标才按站授权。
// 差评里 6 条有 2 条在骂「凭什么高亮要读我的浏览历史」—— 用结构回答，不是用文案。

import { pageKey } from '../core/pagekey.js';

const ISO = 'pf-iso';
const MAIN = 'pf-main';

// substitutions 一律转成字符串 —— getMessage 传数字不生效，
// 而且它不报错，只是占位符原样留在界面上。
const t = (k, subs) =>
  chrome.i18n.getMessage(k, subs == null ? undefined : [].concat(subs).map(String)) || k;

// 失败必须看得见。不开 DevTools 也要能知道卡在哪一步。
async function badge(tabId, text, color) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: color || '#c00' });
  } catch { /* 标签页可能已关闭 */ }
}

function originPattern(url) {
  const u = new URL(url);
  return u.protocol + '//' + u.hostname + '/*';
}

function specsFor(origin) {
  return [
    { id: ISO + ':' + origin, matches: [origin], js: ['content/bridge.js'],
      world: 'ISOLATED', runAt: 'document_idle' },
    { id: MAIN + ':' + origin, matches: [origin], js: ['content/main.js'],
      world: 'MAIN', runAt: 'document_idle' },
  ];
}

async function register(origin) {
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const ids = new Set(existing.map((s) => s.id));
  for (const spec of specsFor(origin)) {
    if (ids.has(spec.id)) await chrome.scripting.updateContentScripts([spec]);
    else await chrome.scripting.registerContentScripts([spec]);
  }
}

// 🔴 这个监听器**不能是 async**，而且 permissions.request 之前不许出现任何 await。
//
// 用户手势令牌撑不过一次异步跳转。哪怕只是 `await someAsyncFn()`（函数体内部
// 立即 return，不做任何 IO），也足以让 permissions.request 抛
// 「This function must be called during a user gesture」，界面上就是点了图标
// 毫无反应 —— 角标 PRM。
//
// 曾经踩过一次：demo 里能跑通的路径恰好是 tab.url 存在、零 await 的那条。
// 产品版重构时把取 url 包成了 async 函数，于是每条路径都多了一次 await，
// 手势断掉，回归。所以这里宁可写得难看，也要保持同步。
chrome.action.onClicked.addListener((tab) => {
  const url = tab && tab.url;          // 同步取，不许 await

  if (!url || pageKey(url) === null) {
    // activeTab 正常情况下会让 tab.url 有值。没有值通常是页面早于扩展加载，
    // 或者当前是受限页面。此时已经没法在手势内申请权限了，只能提示重来。
    fail(tab && tab.id, 'URL', t('swNoUrl'));
    return;
  }

  const origin = originPattern(url);
  chrome.permissions.request({ origins: [origin] })
    .then((granted) => {
      if (!granted) { fail(tab.id, 'NO', t('grantDenied')); return; }
      return activate(tab.id, origin);
    })
    .catch((e) => fail(tab.id, 'PRM', t('swPermFail', msg(e)) + t('swPermGesture')));
});

function msg(e) { return String((e && e.message) || e); }

// 哪些是「用户正常操作就会遇到」的状态。它们要给用户反馈，但**不能记成 error** ——
// chrome://extensions 会把 console.error/warn 收集起来，在扩展卡片上挂一个红色
// 「错误」按钮。用户在 chrome:// 页上点一下图标就挂红，审核的人看到的第一印象
// 就是「这插件有问题」，而它其实什么问题都没有。
const EXPECTED = new Set(['URL', 'NO']);

// 失败必须看得见，而且要能看见**原因**。只显示三个字母的角标，
// 排查时还得去翻 SW 控制台；把原因塞进 tooltip，鼠标一悬停就知道。
function fail(tabId, code, detail) {
  if (EXPECTED.has(code)) console.debug('[pf]', code, detail);
  else console.error('[pf]', code, detail);
  badge(tabId, code);
  if (tabId != null) {
    chrome.action.setTitle({ tabId, title: '[' + code + '] ' + detail }).catch(() => {});
  }
}

async function activate(tabId, origin) {
  try {
    await register(origin);
  } catch (e) {
    fail(tabId, 'REG', t('swRegFail', msg(e)));
    return;
  }
  // 注册只对后续导航生效，当前页要手动注入一次
  try {
    await chrome.scripting.executeScript({
      target: { tabId }, files: ['content/bridge.js'], world: 'ISOLATED' });
    await chrome.scripting.executeScript({
      target: { tabId }, files: ['content/main.js'], world: 'MAIN' });
  } catch (e) {
    fail(tabId, 'INJ', t('swInjFail', msg(e)));
    return;
  }
  await badge(tabId, 'ON', '#0a0');
  chrome.action.setTitle({ tabId, title: t('swEnabled', origin) }).catch(() => {});

  // 点图标 = 开关面板。用户的本能就是点图标，而原来点完只有一个绿角标、
  // 界面上什么都不发生 —— 首次体验等于「装好了但不知道能干嘛」。
  // 首次授权后直接把面板打开，里面写着「选中文字，或按 Alt+H」，
  // 顺手把下一步告诉用户。
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'cmd', name: 'toggle-panel' });
  } catch (_) { /* 刚注入完，偶尔还没接上，忽略 */ }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'openLibrary') chrome.runtime.openOptionsPage();
});

chrome.commands.onCommand.addListener(async (name) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'cmd', name });
  } catch {
    // 没有 content script 在跑 = 本站还没授权。这不是错误，是正常状态。
    await badge(tab.id, '?', '#888');
  }
});

// 权限可能在扩展外被撤销，启动时按实际授权重新对齐
async function sync() {
  try {
    const { origins = [] } = await chrome.permissions.getAll();
    const want = new Set();
    for (const o of origins) {
      try { await register(o); } catch (e) { console.warn('[pf] 重注册失败', o, e); }
      want.add(ISO + ':' + o);
      want.add(MAIN + ':' + o);
    }
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const stale = existing.map((s) => s.id).filter((id) => !want.has(id));
    if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
  } catch (e) {
    console.error('[pf] sync 失败', e);
  }
}

chrome.runtime.onStartup.addListener(sync);
chrome.runtime.onInstalled.addListener(sync);
chrome.permissions.onRemoved.addListener(sync);
