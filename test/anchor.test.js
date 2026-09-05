import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, makeSelector, normalize, LEVEL,
         CTX_W, POS_W, AMBIG_DELTA } from '../src/core/anchor.js';

// 取回的文本必须和原文一致 —— 这是「有没有标错地方」的判定
const got = (text, r) => (r.level === LEVEL.ORPHAN ? null : text.slice(r.start, r.end));

test('L1：偏移没变，直接命中', () => {
  const t = '前面的话。这是要高亮的句子。后面的话。';
  const sel = makeSelector(t, 5, 14);
  const r = resolve(t, sel);
  assert.equal(r.level, LEVEL.POSITION);
  assert.equal(got(t, r), sel.exact);
});

test('L2：前面插了内容导致偏移变了，但全文唯一', () => {
  const t = '前面的话。这是要高亮的句子。后面的话。';
  const sel = makeSelector(t, 5, 14);
  const t2 = '广告横幅广告横幅广告横幅' + t;
  const r = resolve(t2, sel);
  assert.equal(r.level, LEVEL.UNIQUE);
  assert.equal(got(t2, r), sel.exact);
});

test('L3：同样的文字出现多次，靠前后缀选对那一个', () => {
  const t = 'A 段落：重复的句子。B 段落：重复的句子。C 段落：重复的句子。';
  const target = t.indexOf('重复的句子', t.indexOf('B 段落'));
  const sel = makeSelector(t, target, target + 5);
  // 顶部插了公告条，偏移全部后移；三段本身没动，上下文仍能区分
  const t2 = '【公告】本站升级维护。' + t;
  const r = resolve(t2, sel);
  assert.equal(r.level, LEVEL.DISAMBIG);
  assert.equal(t2.slice(r.start - 5, r.start), 'B 段落：');   // 选中的确实是 B 段那句
  assert.ok(!r.ambiguous);
});

test('等长重复块被调换顺序时，L1 不许硬信偏移', () => {
  // 这是真实场景：feed 里每张卡片都有「展开全文」，卡片顺序会变。
  // 同一偏移处字符串照样相同，只比字符串就会静默锚到别的卡片上。
  const t  = '项目一：展开全文。项目二：展开全文。';
  const target = t.indexOf('展开全文', t.indexOf('项目二'));
  const sel = makeSelector(t, target, target + 4);
  const t2 = '项目二：展开全文。项目一：展开全文。';
  const r = resolve(t2, sel);
  assert.notEqual(r.level, LEVEL.POSITION, 'L1 必须被上下文校验拦下');
  assert.equal(t2.slice(r.start - 4, r.start), '项目二：', '应锚到项目二那条');
});

test('L4：文字真的没了 —— 必须 orphan，不许硬凑一个位置', () => {
  const t = '前面的话。这是要高亮的句子。后面的话。';
  const sel = makeSelector(t, 5, 14);
  const r = resolve('完全不相干的另一篇文章内容。', sel);
  assert.equal(r.level, LEVEL.ORPHAN);
  assert.equal(r.start, undefined);
});

test('空白被站点重排版：归一化兜底，且偏移要落在原文坐标系', () => {
  const t = 'Intro. The quick   brown\n\n  fox jumps. Tail.';
  const s = t.indexOf('The quick');
  const sel = makeSelector(t, s, t.indexOf('jumps.') + 6);
  const t2 = 'Intro. The quick brown fox jumps. Tail.';       // 空白被压扁
  const r = resolve(t2, sel);
  assert.equal(r.viaNormalized, true);
  assert.equal(got(t2, r), 'The quick brown fox jumps.');      // 切出来必须是完整目标
});

test('上下文完全相同时标记 ambiguous，而不是假装很确定', () => {
  // 两处出现的前后 32 字完全一样 —— 没有任何信息能区分，必须如实标记
  const block = 'A'.repeat(32) + '目标' + 'B'.repeat(32);
  const t = block + block;
  const sel = makeSelector(t, 32, 34);
  const r = resolve('前言。' + t, sel);
  assert.equal(got('前言。' + t, r), '目标');
  assert.equal(r.ambiguous, true, '上下文无法区分时必须置位');
});

test('ambiguous 不受距离影响 —— 离得远不代表分得清', () => {
  const block = 'A'.repeat(32) + '目标' + 'B'.repeat(32);
  const t = block + 'C'.repeat(4000) + block;
  const sel = makeSelector(t, 32, 34);
  const r = resolve('前言。' + t, sel);
  assert.equal(r.ambiguous, true);
});

test('中文长文（无空格）不会被归一化搞坏', () => {
  const t = '人工智能的发展经历了三个阶段。第一个阶段是符号主义，第二个阶段是连接主义。';
  const s = t.indexOf('第一个阶段是符号主义');
  const sel = makeSelector(t, s, s + 10);
  const r = resolve('导语。' + t, sel);
  assert.equal(got('导语。' + t, r), '第一个阶段是符号主义');
});

test('大量重复命中不会爆掉（MAX_HITS 封顶）', () => {
  const t = '重复'.repeat(5000);
  const sel = makeSelector(t, 100, 104);
  const t0 = Date.now();
  const r = resolve(t, sel);
  assert.ok(Date.now() - t0 < 300, '解析耗时应远低于 300ms');
  assert.equal(got(t, r), '重复重复');
});

test('normalize 的 map 单调且能还原下标', () => {
  const t = 'a  b\n\nc';
  const { norm, map } = normalize(t);
  assert.equal(norm, 'a b c');
  for (let i = 1; i < map.length; i++) assert.ok(map[i] > map[i - 1]);
  assert.equal(t[map[norm.indexOf('c')]], 'c');
});

test('权重不变量：位置只能打破平局，不能推翻上下文', () => {
  // 一旦这条不成立，打分和 ambiguous 就自相矛盾：
  // 一边说上下文区分得开，一边又按位置选了上下文更差的那个。
  assert.ok(POS_W < AMBIG_DELTA * CTX_W,
    `POS_W(${POS_W}) 必须小于 AMBIG_DELTA*CTX_W(${AMBIG_DELTA * CTX_W})`);
});
