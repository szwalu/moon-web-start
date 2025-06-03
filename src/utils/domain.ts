/**
 * 从给定的 URL 字符串中提取完整主机名 (e.g., www.example.com or example.com)
 * @param urlString 输入的 URL 字符串
 * @returns 提取的完整主机名，如果 URL 无效则返回空字符串
 */
export function getHostname(urlString: string): string {
  if (!urlString)
    return ''

  try {
    let fullUrl = urlString
    // Ensure URL has a protocol for the URL constructor
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://'))
      fullUrl = urlString.startsWith('//') ? `http:${urlString}` : `http://${urlString}`

    return new URL(fullUrl).hostname
  }
  catch (e) {
    // Fallback for non-URL strings that might just be a hostname or malformed
    const simpleMatch = urlString.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:/?#]+)/im)
    if (simpleMatch && simpleMatch[1]) {
      // Return the matched part, which should be the domain-like string
      return simpleMatch[1]
    }
    // console.error(`Invalid URL for getHostname: ${urlString}`, e);
    return ''
  }
}

/**
 * 从给定的 URL 字符串中提取主域名，并尝试移除 'www.' 前缀。
 * @param urlString 输入的 URL 字符串
 * @returns 提取的主域名（不含www.），如果 URL 无效则返回空字符串
 */
export function getDomain(urlString: string): string {
  const hostname = getHostname(urlString) // Reuse getHostname
  if (hostname.startsWith('www.'))
    return hostname.substring(4)

  return hostname
}
