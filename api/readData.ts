// 文件路径: /api/readData.ts

import { kv } from '@vercel/kv'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  // --- 诊断步骤 1: 检查环境变量是否存在 ---
  if (!process.env.KV_URL || !process.env.KV_REST_API_TOKEN) {
    return response.status(500).json({
      code: -100,
      msg: '服务器配置错误：云函数无法访问数据库连接密钥。',
      // 为了调试，我们暴露一下哪个变量缺失了
      KV_URL_FOUND: !!process.env.KV_URL,
      KV_TOKEN_FOUND: !!process.env.KV_REST_API_TOKEN,
    })
  }
  // --- 诊断结束 ---

  if (request.method === 'OPTIONS')
    return response.status(200).end()

  if (request.method !== 'GET')
    return response.status(405).json({ msg: '只允许 GET 请求' })

  try {
    const { id } = request.query

    if (!id || typeof id !== 'string')
      return response.status(400).json({ code: -1, msg: '请求参数错误，必须提供 "id" 查询参数。' })

    const data = await kv.get(`config:${id}`)

    if (data === null)
      return response.status(404).json({ code: -3, msg: '未找到指定ID的数据。' })

    return response.status(200).json({ code: 0, msg: '数据读取成功。', data: { id, data } })
  }
  catch (error: any) {
    // 返回更详细的错误信息
    return response.status(500).json({
      code: -2,
      msg: `数据库查询失败: ${error.message}`,
      error_stack: error.stack,
    })
  }
}
