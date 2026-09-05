// 隐私政策里写着「代码里没有任何一处网络请求」。
// 这句话今天是真的 —— 但它会在某次「就加一个统计吧」的提交里悄悄变成假话，
// 而没有任何东西会提醒你去改政策文本。
//
// 所以把它变成一条构建时约束：一旦有人往 src/ 里加网络调用，构建直接失败。
// 到那时要么去掉调用，要么先改隐私政策 —— 两者必须同时发生。

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const BANNED = [
  ['fetch(', '网络请求'],
  ['XMLHttpRequest', '网络请求'],
  ['new WebSocket', 'WebSocket 连接'],
  ['sendBeacon', '数据上报'],
  ['EventSource', '服务端推送'],
  ['importScripts', '远程脚本'],
  ['chrome.storage.sync', '云同步存储（政策里声明了只用 local）'],
];

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (['.js', '.mjs', '.html'].includes(extname(e.name))) out.push(p);
  }
  return out;
}

let bad = 0;
for (const file of await walk('src')) {
  // 图标生成脚本是留档用的，不进包
  if (file.includes('icons')) continue;
  const text = await readFile(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (line.trimStart().startsWith('//')) return;       // 注释里提到不算
    for (const [needle, what] of BANNED) {
      if (line.includes(needle)) {
        console.error(`[隐私] ${file}:${i + 1} 出现${what}：${needle}`);
        bad++;
      }
    }
  });
}

if (bad) {
  console.error('\n[隐私] 与 store/PRIVACY.*.md 的声明冲突，构建中止。');
  console.error('       要么去掉这些调用，要么先改隐私政策 —— 两者必须同时发生。');
  process.exit(1);
}
console.log('  隐私声明校验通过：src/ 中无网络请求、无云同步存储');
