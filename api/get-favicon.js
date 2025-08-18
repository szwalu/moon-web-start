// /api/get-favicon.js

export default async function handler(request, response) {
  // 从请求的 URL 中获取 host 参数, e.g., /api/get-favicon?host=google.com
  const host = request.query.host

  if (!host)
    return response.status(400).send('Query parameter "host" is required.')

  // 这是 Google 的图标服务 URL
  const googleFaviconURL = `https://www.google.com/s2/favicons?domain=${host}&sz=128`

  try {
    // Vercel 服务器在后端发起请求。这里使用内建的 fetch API
    const faviconResponse = await fetch(googleFaviconURL)

    // 如果 Google 返回了错误（例如 404 Not Found），则将错误信息传递给前端
    if (!faviconResponse.ok)
      return response.status(faviconResponse.status).send(faviconResponse.statusText)

    // 获取从 Google 返回的图片内容 (ArrayBuffer)
    const imageBuffer = await faviconResponse.arrayBuffer()

    // 设置正确的响应头，告诉浏览器这是一个图片
    response.setHeader('Content-Type', faviconResponse.headers.get('Content-Type'))
    // 设置 Vercel CDN 缓存，缓存一天。这能极大提升性能并减少函数调用次数
    response.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate')

    // 将图片内容返回给前端
    return response.status(200).send(Buffer.from(imageBuffer))
  }
  catch (error) {
    console.error(error)
    return response.status(500).send('Internal Server Error')
  }
}
