import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup, mergeBackup, toBackup, BACKUP_APP, BACKUP_VERSION } from '../src/core/backup.js';

test('不是 JSON 时返回错误，而不是抛异常', () => {
  const r = parseBackup('这不是 json{{{');
  assert.equal(r.ok, false);
  assert.ok(r.error, '要给出可以显示给用户的原因');
});

test('是合法 JSON 但不是本产品的备份时，认出来并拒绝', () => {
  for (const text of ['null', '123', '"str"', '[]', '{}', '{"pages":"no"}']) {
    const r = parseBackup(text);
    assert.equal(r.ok, false, text);
  }
});

test('🔴 key 不以 pg: 开头的条目一律丢弃 —— 否则备份文件能覆盖内部键', () => {
  // pf:locate 是总览页跳转用的内部键。如果导入能写任意 key，
  // 一个构造过的备份文件就能改写它，甚至塞进扩展根本不认识的键。
  const text = JSON.stringify({
    app: 'shuhen', v: 1, pages: [
      { key: 'pg:a.com/x', doc: { v: 2, items: [{ exact: '正常' }] } },
      { key: 'pf:locate', doc: { v: 2, items: [{ exact: '坏的' }] } },
      { key: 'anything', doc: { v: 2, items: [{ exact: '也是坏的' }] } },
    ],
  });
  const r = parseBackup(text);
  assert.equal(r.ok, true);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].key, 'pg:a.com/x');
});

test('单个坏条目不该让整份备份失败 —— 能救多少救多少', () => {
  const text = JSON.stringify({
    app: 'shuhen', v: 1, pages: [
      { key: 'pg:a.com/x', doc: { v: 2, items: [{ exact: '好的' }] } },
      { key: 'pg:b.com/y', doc: null },
      null,
      { key: 'pg:c.com/z', doc: { v: 2, items: [] } },
    ],
  });
  const r = parseBackup(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.entries.map((e) => e.key), ['pg:a.com/x']);
  assert.equal(r.skippedPages, 3, '丢掉的要如实报数，不能悄悄少');
});

test('导入的 doc 过一遍 migrate —— 旧版本导出的备份也要能进来', () => {
  // v0 是验证 demo 的裸格式：没有 id / color / note
  const text = JSON.stringify({
    app: 'shuhen', v: 1, pages: [
      { key: 'pg:a.com/x', doc: { items: [{ exact: 'abc', prefix: 'p', suffix: 's' }] } },
    ],
  });
  const r = parseBackup(text);
  assert.equal(r.ok, true);
  const it = r.entries[0].doc.items[0];
  assert.ok(it.id, 'migrate 应该补上 id');
  assert.equal(it.color, 'yellow');
  assert.equal(it.exact, 'abc');
});

// ---- 合并 ----------------------------------------------------------------

const doc = (items, extra) => ({ v: 2, url: 'https://a.com/x', title: 'T', items, ...(extra || {}) });
const item = (id, exact, extra) => ({ id, exact, color: 'yellow', note: '', created: 1, orphaned: false, ...(extra || {}) });

test('全新的页整页加入', () => {
  const r = mergeBackup({}, [{ key: 'pg:a.com/x', doc: doc([item('i1', '甲')]) }]);
  assert.deepEqual(Object.keys(r.merged), ['pg:a.com/x']);
  assert.equal(r.addedPages, 1);
  assert.equal(r.addedItems, 1);
});

test('已存在的页：新条目追加进去', () => {
  const existing = { 'pg:a.com/x': doc([item('i1', '甲')]) };
  const r = mergeBackup(existing, [{ key: 'pg:a.com/x', doc: doc([item('i2', '乙')]) }]);
  assert.deepEqual(r.merged['pg:a.com/x'].items.map((i) => i.exact), ['甲', '乙']);
  assert.equal(r.addedPages, 0);
  assert.equal(r.addedItems, 1);
});

test('🔴 同 id 的条目保留现有的 —— 导入永远不覆盖用户当前的数据', () => {
  // 用户在这台机器上给 i1 加过笔记、改过颜色。备份是三个月前的，
  // 里面 i1 还是原样，另外还多一条 i2。
  // 正确结果：i2 进来，i1 保持用户改过的样子 —— 笔记不许被备份抹掉。
  const existing = { 'pg:a.com/x': doc([item('i1', '甲', { note: '我后来加的笔记', color: 'green' })]) };
  const r = mergeBackup(existing, [{
    key: 'pg:a.com/x',
    doc: doc([item('i1', '甲', { note: '', color: 'yellow' }), item('i2', '乙')]),
  }]);
  const items = r.merged['pg:a.com/x'].items;
  assert.equal(items.length, 2);
  const i1 = items.find((i) => i.id === 'i1');
  assert.equal(i1.note, '我后来加的笔记');
  assert.equal(i1.color, 'green');
  assert.equal(r.addedItems, 1);
  assert.equal(r.skippedItems, 1);
});

test('🔴 合并不修改传进来的对象 —— 失败时现有数据必须原样还在', () => {
  const existing = { 'pg:a.com/x': doc([item('i1', '甲')]) };
  const snapshot = JSON.stringify(existing);
  mergeBackup(existing, [{ key: 'pg:a.com/x', doc: doc([item('i2', '乙')]) }]);
  assert.equal(JSON.stringify(existing), snapshot);
});

test('只包含已有条目的导入，不产生任何写入', () => {
  const existing = { 'pg:a.com/x': doc([item('i1', '甲')]) };
  const r = mergeBackup(existing, [{ key: 'pg:a.com/x', doc: doc([item('i1', '甲')]) }]);
  assert.equal(Object.keys(r.merged).length, 0, 'merged 只放真正需要写回去的页');
  assert.equal(r.addedItems, 0);
});

test('导入让页面的 updated 前进，但不倒退', () => {
  const existing = { 'pg:a.com/x': doc([item('i1', '甲')], { updated: 5000 }) };
  const older = mergeBackup(existing, [{ key: 'pg:a.com/x', doc: doc([item('i2', '乙')], { updated: 100 }) }]);
  assert.equal(older.merged['pg:a.com/x'].updated, 5000);
});

// ---- 导出 + 往返 ---------------------------------------------------------

test('备份文件带产品标识和格式版本 —— 将来才认得出这是谁的、哪一版', () => {
  const b = toBackup([{ key: 'pg:a.com/x', doc: doc([item('i1', '甲')]) }]);
  assert.equal(b.app, BACKUP_APP);
  assert.equal(b.v, BACKUP_VERSION);
  assert.equal(b.pages.length, 1);
  assert.ok(b.exported, '带导出时间，用户才分得清哪份备份新');
});

test('没有任何高亮时也能导出一份空备份，不报错', () => {
  const b = toBackup([]);
  assert.deepEqual(b.pages, []);
});

test('🔴 往返无损：锚定信息一个字段都不能少', () => {
  // 这条是整个「用 JSON 而不是 Markdown」的理由所在。
  // prefix / suffix / start / end 少任何一个，恢复出来的高亮就锚不回原文，
  // 而这正是导出成 Markdown 再导入会发生的事。
  const full = {
    v: 2, url: 'https://a.com/x?q=1', title: '带"引号"的标题',
    created: 1000, updated: 2000,
    items: [{
      id: 'i1', exact: '被划的原文', prefix: '前文', suffix: '后文',
      start: 42, end: 47, color: 'blue', note: '我的笔记',
      created: 1500, orphaned: false, display: '被划的\n原文', kind: 'code',
    }],
  };
  const text = JSON.stringify(toBackup([{ key: 'pg:a.com/x', doc: full }]));
  const r = parseBackup(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.entries[0].doc, full);
});

test('🔴 orphaned 的条目也要能往返 —— 锚不上不等于可以丢', () => {
  const d = {
    v: 2, url: 'https://a.com/x', title: 'T', created: 1, updated: 2,
    items: [{ id: 'i1', exact: '原文没了', prefix: '', suffix: '', start: 0, end: 4,
              color: 'pink', note: '', created: 1, orphaned: true }],
  };
  const r = parseBackup(JSON.stringify(toBackup([{ key: 'pg:a.com/x', doc: d }])));
  assert.equal(r.entries[0].doc.items[0].orphaned, true);
});

test('🔴 带 BOM 的文件要能读 —— Windows 中文环境下这是常态，不是边角', () => {
  // 用户用记事本打开备份看过一眼再保存，就会多出 BOM；
  // 从别的工具转存、经过某些同步盘也会带上。
  // JSON.parse 遇到 BOM 直接抛，报错是「Unexpected token」——
  // 用户看到的会是「这个文件不是合法的 JSON」，于是以为备份坏了，把它删掉。
  const body = JSON.stringify({
    app: 'shuhen', v: 1,
    pages: [{ key: 'pg:a.com/x', doc: { v: 2, items: [{ exact: '甲' }] } }],
  });
  const r = parseBackup('﻿' + body);
  assert.equal(r.ok, true, '带 BOM 的备份必须能恢复');
  assert.equal(r.entries.length, 1);
});

test('🔴 导出→导入回同一台机器，不产生任何重复', () => {
  // 用户误点两次导入，或者导出后又导入回来，都不该让高亮变成两条。
  const existing = { 'pg:a.com/x': doc([item('i1', '甲'), item('i2', '乙')]) };
  const entries = [{ key: 'pg:a.com/x', doc: existing['pg:a.com/x'] }];
  const r = mergeBackup(existing, parseBackup(JSON.stringify(toBackup(entries))).entries);
  assert.equal(r.addedItems, 0);
  assert.equal(r.skippedItems, 2);
  assert.deepEqual(Object.keys(r.merged), []);
});
