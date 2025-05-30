// src/utils/favicon.ts (最终版 - 仅使用 Google API)

/**
 * 根据网站的 URL 生成指向 Google Favicon 服务的图标链接。
 * @param url 网站的完整 URL (例如 "https://www.weibo.com/")
 * @returns 指向 Google Favicon API 的完整 URL 或空字符串
 */
export function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname
    const size = 128 // 始终请求 128px 的高清图标
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`
  }
  catch (error) {
    console.error(`Invalid URL provided to getFaviconUrl: ${url}`)
    return ''
  }
}
