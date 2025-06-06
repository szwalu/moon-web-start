// 文件路径: /api/storeData.ts

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
      KV_URL_FOUND: !!process.env.KV_URL,
      KV_TOKEN_FOUND: !!process.env.KV_REST_API_TOKEN,
    })
  }
  // --- 诊断结束 ---

  if (request.method === 'OPTIONS')
    return response.status(200).end()

  if (request.method !== 'POST')
    return response.status(405).json({ msg: '只允许 POST 请求' })

  try {
    if (!request.body || typeof request.body !== 'object')
      return response.status(400).json({ code: -1, msg: '请求体无效或为空。' })

    const { id, data } = request.body

    if (!id || !data)
      return response.status(400).json({ code: -1, msg: '请求参数错误，必须提供 "id" 和 "data" 字段。' })

    await kv.set(`config:${id}`, data)

    return response.status(200).json({ code: 0, msg: '数据存储/更新成功。', id })
  }
  catch (error: any) {
    return response.status(500).json({
      code: -2,
      msg: `数据库操作失败: ${error.message}`,
      error_stack: error.stack,
    })
  }
}
