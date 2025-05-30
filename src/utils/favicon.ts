const FAVICON_API = import.meta.env.VITE_FAVICON_API || 'https://www.google.com/s2/favicons'

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
  return matches && matches.length > 1 ? matches[1] : null
}

export function getFaviconUrl(url: string) {
  const paramsUrl = getDomainName(url)
  if (paramsUrl == null)
    return '/path/to/default-icon.png' // 本地默认图标
  const optUrl = siteToUrl.get(paramsUrl)
  if (optUrl)
    return optUrl
  return `${FAVICON_API}?domain=${paramsUrl}`
}
