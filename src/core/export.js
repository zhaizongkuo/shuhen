// 导出。这不是附加功能，是获客入口 —— 人们不搜「网页高亮插件」，
// 他们搜「怎么把划线导进 Obsidian」。所以格式要按 Obsidian 的习惯来，
// 而不是按我们自己方便。
//
// 纯函数，不碰 DOM 也不碰 chrome.*，因此格式逻辑能被 node --test 直接测。

import { toExportRows } from './schema.js';

function pad(n) { return n < 10 ? '0' + n : String(n); }

export function isoDate(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// YAML 双引号串里只有 \ 和 " 需要转义。标题里带引号的文章非常多
// （「他说"这不可能"」这种），不转义会让整个 frontmatter 解析失败，
// Obsidian 里表现为文件顶部出现一坨乱码。
function yamlString(s) {
  return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// 引用块要逐行加 "> "。高亮跨段落时文本里本来就有换行，
// 只在开头加一个 "> " 的话，第二行往后会掉出引用块，在 Obsidian 里看着像是断了。
function blockquote(text) {
  return String(text)
    .split('\n')
    // 行首的 # 要转义。引用块里的 "# xxx" 仍会被当成标题渲染，
    // 于是用户划的一句话跑进了文档大纲，把整个笔记的结构搞乱 ——
    // 这不是「显示得难看」，是改变了文档含义。
    // 只转义 # ：列表（- / 1.）渲染成列表通常正是想要的，不动。
    .map((line) => '> ' + line.trimEnd().replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3'))
    .join('\n');
}

// 代码围栏。内容里可能本来就有连续反引号（讲 Markdown 语法的文章里很常见），
// 围栏必须比内容中最长的那串更长，否则代码块会在中途被截断，
// 后面的正文全部变成代码 —— 而且不报错，只是文件看着乱。
function fence(text) {
  let longest = 0;
  for (const run of String(text).match(/`+/g) || []) longest = Math.max(longest, run.length);
  const bar = '`'.repeat(Math.max(3, longest + 1));
  return bar + '\n' + String(text).replace(/\s+$/, '') + '\n' + bar;
}

/**
 * @param {object} doc  storage 里的一页文档
 * @param {{frontmatter?:boolean, includeNotes?:boolean}} [opts]
 */
export function toMarkdown(doc, opts) {
  const o = opts || {};
  const withFm = o.frontmatter !== false;
  const withNotes = o.includeNotes !== false;
  const rows = toExportRows(doc);
  const title = doc.title || doc.url || '未命名';
  const out = [];

  if (withFm) {
    out.push('---');
    out.push('title: ' + yamlString(title));
    // source 不加引号会在含冒号的 URL 上被 YAML 当成 map 解析
    out.push('source: ' + yamlString(doc.url || ''));
    out.push('created: ' + isoDate(doc.created));
    out.push('highlights: ' + rows.length);
    out.push('---');
    out.push('');
  }

  // 有 frontmatter 时不再输出 H1 和「原文」链接：
  // Obsidian 把文件名当标题显示在最上方，属性区里也已经有可点的 source，
  // 再输出一遍就是同一句话出现两次。没有 frontmatter（比如贴进别的工具）时才需要。
  if (!withFm) {
    out.push('# ' + title);
    out.push('');
    if (doc.url) { out.push('[原文](' + doc.url + ')'); out.push(''); }
  }

  for (const r of rows) {
    // 代码用围栏而不是引用块。引用块会丢掉等宽字体和语法高亮，
    // 而技术文章里的高亮有相当一部分是代码。
    const isCode = r.kind === 'code';
    if (r.kind === 'mixed' && r.parts && r.parts.length) {
      // 一条高亮同时跨了散文和代码（实测占 21%，不是边角情况）。
      // 整条套引用块：代码丢等宽字体，而且缩进 ≥4 空格的行会被 Markdown
      // 当成「缩进代码块」，各家渲染器表现还不一样。
      // 整条套围栏：中文进代码块，不换行，更糟。
      // 所以按段拆开，各用各的形式。
      for (const seg of r.parts) {
        const t = seg.text.replace(/^\n+|\n+$/g, '');
        if (!t) continue;
        out.push(seg.kind === 'code' ? fence(t) : blockquote(t));
        out.push('');
      }
      out.pop();                       // 去掉最后多出的空行，下面统一补
    } else {
      out.push(isCode ? fence(r.text) : blockquote(r.text));
    }
    // 锚不上的条目照样导出 —— 文字本身还是用户要的东西。
    // 但要如实标出来，别让人以为原文还在那儿。
    // 代码围栏后面不能接 "> "，那会另起一个引用块，看着像多了一条高亮。
    if (r.orphaned) {
      if (isCode) out.push('*（原文已找不到，可能是站点改版）*');
      else { out.push('>'); out.push('> *（原文已找不到，可能是站点改版）*'); }
    }
    out.push('');
    if (withNotes && r.note) { out.push(r.note); out.push(''); }
  }

  // 结尾留一个换行，拼进别的笔记时不会和下一行黏住
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * 多页合并导出。每页一节，用 H2 分隔。
 * frontmatter 只在最外层出现一次 —— 一个文件里出现多份 frontmatter，
 * Obsidian 只认第一份，后面的会当正文渲染成一堆 "---"。
 */
export function toMarkdownAll(docs, opts) {
  const o = opts || {};
  const list = docs.filter((d) => d && d.items && d.items.length);
  const out = [];
  const total = list.reduce((n, d) => n + d.items.length, 0);

  if (o.frontmatter !== false) {
    out.push('---');
    out.push('title: ' + yamlString(o.title || '网页高亮汇总'));
    out.push('created: ' + isoDate(Date.now()));
    out.push('pages: ' + list.length);
    out.push('highlights: ' + total);
    out.push('---');
    out.push('');
  }

  for (const d of list) {
    out.push('## ' + (d.title || d.url || '未命名'));
    out.push('');
    if (d.url) { out.push('[原文](' + d.url + ')'); out.push(''); }
    // 每页正文不再带自己的 frontmatter 和标题，避免层级打架
    out.push(toMarkdown(d, { frontmatter: false, includeNotes: o.includeNotes })
      .replace(/^# .*\n+/, '')
      .replace(/^\[原文\]\([^)]*\)\n+/m, ''));
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** 纯文本：只要高亮原文，一行一条。给不用 Markdown 的人。 */
export function toPlainText(doc) {
  return toExportRows(doc)
    .map((r) => (r.note ? r.text + '\n  — ' + r.note : r.text))
    .join('\n\n') + '\n';
}

/** 文件名：去掉文件系统不允许的字符，并留出扩展名的余量 */
export function safeFilename(title, ext) {
  const base = String(title || 'highlights')
    .replace(/[\\/:*?"<>|]/g, ' ')     // Windows 禁用字符
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'highlights';
  return base + (ext || '.md');
}
