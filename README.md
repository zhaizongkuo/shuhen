# 书痕 · Shuhen

**在网页上划下的那一道，刷新之后还在原处。**

网页划线、高亮、批注，可导出 Markdown / Obsidian。不用注册，没有服务器。

- 网站：<https://zhaizongkuo.github.io/shuhen/>
- 隐私政策：[中文](https://zhaizongkuo.github.io/shuhen/privacy.html) · [English](https://zhaizongkuo.github.io/shuhen/privacy-en.html)
- Edge 加载项商店：审核中

由北京留痕软件开发中心出品。

---

## 为什么源码是公开的

隐私政策里有一句：**「扩展代码里没有任何一处网络请求。」**

这句话用户没法验证，除非代码公开。对一个需要读取网页内容的扩展来说，
**公开源码是这句话唯一的证据**，比任何文案都有力。

你可以自己核对：

```bash
grep -rn "fetch(\|XMLHttpRequest\|WebSocket\|sendBeacon" src/
```

结果应当为空。这条校验还被写进了构建流程 —— `checkprivacy.mjs` 会在每次
`npm run build` 时检查 `src/` 中有无网络调用或 `chrome.storage.sync`，
**发现就让构建失败**。这样「没有网络请求」这句话不会在某次
「就加一个统计吧」的提交里悄悄变成假话。

> ⚠️ **保留所有权利。** 源码公开是为了可审计，不是授权再分发。
> 目前未附加开源许可证；如需在其他项目中使用，请先联系。

---

## 跑起来

```bash
npm install
npm run build      # 产出 dist/
npm test           # eslint + 文案长度校验 + 隐私声明校验 + 单元测试
npm run watch      # 改代码自动重编
```

装载：Chrome / Edge 打开 `chrome://extensions` → 开发者模式
→ 加载已解压的扩展程序 → 选 **`dist/`**（不是 `src/`）。

装完**不会申请任何网站权限**。在某个站点点一下扩展图标才会按域名授权。

---

## 目录

```
src/core/       与浏览器无关，能被 node --test 直接测
  anchor.js       锚定算法（纯字符串函数）—— 产品的全部价值在这
  textindex.js    DOM ↔ 字符偏移换算
  pagekey.js      URL 归一化：高亮挂在哪个 key 下
  schema.js       存储格式 + 版本迁移
  export.js       导出 Markdown（纯函数）
src/content/
  main.js         MAIN world：编排
  bridge.js       ISOLATED world：存储 + 快捷键转发
  render.js       CSS Custom Highlight API 渲染
  toolbar.js      划词工具条（Shadow DOM）
  panel.js        本页高亮列表（Shadow DOM）
src/library/      跨页面总览（扩展自有页面）
src/background/   按站授权 + 注册 content script
```

锚定算法被刻意写成**纯字符串函数**，不碰 DOM 也不碰 `chrome.*`，
所以 `node --test` 不需要 jsdom 就能测最容易出错的那部分。
测试里带 🔴 标记的几条，每一条都对应一个真实踩过的坑。

---

## 三个不能动的设计决定

**1. 不给网页插入任何元素**

用浏览器原生的 CSS Custom Highlight API 绘制。同类产品多用 `<span>` 包裹
或 overlay 定位：前者破坏页面结构、和站点样式打架，后者滚动缩放时会漂。
不碰 DOM 才是「高亮不丢、不打架」的根因。

**2. 双 world 架构**

渲染必须在 MAIN world，否则 `CSS.highlights` 注册表可能与页面的
`::highlight()` 规则不在同一 realm；而 MAIN 拿不到 `chrome.*`。
所以存储拆到 ISOLATED 的 bridge，两边只传纯 JSON。
**DOM 节点无法跨 world 结构化克隆，所以锚点只能是字符偏移** ——
这是架构约束，不是实现选择。

**3. 锚不上不删数据**

站点改版、A/B 分流、内容折叠都会让文字暂时不在页面上，明天可能又回来。
所以只标记 `orphaned`，永不删除。

---

## 已知边界

不假装没有：

- **iframe / shadow DOM 不支持**，索引只走主文档
- **不支持 PDF**
- **`::highlight()` 只认几个属性**：`color` / `background-color` /
  `text-decoration` / `text-shadow` / `-webkit-text-stroke`，border 和圆角无效
- **MAIN world 的代码页面能看见也能改**。页面能读到的只是它自己的文本
  （它本来就有），额外暴露的只有用户写的笔记。在敌意站点上写私密笔记
  是这套架构的已知风险
- **`display:none` 的内容也会进索引**，会让偏移与肉眼所见不一致

---

## 环境要求

**Chrome / Edge 105+** —— CSS Custom Highlight API 的最低版本。
部分国产套壳浏览器内核较旧，可能无法运行。

`world: "MAIN"` 的 content script 注册需要 111+。

---

## 网站

`docs/` 是官网与隐私政策，三个纯静态 html，无构建无依赖，
GitHub Pages 从 **`main` 分支 / `/docs` 目录** 提供。

放 `docs/` 而不是仓库根目录的原因：`/docs` 的内容同样从站点根路径提供，
所以隐私政策地址与放根目录时完全一致 —— **商店里填的那个 URL 不用改**，
而它一旦提交给商店，改动要重新过审。
