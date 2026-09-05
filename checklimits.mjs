// 商店的字段长度限制。超了不会在本地报错，要等提交那一刻才被退回 ——
// 那时你已经把截图、隐私政策、账号全准备好了，卡在一个字符上。
// 所以放进构建流程，改文案的当下就知道。
import { readdir, readFile } from 'node:fs/promises';

const LIMITS = { extName: 45, extShortName: 12, extDesc: 132 };
const dir = 'src/_locales';
let bad = 0;

for (const loc of await readdir(dir)) {
  const raw = JSON.parse(await readFile(`${dir}/${loc}/messages.json`, 'utf8'));
  for (const [key, limit] of Object.entries(LIMITS)) {
    const v = raw[key] && raw[key].message;
    if (v === undefined) { console.error(`[限制] ${loc}/${key} 缺失`); bad++; continue; }
    const n = [...v].length;                    // 按码点数，别把 emoji 算成两个
    const mark = n <= limit ? 'OK' : '超长';
    console.log(`  ${loc.padEnd(6)} ${key.padEnd(13)} ${String(n).padStart(3)}/${limit}  ${mark}`);
    if (n > limit) bad++;
  }
}
if (bad) { console.error(`\n[限制] ${bad} 处超出商店限制，构建中止`); process.exit(1); }
