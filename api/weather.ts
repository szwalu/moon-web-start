import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { lat, lon } = req.query
  const token = 'FR4EYi0tJHtGlrL1'

  if (!lat || !lon)
    return res.status(400).json({ error: '缺少 lat 或 lon' })

  const url = `https://api.caiyunapp.com/v2/${token}/${lon},${lat}/realtime.json`
  try {
    const resp = await fetch(url)
    const data = await resp.json()
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(200).json(data)
  }
  catch (err) {
    res.status(500).json({ error: '天气获取失败', detail: err })
  }
}
