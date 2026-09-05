// 渲染层。整个产品的技术地基就在这几行：CSS Custom Highlight API 不插 DOM。
// 现任产品全是 <span> 包裹或 overlay 定位 —— 前者破坏页面结构、和站点样式打架，
// 后者滚动/缩放时会漂。不碰 DOM 才是「高亮不丢、不打架」的根因。
//
// ⚠️ ::highlight() 只认少数几个属性：color / background-color / text-decoration /
//    text-shadow / -webkit-text-stroke。border、padding、圆角一律无效，别试。

import { COLORS } from '../core/schema.js';
import { UI_ATTR } from '../core/textindex.js';

const NS = 'pfhl-';                 // 注册表名字加前缀，避免和页面自己的 ::highlight 撞名
const STYLE_ID = 'pf-hl-style';

// 存的是颜色名，这里才映射成色值 —— 换配色不用迁移历史数据（见 schema.js）
const PALETTE = {
  yellow: { light: 'rgba(255, 214, 0, .45)',  dark: 'rgba(255, 214, 0, .30)' },
  green:  { light: 'rgba(80, 220, 120, .40)', dark: 'rgba(80, 220, 120, .28)' },
  blue:   { light: 'rgba(90, 170, 255, .38)', dark: 'rgba(90, 170, 255, .30)' },
  pink:   { light: 'rgba(255, 120, 190, .38)', dark: 'rgba(255, 120, 190, .28)' },
};

const registry = new Map();   // color -> Highlight

export function supported() {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

export function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const rules = COLORS.map((c) => {
    const p = PALETTE[c] || PALETTE.yellow;
    // color:inherit 是必须的：不写的话某些站点的 ::selection/继承规则会把字变色，
    // 用户会以为「我的文字被改了」。高亮只应该改背景。
    return `::highlight(${NS}${c}){background-color:${p.light};color:inherit}`;
  }).join('\n');

  const dark = COLORS.map((c) => {
    const p = PALETTE[c] || PALETTE.yellow;
    return `::highlight(${NS}${c}){background-color:${p.dark};color:inherit}`;
  }).join('\n');

  // 上下文不确定时用虚线下划线弱化提示，而不是画得和确定的一样。
  // 与其假装很确定，不如让用户一眼看出「这条可能标偏了」。
  const ambiguous = `::highlight(${NS}ambiguous){background-color:rgba(255,214,0,.22);` +
    `color:inherit;text-decoration:underline dotted}`;

  // 闪烁用高饱和橙，和四种常规色都拉得开 —— 用户一眼能认出「是这条」。
  // ::highlight() 不支持 CSS 动画，所以闪烁靠 JS 定时开关这个桶实现。
  const flash = `::highlight(${NS}flash){background-color:rgba(255,110,30,.75);color:inherit}`;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.setAttribute(UI_ATTR, '');
  style.textContent =
    rules + '\n' + ambiguous + '\n' + flash +
    '\n@media (prefers-color-scheme: dark){\n' + dark + '\n}';

  // 必须放 head。放 body 会触发 MutationObserver；放 documentElement 各浏览器处理不一致。
  (document.head || document.documentElement).appendChild(style);
}

/**
 * @param {Map<string, Range[]>} byColor  颜色名（或 'ambiguous'） -> ranges
 */
export function paint(byColor) {
  const names = new Set([...COLORS, 'ambiguous']);
  for (const name of names) {
    const ranges = byColor.get(name);
    let hl = registry.get(name);
    if (!ranges || ranges.length === 0) {
      if (hl) hl.clear();
      continue;
    }
    if (!hl) {
      hl = new Highlight();
      registry.set(name, hl);
      CSS.highlights.set(NS + name, hl);
    }
    hl.clear();
    for (const r of ranges) hl.add(r);
  }
}

/**
 * 从总览页跳过来时，闪一下告诉用户「就是这条」。
 * 单独一个注册表项，不走 paint()：paint 会把没出现在本次参数里的桶清空，
 * 而闪烁是跨若干次重锚存活的短时状态，混在一起会被顺手擦掉。
 */
export function setFlash(ranges) {
  const name = 'flash';
  let hl = registry.get(name);
  if (!hl) {
    hl = new Highlight();
    // 优先级要高于普通高亮，否则被原来的颜色盖住，闪了等于没闪
    hl.priority = 10;
    registry.set(name, hl);
    CSS.highlights.set(NS + name, hl);
  }
  hl.clear();
  for (const r of ranges || []) hl.add(r);
}

export function teardown() {
  for (const [name, hl] of registry) {
    hl.clear();
    CSS.highlights.delete(NS + name);
  }
  registry.clear();
  const s = document.getElementById(STYLE_ID);
  if (s) s.remove();
}
