import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = 'FR4EYi0tJHtGlrL1'

  // 获取客户端 IP
  const ipRes = await fetch('https://service-dckmg3nu-1303824403.ap-shanghai.apigateway.myqcloud.com/release/ip')
  const ipJson = await ipRes.json()

  const lat = ipJson.lat
  const lon = ipJson.lng
  const city = ipJson.city
  const country = ipJson.nation

  if (!lat || !lon)
    return res.status(500).json({ error: 'IP定位失败' })

  const weatherRes = await fetch(`https://api.caiyunapp.com/v2/${token}/${lon},${lat}/realtime.json`)
  const weatherJson = await weatherRes.json()

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

  const temp = weatherJson.result.temperature
  const condition = skyconTextMap[weatherJson.result.skycon] || weatherJson.result.skycon

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.status(200).json({
    city,
    country,
    temp,
    text: condition,
  })
}
