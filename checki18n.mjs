// STATUS.md 里写着「i18n 从第一行 —— 任何中文都不许写死在代码里」。
// 那句话在这个文件存在之前，没有任何东西在守 —— 而它已经被违反过一次：
// 总览页整页文案都是硬编码中文，一直到 v1.0.0 上架都没人发现，
// 因为商店 listing 是中英双语的、划词工具条也是英文的，
// 只有点开总览页才露馅。这类缺口不会报错，只会让英文用户觉得是半成品。
//
// 所以把它变成构建时约束：受管目录里，**非注释行**出现中文就构建失败。
//
// 为什么用「字符类」而不是「列举不该出现的词」：
// 黑名单只挡得住你想到的那几个词，而且列举本身要把那些词写进仓库。
// 正向的字符范围规则挡住所有不合规的形状，且自己是干净的。
//
// 注释里的中文是允许的 —— 这个仓库的注释本来就全是中文，
// 而注释不进用户界面。

import { readdir, readFile } from 'node:fs/promises';
import { join, extname, sep } from 'node:path';

// 受管目录：这些地方现在是干净的，守住它们别再退回去。
//
// ⚠️ src/content/ 和 src/background/ 暂不在内 —— 它们还有已知的硬编码，
// 见 pathfinder 仓库 STATUS.md 的「i18n 欠账」。修完一处就把它加进来，
// 一次加一个目录，别等「全部修好再一起开」——那天不会到来。
const GUARDED = [
  'src/library',
  'src/core',
];

// 🔴 临时豁免。每一条都必须带「为什么还没修」和「怎么修」，
// 否则豁免列表会变成永久的 —— 那时守卫还在跑，但守的东西越来越少，
// 而没有任何东西会提醒你它已经形同虚设。
const EXEMPT = new Map([
  ['src/core/export.js',
   '导出的 Markdown 内容里的中文（未命名 / [原文] / 网页高亮汇总 / 原文已找不到）。' +
   '这一层是纯函数拿不到 chrome.i18n，正确解法是由调用方注入 labels、默认英文。' +
   '要改动 3 个测试文件，见 pathfinder STATUS.md「i18n 欠账」。'],
]);

// CJK 统一表意文字 + 中文标点（。，、；：？！「」『』（）《》—…·）。
// 只要一个就算。
const CJK = /[一-鿿　-〿！-～]/;

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (['.js', '.mjs', '.html'].includes(extname(e.name))) out.push(p);
  }
  return out;
}

// 去掉注释后再看。做得刚好够用就行 ——
// 完整的 JS 词法分析在这里是过度工程，而漏判的代价只是「多报一条」，
// 那时人去看一眼就知道了。误放过才是真问题，所以宁可严一点。
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')        // /* 块注释 */
    .replace(/<!--[\s\S]*?-->/g, '')         // <!-- HTML 注释 -->
    .split('\n')
    .map((line) => {
      const t = line.trimStart();
      if (t.startsWith('//') || t.startsWith('*')) return '';
      // 行尾注释。字符串里出现 // 的情况（比如 URL）会被误切，
      // 但那只会让这一行少检查一点，不会漏报整行 —— 可接受。
      return line.replace(/\/\/.*$/, '');
    })
    .join('\n');
}

let bad = 0;
const exempted = [];
for (const dir of GUARDED) {
  for (const file of await walk(dir)) {
    const rel = file.split(sep).join('/');
    if (EXEMPT.has(rel)) { exempted.push(rel); continue; }
    const raw = await readFile(file, 'utf8');
    stripComments(raw).split('\n').forEach((line, i) => {
      if (CJK.test(line)) {
        console.error(`[i18n] ${file}:${i + 1} 非注释行出现中文：${line.trim().slice(0, 60)}`);
        bad++;
      }
    });
  }
}

if (bad) {
  console.error(`\n[i18n] ${bad} 处硬编码中文，构建中止。`);
  console.error('       界面文案走 chrome.i18n.getMessage + _locales；');
  console.error('       core 层是纯函数拿不到 i18n，应返回错误码由 UI 层查表。');
  process.exit(1);
}
console.log(`  i18n 校验通过：${GUARDED.join(' / ')} 无硬编码中文`);
// 豁免要每次都打出来。塞进列表就再也看不见的话，它就等于被删掉了。
for (const rel of exempted) console.log(`  ⚠️ i18n 豁免中：${rel} —— ${EXEMPT.get(rel)}`);
