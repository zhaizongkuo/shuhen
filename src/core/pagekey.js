// 高亮存在哪个 key 下 —— 这个决定用户能不能再看见自己的高亮，
// 而且一旦线上有了数据就很难改（改了等于所有人的高亮集体丢失）。
//
// 判断依据：
//   hash  一律去掉。#section 是页内定位，不是另一个页面。
//   query 默认保留，只删已知的追踪参数。
//         反过来（只保留白名单）会出事：微信公众号文章的正文由
//         ?__biz=&mid=&idx=&sn= 决定，删掉就变成所有文章共用一个 key。
//         所以必须是黑名单，宁可多留也不能错删。
//   端口/协议：http 与 https 视为同一页；同一站点升级 https 不该丢高亮。

// 只列真正与内容无关的。拿不准的一律不列 —— 错删的代价远大于多留。
const TRACKING = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gclid', 'fbclid', 'msclkid', 'yclid', 'dclid', 'igshid', 'mc_cid', 'mc_eid',
  'ref', 'refer', 'referrer', 'source', 'from', 'from_source',
  'spm', 'scm', 'share_token', 'share_source', 'share_medium', 'share_plat',
  'share_id', 'shareId', 'sharesource', 'weibo_id', 'isappinstalled',
  'hmsr', 'hmpl', 'hmcu', 'hmkw', 'hmci',            // 百度统计
  'code', 'state',                                    // OAuth 回跳残留
  '_hsenc', '_hsmi', 'vero_id', 'wickedid', 'oly_enc_id', 'trk', 'trkCampaign',
]);

// 前缀式追踪参数
const TRACKING_PREFIX = ['utm_', 'pk_', 'piwik_', 'matomo_', 'at_', 'ttclid'];

function isTracking(name) {
  const n = name.toLowerCase();
  if (TRACKING.has(name) || TRACKING.has(n)) return true;
  return TRACKING_PREFIX.some((p) => n.startsWith(p));
}

/**
 * 把一个 URL 归一化成存储 key。
 * @returns {string|null} 非 http(s) 返回 null —— 这类页面不支持高亮
 */
export function pageKey(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const params = [];
  for (const [k, v] of u.searchParams) {
    if (!isTracking(k)) params.push([k, v]);
  }
  // 排序：?a=1&b=2 和 ?b=2&a=1 是同一个页面，不排序会存成两份
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : 1)));
  const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  // 去掉末尾斜杠，但根路径保留 "/"
  let path = u.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  // host 里不带协议：同站升级 https 后高亮仍在
  const host = u.hostname + (u.port && u.port !== '80' && u.port !== '443' ? ':' + u.port : '');
  return host + path + (qs ? '?' + qs : '');
}

// 总览页要「跳到某条高亮」时，先把目标写在这里，再打开目标页。
// 不用 URL hash 传：那会污染用户看到的地址，还可能触发站点自己的路由。
// 也不用消息传：目标页的 content script 何时就绪不确定，会有竞态。
// 放在存储里由目标页主动来取，时序上最稳，取完即清。
export const LOCATE_KEY = 'pf:locate';

/** 超过这个时间的定位请求视为过期，避免下次打开同一页时莫名闪一下 */
export const LOCATE_TTL = 30000;

/** storage 里的实际字段名。加前缀是为了将来能一眼分辨自家数据。 */
export function storageKey(rawUrl) {
  const k = pageKey(rawUrl);
  return k === null ? null : 'pg:' + k;
}
