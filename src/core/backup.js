// 完整备份与恢复。
//
// 为什么是 JSON 而不是「粘贴 Markdown 导入」：
// 需要导入的三个场景里，有两个要求**无损** —— 换电脑 / 重装浏览器，
// 以及从测试版搬到商店版（那是另一个扩展 ID，storage 完全隔离）。
// 而 Markdown 是有损的：导出时 prefix / suffix / start / end 这些锚定信息
// 根本不在文件里，id、color、orphaned 也不在。
// 从 Markdown 反解回来的高亮锚不上任何页面，只剩一堆文字 ——
// 对一个卖点是「痕迹不会丢」的产品，这种迁移等于没迁。
//
// 纯函数，不碰 chrome.* 也不碰 DOM，所以能被 node --test 直接测。

import { migrate } from './schema.js';

// 备份文件自己的格式版本，和 SCHEMA_VERSION 是两回事：
// 前者管「文件外层长什么样」，后者管「每条高亮长什么样」。
// 分开是因为它们会各自演进 —— 加个字段到外层，不该逼所有 doc 迁移一遍。
export const BACKUP_VERSION = 1;
export const BACKUP_APP = 'shuhen';

// storage 里高亮数据的键前缀，和 pagekey.js 的 storageKey() 必须一致。
const PREFIX = 'pg:';

/**
 * 解析一份备份文件。
 *
 * 绝不抛异常 —— 用户选中的可能是任意一个文件（选错了、传输截断了、
 * 被别的程序改过），那种时候要给一句能看懂的话，而不是让页面白屏。
 *
 * @param {string} text 文件内容
 * @returns {{ok:true, entries:{key:string,doc:object}[], skippedPages:number}
 *          |{ok:false, error:string}}
 */
export function parseBackup(text) {
  let raw;
  try {
    // 先剥掉 BOM。Windows 中文环境下这是常态而不是边角情况：
    // 用记事本打开备份看一眼再保存就会多出 BOM，某些同步盘转存也会加。
    // JSON.parse 遇到 BOM 直接抛 Unexpected token，用户看到的是
    // 「这个文件不是合法的 JSON」—— 于是以为备份坏了，把唯一那份删掉。
    raw = JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
  } catch {
    return { ok: false, error: '这个文件不是合法的 JSON，可能选错了文件。' };
  }

  // 数组也要挡掉：JSON.parse('[]') 是 object，typeof 判断放它过去。
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.pages)) {
    return { ok: false, error: '这不像书痕导出的备份文件（缺少 pages 列表）。' };
  }

  const entries = [];
  let skippedPages = 0;

  for (const p of raw.pages) {
    // 🔴 key 必须以 pg: 开头。
    // 导入就是往 chrome.storage.local 写东西，如果放任 key 是任意字符串，
    // 一份构造过的备份文件就能覆盖 pf:locate 这类内部键，
    // 或者塞进一堆扩展根本不认识的键（用户还删不掉）。
    // 这是导入这条路上唯一的写入口，边界只能设在这里。
    if (!p || typeof p !== 'object' || typeof p.key !== 'string' || !p.key.startsWith(PREFIX)) {
      skippedPages++;
      continue;
    }

    // 过一遍 migrate：备份可能是旧版本导出的，也可能被手改坏了。
    // 复用同一套迁移逻辑，而不是在这里另写一份校验 ——
    // 两份校验迟早会不一致，而不一致的那天没有任何东西会提醒你。
    const doc = migrate(p.doc);
    if (!doc || !doc.items.length) {
      skippedPages++;
      continue;
    }

    entries.push({ key: p.key, doc });
  }

  // 一个坏条目不该让整份备份失败。用户的备份可能是三个月前的，
  // 里面有一页坏了就全部拒绝，等于因为一条丢掉全部 —— 那正是要避免的事。
  return { ok: true, entries, skippedPages };
}

/**
 * 把一份备份合并进现有数据。
 *
 * 合并策略只有一条原则：**导入只增不改**。
 * 这是个卖点为「痕迹不会丢」的产品，如果「恢复备份」这个动作本身
 * 会盖掉用户当前的笔记和颜色，那就是在最需要可信的地方自拆台。
 * 所以同 id 一律保留现有那条，哪怕备份里那条看起来更「完整」。
 *
 * 不做覆盖式整页替换，也是因为多标签页：另一个标签页可能正在划词，
 * 整页写回会把它刚存的那条冲掉（这个坑在 v1 开发时已经踩过一次）。
 *
 * @param {Record<string, object>} existing storage 里现有的全部 pg: 数据
 * @param {{key:string, doc:object}[]} entries parseBackup 的产物
 * @returns {{merged:Record<string,object>, addedPages:number,
 *            addedItems:number, skippedItems:number}}
 *          merged 只包含**真正需要写回去**的页 —— 没有新东西的页不写，
 *          免得每次导入都在 storage 上白写一遍、还触发别的标签页刷新。
 */
export function mergeBackup(existing, entries) {
  const merged = {};
  let addedPages = 0;
  let addedItems = 0;
  let skippedItems = 0;

  for (const e of entries) {
    const cur = existing[e.key];

    // 这一页本机还没有 —— 整页收下
    if (!cur || !Array.isArray(cur.items)) {
      merged[e.key] = e.doc;
      addedPages++;
      addedItems += e.doc.items.length;
      continue;
    }

    const have = new Set(cur.items.map((it) => it.id));
    const incoming = e.doc.items.filter((it) => !have.has(it.id));
    skippedItems += e.doc.items.length - incoming.length;
    if (!incoming.length) continue;

    // 展开成新对象而不是就地 push：传进来的 existing 是调用方刚从
    // storage 读出来的那份，改坏了它，导入一旦中途失败就没有干净的原状可回。
    merged[e.key] = {
      ...cur,
      items: cur.items.concat(incoming),
      updated: Math.max(cur.updated || 0, e.doc.updated || 0),
    };
    addedItems += incoming.length;
  }

  return { merged, addedPages, addedItems, skippedItems };
}

/**
 * 打包成备份对象（调用方负责 JSON.stringify 和落盘）。
 *
 * 存的是 storage 里的原样 doc，不做任何裁剪 —— 备份的价值全在「一字不差」，
 * 任何「这个字段看起来没用就不存了」的优化，都会在某次恢复时变成永久损失。
 *
 * @param {{key:string, doc:object}[]} entries
 */
export function toBackup(entries) {
  return {
    // app / v 让文件自己说明身份：用户三个月后在下载目录里翻到它，
    // 或者把别的工具的 json 选错了，都要能立刻判断出来。
    app: BACKUP_APP,
    v: BACKUP_VERSION,
    exported: Date.now(),
    pages: entries.map((e) => ({ key: e.key, doc: e.doc })),
  };
}
