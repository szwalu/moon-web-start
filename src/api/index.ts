// 文件路径: src/api/index.ts

// 封装一个通用的 fetch 函数（已更新错误处理）
async function fetcher(url: string, options: RequestInit = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    })

    // 尝试解析JSON响应体
    const responseData = await response.json()

    // 如果响应状态码不是2xx（不成功）
    if (!response.ok) {
      // 抛出一个包含从服务器获取的错误信息的Error对象
      throw new Error(responseData.msg || `请求失败，状态码: ${response.status}`)
    }

    // 如果成功，返回解析后的数据
    return responseData
  }
  catch (error: any) {
    // 捕获所有类型的错误（网络错误、JSON解析错误、服务器返回的错误等）
    console.error('API请求时发生错误:', error)
    // 将错误信息重新抛出，以便UI层能捕获并显示给用户
    throw new Error(error.message || '发生未知错误，请检查网络连接或联系管理员。')
  }
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
