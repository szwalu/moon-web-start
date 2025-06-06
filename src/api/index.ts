// 文件路径: src/api/index.ts

// 封装一个通用的 fetch 函数（已更新错误处理）
async function fetcher(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })

  if (!response.ok) {
    // 如果服务器返回错误，先尝试获取文本内容.
    const errorText = await response.text()
    try {
      // 再次尝试将文本内容解析为JSON
      const errorData = JSON.parse(errorText)
      throw new Error(errorData.msg || `请求失败，状态码: ${response.status}`)
    }
    catch (e) {
      // 如果解析JSON失败，说明服务器返回的不是JSON错误（很可能是HTML错误页）
      // 抛出原始的文本错误，以便我们能看到Vercel返回的具体信息
      throw new Error(`请求失败，状态码: ${response.status}. 服务器响应: ${errorText}`)
    }
  }

  // 仅当响应成功时才解析JSON
  return response.json()
}

// “存储数据”的请求函数 (保持不变)
export function reqPostData(body: { id: string; data: any }) {
  return fetcher('/api/storeData', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// “读取数据”的请求函数 (保持不变)
export function reqGetData(id: string) {
  return fetcher(`/api/readData?id=${id}`)
}
