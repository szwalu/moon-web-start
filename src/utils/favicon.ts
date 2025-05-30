// src/utils/favicon.ts (修改为使用 DuckDuckGo API)

/**
 * 根据网站的 URL 生成指向 DuckDuckGo Favicon 服务的图标链接。
 * @param url 网站的完整 URL (例如 "https://www.weibo.com/")
 * @returns 指向 DuckDuckGo Favicon API 的完整 URL 或空字符串
 */
export function getFaviconUrl(url: string): string {
  try {
    // 从完整的 URL 中安全地提取出域名 (hostname)
    const domain = new URL(url).hostname

    // 返回指向 DuckDuckGo Favicon 服务的 URL
    // 注意：DuckDuckGo 这个端点通常返回 .ico 格式，该格式可能包含多种尺寸，
    // 但我们不能像 Google API 那样通过参数指定获取的尺寸。
    return `https://icons.duckduckgo.com/ip3/${domain}.ico`
  }
  catch (error) {
    // 如果传入的 url 格式不正确，则捕获错误并打印到控制台
    console.error(`Invalid URL provided to getFaviconUrl (DuckDuckGo): ${url}`)
    // 返回一个空字符串，让前端可以处理加载失败的情况
    return ''
  }
}
