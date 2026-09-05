// 为什么需要构建：content script 用 world:"MAIN" 注入时只能是「经典脚本」，
// 不能是 ES module（registerContentScripts 的 js 字段不接受 module）。
// 而锚定引擎必须是真模块才能被 node --test 直接测。
// 构建的唯一职责就是把模块打平成经典脚本。没有转译、没有压缩、没有框架。

import { build, context } from 'esbuild';
import { cp, rm, mkdir } from 'node:fs/promises';
import './checklimits.mjs';   // 文案超长就在这里挡住，别等提交商店才发现
import './checkprivacy.mjs';  // 代码若与隐私声明冲突，构建直接失败

const watch = process.argv.includes('--watch');
const OUT = 'dist';

const opts = {
  entryPoints: {
    'content/main': 'src/content/main.js',
    'content/bridge': 'src/content/bridge.js',
    'background/sw': 'src/background/sw.js',
    'library/index': 'src/library/index.js',
  },
  bundle: true,
  format: 'iife',          // 必须 iife：经典脚本，且不污染页面全局
  target: 'chrome111',     // world:"MAIN" 需要 111+；CSS.highlights 需要 105+
  outdir: OUT,
  logLevel: 'info',
  legalComments: 'none',
  sourcemap: watch ? 'inline' : false,
};

// 静态资源直接拷。manifest 和 _locales 不参与打包。
async function copyStatic() {
  await cp('src/manifest.json', `${OUT}/manifest.json`);
  await mkdir(`${OUT}/library`, { recursive: true });
  await cp('src/library/index.html', `${OUT}/library/index.html`);
  // 只拷 png：generate.js 是留档用的绘制脚本，不该进包
  await mkdir(`${OUT}/icons`, { recursive: true });
  for (const n of [16, 32, 48, 128]) {
    await cp(`src/icons/icon${n}.png`, `${OUT}/icons/icon${n}.png`);
  }
  await cp('src/_locales', `${OUT}/_locales`, { recursive: true });
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  await copyStatic();
  console.log('[build] watching... 改完仍需在 chrome://extensions 点刷新');
} else {
  await build(opts);
  await copyStatic();
  console.log('[build] -> dist/');
}
