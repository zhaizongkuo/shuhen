import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, toPlainText, safeFilename, toMarkdownAll } from '../src/core/export.js';
import { newDoc, newItem } from '../src/core/schema.js';

function docOf(items, title, url) {
  const d = newDoc(url || 'https://a.com/p', title || '测试文章');
  d.items = items.map((x, i) => ({
    ...newItem({ exact: x.text, prefix: '', suffix: '', start: x.start ?? i, end: 0 }, x.color),
    note: x.note || '',
    orphaned: !!x.orphaned,
  }));
  return d;
}

test('🔴 标题里的引号必须转义，否则整个 frontmatter 解析失败', () => {
  const md = toMarkdown(docOf([{ text: 'a' }], '他说"这不可能"'));
  assert.ok(md.includes('title: "他说\\"这不可能\\""'));
  // 反斜杠也要转义
  const md2 = toMarkdown(docOf([{ text: 'a' }], 'C:\\path'));
  assert.ok(md2.includes('title: "C:\\\\path"'));
});

test('🔴 URL 必须加引号，否则含冒号的地址会被 YAML 当成 map', () => {
  const md = toMarkdown(docOf([{ text: 'a' }], 'T', 'https://a.com/x?y=1'));
  assert.ok(md.includes('source: "https://a.com/x?y=1"'));
});

test('🔴 跨段落的高亮，每一行都要有 "> "', () => {
  const md = toMarkdown(docOf([{ text: '第一行\n第二行\n第三行' }]));
  const lines = md.split('\n').filter((l) => l.includes('行'));
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => l.startsWith('> ')), '掉出引用块的行：' + JSON.stringify(lines));
});

test('笔记跟在高亮后面，没有笔记就不留空占位', () => {
  const md = toMarkdown(docOf([
    { text: '有笔记的', note: '我的想法', start: 1 },
    { text: '没笔记的', start: 2 },
  ]));
  assert.ok(md.indexOf('我的想法') > md.indexOf('有笔记的'));
  assert.ok(!/\n\n\n/.test(md), '不该出现三连空行');
});

test('锚不上的条目照样导出，但要如实标出来', () => {
  const md = toMarkdown(docOf([{ text: '找不到了', orphaned: true }]));
  assert.ok(md.includes('找不到了'));
  assert.ok(md.includes('original text not found'));
});

test('按页面出现顺序排，不按创建顺序', () => {
  const md = toMarkdown(docOf([
    { text: '后面的段落', start: 900 },
    { text: '前面的段落', start: 10 },
  ]));
  assert.ok(md.indexOf('前面的段落') < md.indexOf('后面的段落'));
});

test('可以关掉 frontmatter', () => {
  const md = toMarkdown(docOf([{ text: 'a' }]), { frontmatter: false });
  assert.ok(!md.startsWith('---'));
  assert.ok(md.startsWith('# '));
});

test('空文档不崩，也不产出半截 frontmatter', () => {
  const md = toMarkdown(docOf([]));
  assert.ok(md.includes('highlights: 0'));
  assert.equal((md.match(/^---$/gm) || []).length, 2);
});

test('纯文本导出：一条一段，笔记缩进跟随', () => {
  const txt = toPlainText(docOf([{ text: '第一条', note: '想法', start: 1 }]));
  assert.ok(txt.includes('第一条'));
  assert.ok(txt.includes('— 想法'));
});

test('文件名去掉 Windows 禁用字符', () => {
  assert.equal(safeFilename('a/b:c*d?e"f<g>h|i'), 'a b c d e f g h i.md');
  assert.equal(safeFilename(''), 'highlights.md');
  assert.ok(safeFilename('长'.repeat(200)).length <= 83);
});

test('🔴 跨段落的高亮，导出要用带换行的那份，否则两段黏成一行', () => {
  const d = newDoc('https://a.com/p', 'T');
  d.items = [{
    ...newItem({ exact: '第一段结尾第二段开头', prefix: '', suffix: '', start: 0, end: 10 },
               'yellow', '第一段结尾\n第二段开头'),
  }];
  // 存的时候两份都在：exact 供锚定，display 供人看
  assert.equal(d.items[0].exact, '第一段结尾第二段开头');
  assert.equal(d.items[0].display, '第一段结尾\n第二段开头');
  const md = toMarkdown(d);
  assert.ok(md.includes('> 第一段结尾\n> 第二段开头'), '导出应保留段落换行：\n' + md);
});

test('display 与 exact 相同时不重复存', () => {
  const it = newItem({ exact: 'abc', prefix: '', suffix: '', start: 0, end: 3 }, 'yellow', 'abc');
  assert.equal(it.display, undefined);
});

// ---- 文案注入 ------------------------------------------------------------
//
// export.js 是纯函数，调 chrome.i18n 就毁掉了「能被 node --test 直接测」，
// 而那是锚定算法能被测住的前提。所以文案由调用方注入，这里守住兜底行为。

const withUrl = (url) => ({
  v: 2, url, title: '', created: 1, updated: 1,
  items: [{ id: 'i1', exact: 'x', start: 0, end: 1, color: 'yellow',
            note: '', created: 1, orphaned: true }],
});

test('🔴 没传 labels 时兜底是英文，不是中文', () => {
  // 兜底取英文：调用方万一忘了传，英文用户看到英文、中文用户也看到英文 ——
  // 后者能看懂，反过来不成立。
  const md = toMarkdown(withUrl(''), { frontmatter: false });
  assert.ok(md.includes('# Untitled'), '标题兜底应是英文');
  assert.ok(md.includes('original text not found'), '失联标记应是英文');
});

test('没传 labels 时，原文链接的标签也是英文', () => {
  const md = toMarkdown(withUrl('https://a.com/p'), { frontmatter: false });
  assert.ok(md.includes('[Source](https://a.com/p)'));
});

test('labels 注入后覆盖默认值', () => {
  const md = toMarkdown(withUrl('https://a.com/p'), {
    frontmatter: false,
    labels: { untitled: '未命名', source: '原文', orphaned: '（原文已找不到）' },
  });
  assert.ok(md.includes('[原文](https://a.com/p)'));
  assert.ok(md.includes('（原文已找不到）'));
  assert.ok(!md.includes('[Source]'), '注入之后不该还留着英文默认值');
});

test('只注入一部分时，其余仍走默认值', () => {
  const md = toMarkdown(withUrl(''), { frontmatter: false, labels: { untitled: '未命名' } });
  assert.ok(md.includes('# 未命名'));
  assert.ok(md.includes('original text not found'), '没传的 orphaned 应保持英文默认');
});

test('🔴 多页合并时 labels 要传到每一页 —— 漏传会导出一份半中半英的文件', () => {
  const docs = [withUrl('https://a.com/p'), withUrl('https://b.com/q')];
  const md = toMarkdownAll(docs, {
    labels: { untitled: '未命名', source: '原文', orphaned: '（原文已找不到）', allTitle: '汇总' },
  });
  assert.ok(md.includes('title: "汇总"'));
  assert.ok(!md.includes('Source'), '每页正文里不该漏出英文默认值');
  assert.ok(!md.includes('original text not found'));
});

test('🔴 labels 里的 undefined 不许覆盖默认值', () => {
  // 调用方常常是 { untitled: s.expUntitled, ... } 这种形状，
  // 而 s 来自跨 world 传过来的对象 —— 少一个键就是 undefined。
  // 用 spread 合并的话 undefined 会盖掉默认值，导出文件里出现
  // 「# undefined」，且不报错。
  const doc = { v: 2, url: '', title: '', created: 1, updated: 1, items: [
    { id: 'i1', exact: 'x', start: 0, end: 1, color: 'yellow', note: '', created: 1, orphaned: true },
  ] };
  const md = toMarkdown(doc, { frontmatter: false, labels: { untitled: undefined, orphaned: '' } });
  assert.ok(!md.includes('undefined'), '不该把 undefined 写进文件');
  assert.ok(md.includes('# Untitled'), 'undefined 应回落到默认值');
  assert.ok(md.includes('original text not found'), '空字符串也应回落');
});
