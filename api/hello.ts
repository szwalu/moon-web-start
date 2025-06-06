// 文件路径: /api/hello.ts

import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  response.status(200).json({
    message: '您好！这是一个来自Vercel云函数的成功响应！',
    timestamp: new Date().toISOString(),
  })
}
