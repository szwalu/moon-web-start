// src/utils/favicon.ts (确保是这个版本)
export function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    const size = 128; // 始终请求高清图标
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
  }
  catch (error) {
    // console.error(`Invalid URL provided to getFaviconUrl (Google): ${url}`); // 可以去掉console避免eslint问题
    return '';
  }
}