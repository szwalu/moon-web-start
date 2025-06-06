// 文件路径: src/api/index.ts

// 封装一个通用的 fetch 函数
async function fetcher(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })

  if (!response.ok) {
    // 如果服务器返回错误状态码，尝试解析错误信息
    const errorData = await response.json().catch(() => ({ msg: '无法解析错误信息' }))
    throw new Error(errorData.msg || `请求失败，状态码: ${response.status}`)
  }

  return response.json()
}

// “存储数据”的请求函数
export function reqPostData(body: { id: string; data: any }) {
  // URL指向我们新建的Vercel云函数
  return fetcher('/api/storeData', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// “读取数据”的请求函数
export function reqGetData(id: string) {
  // URL指向我们新建的Vercel云函数，并通过查询参数传递ID
  return fetcher(`/api/readData?id=${id}`)
}
