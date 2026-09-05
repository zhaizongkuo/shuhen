import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, newDoc, newItem, newId, toExportRows,
         SCHEMA_VERSION, DEFAULT_COLOR } from '../src/core/schema.js';

test('垃圾输入不会崩，也不会被当成空文档写回去', () => {
  for (const bad of [null, undefined, 0, 'x', [], {}, { items: 'no' }])
    assert.equal(migrate(bad), null, JSON.stringify(bad));
});

test('v0（验证 demo 的裸 selector 数组）能升上来', () => {
  const old = { items: [{ exact: 'abc', prefix: 'p', suffix: 's', start: 1, end: 4, at: 111 }] };
  const doc = migrate(old);
  assert.equal(doc.v, SCHEMA_VERSION);
  assert.equal(doc.items[0].color, DEFAULT_COLOR);
  assert.equal(doc.items[0].created, 111);
  assert.ok(doc.items[0].id);
});

test('🔴 来自更高版本的数据原样保留 —— 降级不许洗掉用户的高亮', () => {
  const future = { v: 99, items: [{ exact: 'a', 未来字段: 1 }], 新东西: true };
  const doc = migrate(future);
  assert.equal(doc.v, 99);
  assert.equal(doc.新东西, true);
  assert.equal(doc.items[0].未来字段, 1);
});

test('同版本数据里不认识的字段不许丢', () => {
  const doc = migrate({ v: 1, items: [{ exact: 'a', 标签: ['x'] }], 备注: 'keep' });
  assert.equal(doc.备注, 'keep');
  assert.deepEqual(doc.items[0].标签, ['x']);
});

test('没有 exact 的条目清掉 —— 它永远锚不上，留着只会一直报失败', () => {
  const doc = migrate({ v: 1, items: [{ exact: 'a' }, { exact: '' }, {}, null] });
  assert.equal(doc.items.length, 1);
});

test('id 不会撞车（两个标签页同时写同一页时会撞）', () => {
  const ids = new Set();
  for (let i = 0; i < 20000; i++) ids.add(newId());
  assert.equal(ids.size, 20000);
});

test('非法颜色回落到默认色，而不是把 CSS 写坏', () => {
  assert.equal(newItem({ exact: 'a' }, 'octarine').color, DEFAULT_COLOR);
  assert.equal(newItem({ exact: 'a' }, 'green').color, 'green');
});

test('导出按页面出现顺序排，不按创建时间', () => {
  const doc = newDoc('https://a.com', 'T');
  doc.items = [
    { ...newItem({ exact: '后面的' }), start: 500 },
    { ...newItem({ exact: '前面的' }), start: 10 },
  ];
  assert.deepEqual(toExportRows(doc).map((r) => r.text), ['前面的', '后面的']);
});
