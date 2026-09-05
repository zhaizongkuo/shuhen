// DOM 换算层。锚定算法在 anchor.js（纯字符串），这里只管「DOM ↔ 字符偏移」。
// 分开的理由：算法要能单测，DOM 这部分只能靠实机验证，两者的可测性不同。

// 我们自己插进页面的节点都带这个属性，索引和 MutationObserver 都要绕开它，
// 否则：画 UI → 触发观察器 → 重锚 → 再画 UI → 死循环。
export const UI_ATTR = 'data-pf-ui';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TEMPLATE']);

/**
 * 把整页可见文本拼成一个字符串，并记录每个文本节点占哪一段。
 * ⚠️ 不过滤纯空白节点。过滤会让 "foo" + " " + "bar" 拼成 "foobar"，
 *    与用户实际选中的文本对不上，制造出假的锚定失败。
 */
export function buildTextIndex(root) {
  const start = root || document.body;
  if (!start) return { text: '', map: [], nodeStart: new Map() };

  const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
      if (p.closest('[' + UI_ATTR + ']')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const parts = [];
  const map = [];
  const nodeStart = new Map();
  let len = 0;
  let n;
  while ((n = walker.nextNode())) {
    const v = n.nodeValue;
    map.push({ node: n, start: len, end: len + v.length });
    nodeStart.set(n, len);
    parts.push(v);
    len += v.length;
  }
  return { text: parts.join(''), map, nodeStart };
}

/** 偏移 → 文本节点内位置。map 按 start 递增，二分。 */
export function locate(map, offset) {
  let lo = 0;
  let hi = map.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offset < map[mid].start) hi = mid - 1;
    else if (offset >= map[mid].end) lo = mid + 1;
    else return { node: map[mid].node, offset: offset - map[mid].start };
  }
  const last = map[map.length - 1];
  return last ? { node: last.node, offset: last.node.nodeValue.length } : null;
}

/** [start, end) → Range，可跨多个文本节点 */
export function makeRange(idx, start, end) {
  if (!(end > start)) return null;
  const a = locate(idx.map, start);
  const b = locate(idx.map, end - 1);
  if (!a || !b) return null;
  try {
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, Math.min(b.offset + 1, b.node.nodeValue.length));
    return r;
  } catch {
    return null;
  }
}

// 选区端点可能落在**元素节点**上（正好停在元素边界），它不在 nodeStart 里。
// 直接判失败会把「本来能锚的」误报成锚定失败 —— 这是 demo 阶段踩过的坑。
function pointToOffset(idx, container, offset, isEnd) {
  if (container.nodeType === Node.TEXT_NODE) {
    const base = idx.nodeStart.get(container);
    return base === undefined ? -1 : base + offset;
  }
  const kids = container.childNodes;
  const probe = isEnd ? kids[offset - 1] : kids[offset];
  const walk = (node, last) => {
    if (!node) return -1;
    if (node.nodeType === Node.TEXT_NODE) {
      const b = idx.nodeStart.get(node);
      return b === undefined ? -1 : (last ? b + node.nodeValue.length : b);
    }
    const list = node.childNodes;
    for (let i = 0; i < list.length; i++) {
      const k = walk(list[last ? list.length - 1 - i : i], last);
      if (k !== -1) return k;
    }
    return -1;
  };
  return walk(probe, isEnd);
}

/**
 * 当前选区 → 字符区间。落在 iframe / shadow DOM 里会返回 null（已知边界）。
 */
export function selectionOffsets(idx, sel) {
  const s = sel || window.getSelection();
  if (!s || s.isCollapsed || s.rangeCount === 0) return null;
  const r = s.getRangeAt(0);
  const start = pointToOffset(idx, r.startContainer, r.startOffset, false);
  const end = pointToOffset(idx, r.endContainer, r.endOffset, true);
  if (start === -1 || end === -1 || end <= start) return null;
  return { start, end };
}
