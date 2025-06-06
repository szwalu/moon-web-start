// 文件路径: /api/readData.ts

import { kv } from '@vercel/kv'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  // 明确处理 OPTIONS 预检请求，用于解决CORS问题
  if (request.method === 'OPTIONS')
    return response.status(200).end()

  // 确保只接受 GET 请求
  if (request.method !== 'GET')
    return response.status(405).json({ msg: '只允许 GET 请求' })

  try {
    const { id } = request.query

    if (!id || typeof id !== 'string')
      return response.status(400).json({ code: -1, msg: '请求参数错误，必须提供 "id" 查询参数。' })

    // 从Vercel KV数据库中获取数据
    const data = await kv.get(`config:${id}`)

    // 如果找不到数据，返回 404
    if (data === null)
      return response.status(404).json({ code: -3, msg: '未找到指定ID的数据。' })

    // 成功找到数据，将其返回
    return response.status(200).json({ code: 0, msg: '数据读取成功。', data: { id, data } })
  }
  catch (error: any) {
    // 在生产环境中，记录详细错误，帮助追踪问题
    console.error('READ_DATA_ERROR:', {
      message: error.message,
      query: request.query,
    })
    return response.status(500).json({ code: -2, msg: `数据库查询失败: ${error.message}` })
  }
}
