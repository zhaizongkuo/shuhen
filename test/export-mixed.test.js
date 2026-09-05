import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown } from '../src/core/export.js';
import { newDoc, newItem, migrate, SCHEMA_VERSION } from '../src/core/schema.js';

function mixedDoc() {
  const d = newDoc('https://a.com/p', '标题');
  const it = newItem({ exact: 'x', prefix: '', suffix: '', start: 0, end: 1 }, 'yellow');
  it.kind = 'mixed';
  it.parts = [
    { kind: 'text', text: '动逻辑示例 typescript' },
    { kind: 'code', text: '[\n  {\n    type: "select",\n    field: "country"\n  }\n]' },
  ];
  d.items = [it];
  return d;
}

test('🔴 混合选区按段拆：散文走引用块，代码走围栏', () => {
  const md = toMarkdown(mixedDoc());
  assert.ok(md.includes('> 动逻辑示例 typescript'), '散文段应是引用块:\n' + md);
  assert.ok(md.includes('```\n[\n  {'), '代码段应是围栏:\n' + md);
  assert.ok(!md.includes('> [\n'), '代码不该被加 "> "');
  assert.ok(!md.includes('```\n动逻辑'), '中文不该被塞进代码块');
});

test('🔴 缩进 ≥4 空格的代码行绝不能留在引用块里（会被当成缩进代码块）', () => {
  const md = toMarkdown(mixedDoc());
  for (const line of md.split('\n')) {
    if (line.startsWith('> ') && /^>\s{4,}\S/.test(line)) {
      assert.fail('引用块里出现了 4 空格缩进行，渲染结果将不受控：' + JSON.stringify(line));
    }
  }
});

test('混合条目不会多出或少掉空行', () => {
  const md = toMarkdown(mixedDoc());
  assert.ok(!/\n{3,}/.test(md), '不该出现三连空行:\n' + JSON.stringify(md));
});

test('v1 -> v2 迁移丢掉派生字段让它重算，但不动锚不上的条目', () => {
  const raw = {
    v: 1,
    items: [
      { exact: 'a', kind: 'code', parts: [{ kind: 'code', text: 'a' }], orphaned: false },
      { exact: 'b', kind: 'code', orphaned: true },
    ],
  };
  const doc = migrate(raw);
  assert.equal(doc.v, SCHEMA_VERSION);
  assert.equal(doc.items[0].kind, undefined, '可重锚的条目应清掉派生字段');
  assert.equal(doc.items[0].parts, undefined);
  assert.equal(doc.items[1].kind, 'code', '锚不上的条目没有 range 可重算，旧值必须留着');
});

test('迁移不许碰不可再生的字段', () => {
  const doc = migrate({ v: 1, items: [{ exact: 'a', prefix: 'p', suffix: 's', note: '我的想法' }] });
  assert.equal(doc.items[0].exact, 'a');
  assert.equal(doc.items[0].prefix, 'p');
  assert.equal(doc.items[0].suffix, 's');
  assert.equal(doc.items[0].note, '我的想法');
});

test('🔴 行首的 # 要转义，否则用户划的一句话会跑进文档大纲', () => {
  const d = newDoc('https://a.com/p', 'T');
  d.items = [newItem({ exact: '# 这看起来像标题', prefix: '', suffix: '', start: 0, end: 8 })];
  const md = toMarkdown(d);
  assert.ok(md.includes('> \\# 这看起来像标题'), md);
});

test('列表不转义 —— 渲染成列表通常正是想要的', () => {
  const d = newDoc('https://a.com/p', 'T');
  d.items = [newItem({ exact: '- 第一条\n- 第二条', prefix: '', suffix: '', start: 0, end: 9 })];
  const md = toMarkdown(d);
  assert.ok(md.includes('> - 第一条'), md);
  assert.ok(!md.includes('\\-'));
});
