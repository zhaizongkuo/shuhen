// 存储格式。一旦线上有了用户数据，改这里就等于动所有人的高亮，
// 所以从第一版就带版本号和迁移函数 —— 不是过度设计，是不可逆成本。
//
// 两条硬约束：
//   1. 迁移不许丢字段。遇到不认识的键一律原样保留（用户可能装过更新的版本，
//      降级回来时数据不能被这一版洗掉）。
//   2. orphaned 只是一个标记，永远不删条目。差评里最狠的一条就是「高亮消失了」。

// v2：kind 改为可取 'mixed'，并新增 parts。
// kind / parts 都是**派生数据** —— 从页面 DOM 算得出来，所以迁移时可以放心丢掉，
// 下次重锚会重算。真正不可再生的只有 exact / prefix / suffix / note，那些永不触碰。
export const SCHEMA_VERSION = 2;

// 颜色是数据不是样式：存的是名字，渲染时才映射成具体色值，
// 这样以后换配色/加深色模式不用迁移历史数据。
export const COLORS = ['yellow', 'green', 'blue', 'pink'];
export const DEFAULT_COLOR = 'yellow';

export function newDoc(url, title) {
  const now = Date.now();
  return { v: SCHEMA_VERSION, url: url || '', title: title || '', created: now, updated: now, items: [] };
}

// 用时间戳 + 随机后缀。不用自增：同一页可能在两个标签页里同时被编辑，
// 自增 id 会撞车，撞车的后果是删 A 高亮时把 B 删掉。
export function newId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function newItem(selector, color, display, kind) {
  const it = {
    id: newId(),
    exact: selector.exact,
    prefix: selector.prefix,
    suffix: selector.suffix,
    start: selector.start,
    end: selector.end,
    color: COLORS.includes(color) ? color : DEFAULT_COLOR,
    note: '',
    created: Date.now(),
    orphaned: false,
  };
  // display 只在与 exact 不同时才存。
  //
  // 为什么要两份：锚定必须用 exact —— 它是文本节点原样拼接的形式，
  // 只有它才能在页面全文里搜到。而 selection.toString() 会在块元素之间
  // 插入换行，那串文字在索引里根本不存在，拿它去锚必然失败。
  // 但导出要给人看，跨段落的高亮不带换行就会连成一行 ——
  // 而导出是获客物料，不能糊。所以显示用 display，锚定用 exact。
  if (display && display !== selector.exact) it.display = display;
  if (kind) it.kind = kind;          // 'code' 之类，导出时决定用围栏还是引用块
  return it;
}

/**
 * 读出来的任何东西都要过这里。storage 里可能是：旧版本、被别的版本写过的、
 * 半截损坏的、或者根本不是对象。任何一种都不该让扩展崩掉或清空用户数据。
 */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;

  const v = typeof raw.v === 'number' ? raw.v : 0;

  // 来自更新版本的数据：原样返回，不改不洗。降级用户的数据必须活着。
  if (v > SCHEMA_VERSION) return raw;

  const doc = { ...raw, v: SCHEMA_VERSION };

  // 先把垃圾条目筛掉，再做迁移。
  // 顺序反过来的话，每加一版迁移都得自己防 null / 防缺字段 —— 迟早漏一处。
  // 连 exact 都没有的条目永远锚不上，留着只会一直报失败。
  doc.items = raw.items.filter((it) => it && typeof it.exact === 'string' && it.exact.length > 0);

  if (v < 1) {
    // v0 是验证 demo 的格式：一个裸的 selector 数组，没有 id/颜色/笔记
    doc.items = doc.items.map((it) => ({
      ...it,
      id: it.id || newId(),
      color: COLORS.includes(it.color) ? it.color : DEFAULT_COLOR,
      note: typeof it.note === 'string' ? it.note : '',
      created: it.created || it.at || Date.now(),
      orphaned: !!it.orphaned,
    }));
  }

  if (v < 2) {
    // v1 的 kind 只会是 'code' 或缺失，判不出「一半散文一半代码」这种。
    // 直接丢掉让它重算 —— 派生数据丢了没关系，重锚一次就回来。
    // 但锚不上的条目留着旧值：它没有 range，重算不出来，丢了就真没了。
    doc.items = doc.items.map((it) => {
      if (it.orphaned) return it;
      const next = { ...it };
      delete next.kind;
      delete next.parts;
      return next;
    });
  }

  return doc;
}

/** 导出用的扁平视图，按在页面里出现的先后排序 */
export function toExportRows(doc) {
  return doc.items
    .slice()
    .sort((a, b) => (a.start || 0) - (b.start || 0))
    .map((it) => ({
      text: it.display || it.exact,   // 导出给人看，用带段落换行的那份
      note: it.note || '',
      color: it.color,
      kind: it.kind || 'text',
      parts: it.parts || null,       // kind==='mixed' 时才有：散文段和代码段交替
      created: it.created,
      orphaned: !!it.orphaned,
    }));
}
