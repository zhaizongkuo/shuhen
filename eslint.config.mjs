// 只为了一件事：no-undef。
//
// 一次会话里出了两回同样的事故 —— 调用了一个根本不存在的函数，
// 而 esbuild 照样构建成功（它只打包，不做符号检查；引用未定义的全局
// 在 JS 里是合法语法，要到运行时才炸）。单测也拦不住，因为 content script
// 依赖 DOM，测不到。
//
// 所以这里不追求风格统一，只要能在构建前抓出「用了不存在的东西」。

const browser = {
  window: 'readonly', document: 'readonly', location: 'readonly',
  navigator: 'readonly', console: 'readonly', performance: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
  clearInterval: 'readonly', Node: 'readonly', NodeFilter: 'readonly',
  Range: 'readonly', CSS: 'readonly', Highlight: 'readonly',
  MutationObserver: 'readonly', Blob: 'readonly', URL: 'readonly',
  URLSearchParams: 'readonly', Promise: 'readonly', Map: 'readonly',
  Set: 'readonly', JSON: 'readonly', Math: 'readonly', Date: 'readonly',
  Object: 'readonly', Array: 'readonly', String: 'readonly', Number: 'readonly',
  Boolean: 'readonly', Error: 'readonly', Intl: 'readonly',
  chrome: 'readonly',
};

export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browser,
    },
    rules: {
      'no-undef': 'error',
      // 定义了却没用，多半意味着某次改动只落了一半
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
];
