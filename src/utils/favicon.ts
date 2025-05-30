const FALLBACK_APIS = [
  'https://api.iowen.cn/favicon',
  'https://icons.duckduckgo.com/ip3',
  'https://www.google.com/s2/favicons?domain',
]

const siteToUrl: Map<string, string> = new Map()
const sites: string[] = [
  'clougence.com',
  'jd.com',
  'taobao.com',
  'pinduoduo.com',
]

sites.forEach((e: string) => {
  siteToUrl.set(e, `/site/${e}.svg`)
})

export function getDomainName(url: string) {
  let domain = url.replace(/(^\w+:|^)\/\//, '')
  domain = domain.replace(/^www\./, '')

  const matches = domain.match(/([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/)
  return matches?.[1] ?? null
}

export function getFaviconUrl(url: string): string {
  const domain = getDomainName(url)
  if (!domain)
    return ''

  const optUrl = siteToUrl.get(domain)
  if (optUrl)
    return optUrl

  // 默认使用第一个 API，可后续尝试增加智能切换
  return `${FALLBACK_APIS[0]}/${domain}.png`
}
