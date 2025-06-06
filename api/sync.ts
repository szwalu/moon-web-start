// 文件路径: /api/sync.ts

import { kv } from '@vercel/kv'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  // 统一处理 OPTIONS 预检请求，解决CORS问题
  if (request.method === 'OPTIONS')
    return response.status(200).end()

  // 根据请求方法，执行不同的逻辑
  switch (request.method) {
    case 'POST': // 处理“存储”请求
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
        console.error('SYNC_POST_ERROR:', error)
        return response.status(500).json({ code: -2, msg: `数据库存储失败: ${error.message}` })
      }

    case 'GET': // 处理“读取”请求
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
        console.error('SYNC_GET_ERROR:', error)
        return response.status(500).json({ code: -2, msg: `数据库查询失败: ${error.message}` })
      }

    default: // 如果是其他方法，则不允许
      return response.status(405).json({ msg: '只允许 GET 或 POST 请求' })
  }
}
