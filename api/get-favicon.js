// /api/get-favicon.js

export default async function handler(request, response) {
  const host = request.query.host
  // console.log(`[LOG] Function invoked for host: ${host}`); // 增加日志

  if (!host) {
    console.error('[ERROR] Host parameter is missing.')
    return response.status(400).send('Query parameter "host" is required.')
  }

  const googleFaviconURL = `https://www.google.com/s2/favicons?domain=${host}&sz=128`

  try {
    // console.log(`[LOG] Fetching from Google: ${googleFaviconURL}`);
    const faviconResponse = await fetch(googleFaviconURL)

    if (!faviconResponse.ok) {
      console.error(`[ERROR] Google API returned an error: ${faviconResponse.status} ${faviconResponse.statusText}`)
      return response.status(faviconResponse.status).send(faviconResponse.statusText)
    }

    const contentType = faviconResponse.headers.get('Content-Type')
    const imageBuffer = await faviconResponse.arrayBuffer()

    // console.log(`[LOG] Successfully fetched icon. Content-Type: ${contentType}, Size: ${imageBuffer.byteLength} bytes.`);

    if (contentType)
      response.setHeader('Content-Type', contentType)

    // 关键：设置缓存。s-maxage 用于 Vercel CDN，max-age 用于浏览器
    response.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=86400, stale-while-revalidate')

    // 发送图片 Buffer
    return response.status(200).send(Buffer.from(imageBuffer))
  }
  catch (error) {
    console.error(`[FATAL] An unexpected error occurred:`, error)
    return response.status(500).send('Internal Server Error')
  }
}
