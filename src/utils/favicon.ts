// src/utils/favicon.ts (修改后的完整内容)

/**
 * 根据网站的 URL 生成指向 Google Favicon 服务的图标链接。
 * @param url 网站的完整 URL (例如 "https://www.weibo.com/")
 * @returns 指向 Google Favicon API 的完整 URL
 */
export function getFaviconUrl(url: string): string {
  try {
    // 从完整的 URL 中安全地提取出域名 (hostname)
    const domain = new URL(url).hostname

    // 你可以根据需要调整图标的大小 (例如 32, 64, 128)
    const size = 64

    // 返回指向 Google Favicon 服务的、格式正确的完整 URL
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`
  }
  catch (error) {
    // 如果传入的 url 格式不正确，则捕获错误并打印到控制台
    console.error(`Invalid URL provided to getFaviconUrl: ${url}`)
    // 返回一个空字符串，让前端可以处理加载失败的情况
    return ''
  }
}
