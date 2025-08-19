// /api/get-favicon.js

// 切换到 Vercel Edge Runtime，性能更好，日志更可靠
export const config = {
  runtime: 'edge',
}

export default async function handler(request) {
  // 从请求 URL 中解析出 host 参数
  const { searchParams } = new URL(request.url)
  const host = searchParams.get('host')

  // 增加日志，Edge Runtime 的日志前缀不同，更容易识别
  // console.log(`Edge function invoked for host: ${host}`);

  if (!host) {
    // // console.error('Host parameter is missing.');
    return new Response('Query parameter "host" is required.', { status: 400 })
  }

  const googleFaviconURL = `https://www.google.com/s2/favicons?domain=${host}&sz=128`

  try {
    // console.log(`Fetching from Google: ${googleFaviconURL}`);
    const faviconResponse = await fetch(googleFaviconURL)

    if (!faviconResponse.ok) {
      // console.error(`Google API returned an error: ${faviconResponse.status}`);
      return new Response(faviconResponse.statusText, { status: faviconResponse.status })
    }

    // console.log(`Successfully fetched icon. Content-Type: ${faviconResponse.headers.get('Content-Type')}`);

    // 使用 Web API 的 Response 对象来返回图片，这是最标准的方式
    return new Response(faviconResponse.body, {
      status: 200,
      headers: {
        'Content-Type': faviconResponse.headers.get('Content-Type'),
        'Cache-Control': 'public, s-maxage=86400, max-age=86400, stale-while-revalidate',
      },
    })
  }
  catch (error) {
    // console.error('An unexpected error occurred:', error);
    return new Response('Internal Server Error', { status: 500 })
  }
}
