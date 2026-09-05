import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageKey } from '../src/core/pagekey.js';

test('hash 是页内定位，不构成另一个页面', () => {
  assert.equal(pageKey('https://a.com/p#s1'), pageKey('https://a.com/p#s2'));
});

test('http 与 https 视为同一页 —— 站点升级不该让高亮集体消失', () => {
  assert.equal(pageKey('http://a.com/p'), pageKey('https://a.com/p'));
});

test('追踪参数删掉，内容参数留着', () => {
  assert.equal(pageKey('https://a.com/p?utm_source=x&id=7&spm=abc'), 'a.com/p?id=7');
});

test('🔴 微信公众号的 __biz/mid/idx/sn 必须保留，否则所有文章共用一个 key', () => {
  const a = pageKey('https://mp.weixin.qq.com/s?__biz=MzA5&mid=100&idx=1&sn=aaa');
  const b = pageKey('https://mp.weixin.qq.com/s?__biz=MzA5&mid=100&idx=1&sn=bbb');
  assert.notEqual(a, b);
  assert.ok(a.includes('sn=aaa'));
});

test('参数顺序不影响 key', () => {
  assert.equal(pageKey('https://a.com/p?b=2&a=1'), pageKey('https://a.com/p?a=1&b=2'));
});

test('末尾斜杠不影响 key，但根路径保留', () => {
  assert.equal(pageKey('https://a.com/p/'), pageKey('https://a.com/p'));
  assert.equal(pageKey('https://a.com/'), 'a.com/');
});

test('非 http(s) 返回 null', () => {
  for (const u of ['chrome://extensions', 'file:///D:/a.html', 'about:blank', '不是URL'])
    assert.equal(pageKey(u), null, u);
});

test('非默认端口保留 —— 本地开发的 :3000 和 :5173 不是同一页', () => {
  assert.notEqual(pageKey('http://localhost:3000/p'), pageKey('http://localhost:5173/p'));
  assert.equal(pageKey('https://a.com:443/p'), pageKey('https://a.com/p'));
});

test('中文路径与参数不会因编码差异分裂', () => {
  assert.equal(pageKey('https://a.com/文章?标题=测试'),
               pageKey('https://a.com/%E6%96%87%E7%AB%A0?%E6%A0%87%E9%A2%98=%E6%B5%8B%E8%AF%95'));
});
