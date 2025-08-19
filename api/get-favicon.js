import type { VercelRequest, VercelResponse } from '@vercel/node'

const cache: Record<string, { data: Buffer; expires: number }> = {}
const CACHE_TTL = 1000 * 60 * 60 // 缓存 1 小时

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const host = req.query.host as string

  if (!host) {
    res.status(400).json({ error: 'Missing host parameter' })
    return
  }

  // 命中缓存
  const cached = cache[host]
  if (cached && cached.expires > Date.now()) {
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.send(cached.data)
    return
  }

  try {
    const url = `https://www.google.com/s2/favicons?domain=${host}&sz=64`
    const response = await fetch(url)

    if (!response.ok)
      throw new Error(`Failed to fetch favicon: ${response.status}`)

    const buffer = Buffer.from(await response.arrayBuffer())

    // 存入内存缓存
    cache[host] = {
      data: buffer,
      expires: Date.now() + CACHE_TTL,
    }

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.send(buffer)
  }
  catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
