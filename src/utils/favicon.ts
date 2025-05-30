const siteToUrl: Map<string, string> = new Map()
const sites: string[] = ['clougence.com', 'jd.com', 'taobao.com', 'pinduoduo.com']

sites.forEach((e: string) => {
  siteToUrl.set(e, `/site/${e}.svg`)
})

export function getDomainName(url: string): string | null {
  let domain = url.replace(/(^\w+:|^)\/\//, '')
  domain = domain.replace(/^www\./, '')
  const matches = domain.match(/([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/)
  return matches?.[1] ?? null
}

// 多个 favicon API 源
export const FAVICON_APIS = [
  (domain: string) => `https://api.iowen.cn/favicon/${domain}.png`,
  (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  (domain: string) => `https://www.google.com/s2/favicons?sz=64&domain=${domain}`,
]

export function getFaviconCandidates(url: string): string[] {
  const domain = getDomainName(url)
  if (!domain)
    return []

  const localSvg = siteToUrl.get(domain)
  const results: string[] = []

  if (localSvg)
    results.push(localSvg)

  for (const api of FAVICON_APIS)
    results.push(api(domain))

  return results
}
