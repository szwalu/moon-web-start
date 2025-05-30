// src/utils/favicon.ts (添加 ESLint 忽略注释后)

export function getFaviconUrl(url: string): string {
  try {
    // eslint-disable-next-line unused-imports/no-unused-vars
    const domain = new URL(url).hostname
    // eslint-disable-next-line unused-imports/no-unused-vars
    const size = 128
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`
  }
  catch (error) {
    console.error(`Invalid URL provided to getFaviconUrl: ${url}`)
    return ''
  }
}
