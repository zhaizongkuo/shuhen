# 书痕 · Shuhen

网页划线高亮批注扩展，可导出 Markdown / Obsidian。
刷新、改版、无限滚动之后痕迹还在原处。

- 站点：<https://zhaizongkuo.github.io/shuhen/>
- 隐私政策：<https://zhaizongkuo.github.io/shuhen/privacy.html>（[English](https://zhaizongkuo.github.io/shuhen/privacy-en.html)）

由北京留痕软件开发中心出品。

---

## 这个仓库现在放什么

`docs/` —— 官网与隐私政策，三个纯静态 html，无构建、无依赖。
GitHub Pages 从 **`main` 分支 / `/docs` 目录** 提供。

## 为什么放 `docs/` 而不是仓库根目录

`/docs` 的内容同样从站点根路径提供，所以隐私政策地址是
`https://<用户名>.github.io/shuhen/privacy.html` —— **和放根目录时完全一样**。

这样将来往仓库里加扩展源码，网页不用挪、**商店里填的那个 URL 也不用改**。
而那个 URL 一旦提交给商店，改动要重新过审。

## 上架之后要回来改一处

`docs/index.html` 里两个商店按钮现在是 `aria-disabled` 的占位。
上架后把 `href="#"` 换成真实商店链接、删掉 `aria-disabled` 即可。
