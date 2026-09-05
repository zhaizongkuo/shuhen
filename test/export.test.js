import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, toPlainText, safeFilename } from '../src/core/export.js';
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
  assert.ok(md.includes('原文已找不到'));
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
