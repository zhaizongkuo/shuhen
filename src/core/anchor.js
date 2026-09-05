// 锚定引擎。这是整个产品的价值所在，所以它必须满足两条：
//   1. resolve() 是纯字符串函数 —— 不碰 DOM、不碰 chrome.*，能被 node --test 直接测
//   2. 找不到就返回 orphan，绝不返回一个「差不多」的位置
// 第 2 条是产品判断不是技术判断：差评里「高亮丢了」很伤，
// 但「高亮标错地方」更伤 —— 用户会认为这工具在乱标，然后卸载。

export const CTX = 32;          // 前后缀采样长度
export const MAX_HITS = 64;     // 全文命中上限，防极端页面卡死
export const L1_CTX_MIN = 0.9;  // L1 快路径要求的上下文吻合度下限（取两侧较小值）

// 三个权重必须满足：POS_W < AMBIG_DELTA * CTX_W
// 含义是「位置只用来打破上下文分不出高下的平局」。若位置权重大到能推翻
// 上下文的判断，就会和 ambiguous 的定义自相矛盾 —— 一边说上下文区分得开，
// 一边又按位置选了上下文更差的那个。
export const CTX_W = 4;
export const POS_W = 0.15;
export const AMBIG_DELTA = 0.05;

export const LEVEL = {
  POSITION: 1,   // 原偏移直接命中，O(1)
  UNIQUE: 2,     // 全文唯一匹配
  DISAMBIG: 3,   // 多处匹配，靠前后缀消歧
  ORPHAN: 4,     // 找不到 —— 数据保留，不删
};

// ---------- 空白归一化 ----------
// 站点重排版经常把 "foo\n  bar" 变成 "foo bar"。原文搜不到时退到归一化文本再搜一次。
// map[i] 是归一化串第 i 个字符在原文里的下标，用来把结果映射回去。
export function normalize(text) {
  const out = [];
  const map = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === ' ') {
      if (inSpace) continue;
      inSpace = true;
      out.push(' ');
      map.push(i);
    } else {
      inSpace = false;
      out.push(c);
      map.push(i);
    }
  }
  return { norm: out.join(''), map };
}

// ---------- 打分用的渐进匹配 ----------
// 用「共同后缀/前缀有多长」而不是「相等/不等」。上下文被改掉几个字时
// 全等判断会直接归零，渐进匹配还能排出高下。
function commonSuffixLen(a, b) {
  let n = 0;
  const m = Math.min(a.length, b.length);
  while (n < m && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefixLen(a, b) {
  let n = 0;
  const m = Math.min(a.length, b.length);
  while (n < m && a[n] === b[n]) n++;
  return n;
}

// 两侧上下文各自的吻合度 0..1。
// 分开返回是必要的：文末高亮的 suffix 常常只有一个「。」，天然满分，
// 求平均会把一个完全对不上的 prefix 拉过及格线，于是静默锚错地方。
function ctxParts(text, h, sel) {
  const pfx = sel.prefix || '';
  const sfx = sel.suffix || '';
  const out = [];
  if (pfx) out.push(commonSuffixLen(pfx, text.slice(Math.max(0, h - pfx.length), h)) / pfx.length);
  if (sfx) {
    const tail = h + sel.exact.length;
    out.push(commonPrefixLen(sfx, text.slice(tail, tail + sfx.length)) / sfx.length);
  }
  return out;
}
// L1 用：两侧都得站得住，取较小值
function ctxMin(text, h, sel) {
  const p = ctxParts(text, h, sel);
  return p.length ? Math.min(...p) : 1;   // 没有上下文可比，只能信偏移
}
// L3 打分用：两侧平均，作为候选之间的相对比较
function ctxAvg(text, h, sel) {
  const p = ctxParts(text, h, sel);
  return p.length ? p.reduce((a, b) => a + b, 0) / p.length : 1;
}

function findAll(haystack, needle) {
  const hits = [];
  if (!needle) return hits;
  let i = haystack.indexOf(needle);
  while (i !== -1 && hits.length < MAX_HITS) {
    hits.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return hits;
}

function pick(text, hits, sel, level) {
  if (hits.length === 1) {
    return { start: hits[0], end: hits[0] + sel.exact.length, level: level || LEVEL.UNIQUE };
  }
  const span = Math.max(text.length, 1);
  const scored = hits.map((h) => {
    const c = ctxAvg(text, h, sel);
    // 上下文是主权重，位置只是次要权重 —— 页面重排时位置最先失效
    const dist = Math.abs(h - (sel.start == null ? h : sel.start)) / span;
    return { h, c, s: c * CTX_W - POS_W * dist };
  }).sort((a, b) => b.s - a.s);

  // ambiguous 的含义是「上下文没能区分开」，所以只看 c，不看 s。
  // 掺进位置权重会让两个上下文完全相同的候选因为离得远就不再被标记，
  // 而那恰恰是最该提醒的情况。
  const ambiguous = scored.length > 1 && Math.abs(scored[0].c - scored[1].c) < AMBIG_DELTA;
  return {
    start: scored[0].h,
    end: scored[0].h + sel.exact.length,
    level: level || LEVEL.DISAMBIG,
    ambiguous,
  };
}

// map 是单调递增的，二分把原文下标折算成归一化下标
function approxNorm(map, origIdx) {
  let lo = 0, hi = map.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (map[mid] <= origIdx) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * 把一个 selector 解析成 [start, end) 偏移。纯函数。
 * @param {string} text  当前页面的全文（由 buildTextIndex 拼出）
 * @param {{exact:string, prefix?:string, suffix?:string, start?:number, end?:number}} sel
 * @param {{normalized?:{norm:string,map:number[]}}} [cache] 归一化结果，批量解析时复用
 */
export function resolve(text, sel, cache) {
  if (!sel || !sel.exact) return { level: LEVEL.ORPHAN };

  // 1) 原偏移直接命中。
  // 🔴 光「同一偏移处字符串相同」不够 —— 页面重排后等长的重复段落
  // （「展开全文」「点赞」、导航项）会在同一偏移撞出同样的文字，
  // 于是静默锚到别的段落上。错位比丢失更伤信任，所以这里必须再验上下文。
  if (typeof sel.start === 'number' &&
      text.slice(sel.start, sel.start + sel.exact.length) === sel.exact &&
      ctxMin(text, sel.start, sel) >= L1_CTX_MIN) {
    return { start: sel.start, end: sel.start + sel.exact.length, level: LEVEL.POSITION };
  }

  // 2/3) 原文全文搜
  const hits = findAll(text, sel.exact);
  if (hits.length) return pick(text, hits, sel);

  // 4) 退到空白归一化后再搜一次。站点重排版是最常见的失配原因。
  const n = (cache && cache.normalized) || normalize(text);
  if (cache && !cache.normalized) cache.normalized = n;
  const nExact = normalize(sel.exact).norm;
  const nHits = findAll(n.norm, nExact);
  if (!nHits.length) return { level: LEVEL.ORPHAN };

  const nSel = {
    exact: nExact,
    prefix: normalize(sel.prefix || '').norm,
    suffix: normalize(sel.suffix || '').norm,
    // 把原偏移也折算到归一化坐标，否则位置权重会乱指
    start: typeof sel.start === 'number' ? approxNorm(n.map, sel.start) : undefined,
  };
  const r = pick(n.norm, nHits, nSel, nHits.length === 1 ? LEVEL.UNIQUE : LEVEL.DISAMBIG);
  const start = n.map[r.start];
  const lastIdx = Math.min(r.end - 1, n.map.length - 1);
  const end = n.map[lastIdx] + 1;
  return { start, end, level: r.level, ambiguous: r.ambiguous, viaNormalized: true };
}

/** 从一段文本和一个区间造出 selector（存进 storage 的就是它） */
export function makeSelector(text, start, end) {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CTX), start),
    suffix: text.slice(end, end + CTX),
    start,
    end,
  };
}
