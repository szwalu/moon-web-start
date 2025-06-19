import type { VercelRequest, VercelResponse } from '@vercel/node'
import fetch from 'node-fetch'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = 'FR4EYi0tJHtGlrL1'

  try {
    // 1. 获取 IP 信息
    const ipRes = await fetch('https://service-dckmg3nu-1303824403.ap-shanghai.apigateway.myqcloud.com/release/ip')
    const ipJson = await ipRes.json()

    const lat = ipJson.lat
    const lon = ipJson.lng
    const city = ipJson.city
    const country = ipJson.nation

    if (!lat || !lon)
      throw new Error('IP定位失败')

    // 2. 获取天气信息
    const weatherRes = await fetch(`https://api.caiyunapp.com/v2/${token}/${lon},${lat}/realtime.json`)
    const weatherJson = await weatherRes.json()

    const temp = weatherJson.result.temperature
    const condition = weatherJson.result.skycon

    const skyconTextMap = {
      CLEAR_DAY: '晴',
      CLEAR_NIGHT: '晴夜',
      PARTLY_CLOUDY_DAY: '多云',
      PARTLY_CLOUDY_NIGHT: '多云夜',
      CLOUDY: '阴',
      RAIN: '雨',
      SNOW: '雪',
      WIND: '风',
      FOG: '雾',
      HAZE: '霾',
    }

    const text = skyconTextMap[condition] || condition

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(200).json({
      city,
      country,
      temp,
      text,
    })
  }
  catch (err) {
    res.status(500).json({ error: '服务器错误', detail: (err as Error).message })
  }
}
