import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown } from '../src/core/export.js';
import { newDoc, newItem } from '../src/core/schema.js';

function docOf(items) {
  const d = newDoc('https://a.com/p', '标题');
  d.items = items.map((x, i) =>
    newItem({ exact: x.text, prefix: '', suffix: '', start: x.start ?? i, end: 0 },
            'yellow', x.display, x.kind));
  d.items.forEach((it, i) => { it.orphaned = !!items[i].orphaned; });
  return d;
}

test('代码高亮导成围栏，不是引用块', () => {
  const md = toMarkdown(docOf([{ text: "const a = 1;\nconst b = 2;", kind: 'code' }]));
  assert.ok(md.includes('```\nconst a = 1;\nconst b = 2;\n```'), md);
  assert.ok(!md.includes('> const a'), '代码不该被加 "> "');
});

test('普通文本仍走引用块', () => {
  const md = toMarkdown(docOf([{ text: '一段普通的话' }]));
  assert.ok(md.includes('> 一段普通的话'));
  assert.ok(!md.includes('```'));
});

test('🔴 内容里本来就有 ``` 时，围栏要更长，否则代码块中途被截断', () => {
  const body = '示例：\n```js\nfoo()\n```\n以上';
  const md = toMarkdown(docOf([{ text: body, kind: 'code' }]));
  assert.ok(md.includes('````\n' + body + '\n````'), md);
  // 真正的不变量：外层围栏要严格长于内容里出现过的任何一串反引号，
  // 否则代码块在中途就被闭合，后面的正文全部变成代码
  const outer = md.match(/^`+$/m)[0].length;
  const inner = Math.max(...(body.match(/`+/g) || ['']).map((r) => r.length));
  assert.ok(outer > inner, `外层围栏 ${outer} 必须长于内容里的 ${inner}`);
});

test('代码块失联时不接 "> "，否则会另起一个引用块看着像多一条高亮', () => {
  const md = toMarkdown(docOf([{ text: 'foo()', kind: 'code', orphaned: true }]));
  assert.ok(md.includes('原文已找不到'));
  assert.ok(!md.includes('> *（原文已找不到'), '代码后面不该出现引用块标记');
});

test('有 frontmatter 时不再重复输出 H1 和原文链接', () => {
  const md = toMarkdown(docOf([{ text: 'x' }]));
  assert.ok(md.startsWith('---'));
  assert.ok(!md.includes('# 标题'), 'Obsidian 已用文件名做标题，重复的 H1 是噪音');
  assert.ok(!md.includes('[原文]'), 'source 属性已经是可点链接');
  assert.ok(md.includes('source: "https://a.com/p"'));
});

test('关掉 frontmatter 时，H1 和原文链接要回来（贴进别的工具时需要）', () => {
  const md = toMarkdown(docOf([{ text: 'x' }]), { frontmatter: false });
  assert.ok(md.startsWith('# 标题'));
  assert.ok(md.includes('[原文](https://a.com/p)'));
});
