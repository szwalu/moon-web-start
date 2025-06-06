// 文件路径: /api/storeData.ts

import { kv } from '@vercel/kv'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  // 确认请求方法是 POST
  if (request.method !== 'POST')
    return response.status(405).json({ message: '只允许 POST 请求' })

  try {
    const { id, data } = request.body

    // 检查必要的参数
    if (!id || !data)
      return response.status(400).json({ code: -1, msg: '请求参数错误，必须提供 "id" 和 "data" 字段。' })

    // 使用 Vercel KV 的 set 命令来存储数据
    // 我们用 `config:${id}` 作为键，确保唯一性
    await kv.set(`config:${id}`, JSON.stringify(data))

    // 返回成功信息
    return response.status(200).json({ code: 0, msg: '数据存储/更新成功。', id })
  }
  catch (error) {
    // 处理可能发生的错误
    console.error(error)
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    return response.status(500).json({ code: -2, msg: `数据库操作失败: ${errorMessage}` })
  }
}
