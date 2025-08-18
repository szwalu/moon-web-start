// src/utils/favicon.ts

/**
 * 获取网站的 favicon URL。
 * 这个函数现在指向我们自己在 Vercel 上部署的代理 API。
 * @param url 网站的完整 URL (虽然我们只需要 host，但保持参数一致性)
 * @returns 指向我们自己代理服务的 URL
 */
export function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname
    // 返回我们自己的 API 接口地址
    return `/api/get-favicon?host=${domain}`
  }
  catch (error) {
    console.error(`Invalid URL provided to getFaviconUrl: ${url}`)
    return ''
  }
}
