// src/utils/apiClient.ts

import axios from 'axios'

import { supabase } from '@/utils/supabaseClient'

// 确保你有一个统一导出supabase实例的文件

const apiClient = axios.create({
  // 在这里配置你的API基础URL，如果是调用Supabase自身的API，可能不需要
  // baseURL: 'https://your-api.com/api/',
})

// 用于处理并发请求的锁和逻辑
let isRefreshing = false
let failedQueue: Array<{ resolve: (value: unknown) => void; reject: (reason?: any) => void }> = []

function processQueue(error: any, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error)
      prom.reject(error)
    else
      prom.resolve(token)
  })
  failedQueue = []
}

// 1. 请求拦截器 (Request Interceptor)
apiClient.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession()
  const session = data.session

  // 确保每个请求都带上最新的有效令牌
  if (session?.access_token)
    config.headers.Authorization = `Bearer ${session.access_token}`

  return config
}, (error) => {
  return Promise.reject(error)
})

// 2. 响应拦截器 (Response Interceptor)
apiClient.interceptors.response.use(
  (response) => {
    // 对成功的响应不执行任何操作
    return response
  },
  async (error) => {
    const originalRequest = error.config

    // 只处理401 Unauthorized错误，并且该请求之前没有重试过
    if (error.response?.status === 401 && !originalRequest._retry) {
      // 如果正在刷新令牌，则将后续失败的请求存入队列
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then(() => {
          // 当刷新完成后，用新的令牌重试当前请求
          return apiClient(originalRequest)
        })
      }

      originalRequest._retry = true // 标记此请求已尝试重试
      isRefreshing = true

      try {
        // 尝试使用刷新令牌获取新的会话
        const { data, error: refreshError } = await supabase.auth.refreshSession()

        if (refreshError) {
          // 如果刷新令牌失败，说明用户会话已彻底失效
          // 清理队列并抛出错误
          processQueue(refreshError, null)
          // 可以在这里触发全局登出逻辑
          // 例如： supabase.auth.signOut(); window.location.href = '/login';
          throw refreshError
        }

        const newSession = data.session
        // 成功获取新令牌，处理队列中的所有请求
        processQueue(null, newSession?.access_token || null)

        // 使用新令牌重试原始请求
        return apiClient(originalRequest)
      }
      catch (e) {
        // 捕获到任何刷新过程中的错误，并将其传递下去
        return Promise.reject(e)
      }
      finally {
        isRefreshing = false // 解锁
      }
    }

    // 对于非401错误，直接返回失败
    return Promise.reject(error)
  },
)

export default apiClient
