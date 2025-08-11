// src/composables/useSupabaseTokenRefresh.ts
import { onMounted, onUnmounted } from 'vue'
import { supabase } from '@/utils/supabaseClient'

let refreshTimer: ReturnType<typeof setTimeout> | null = null
const REFRESH_DELAY = 20 // 过期后20秒刷新页面
let networkRetries = 0
const MAX_NETWORK_RETRIES = 5

// 强健的网络等待函数
async function waitForNetworkRecovery(): Promise<void> {
  return new Promise((resolve) => {
    if (navigator.onLine)
      return resolve()

    const handleOnline = () => {
      window.removeEventListener('online', handleOnline)
      // 额外等待500ms确保网络堆栈就绪
      setTimeout(resolve, 500)
    }

    window.addEventListener('online', handleOnline)
  })
}

export function useSupabaseTokenRefresh() {
  // 设置刷新定时器
  function setupRefreshTimer(expiresAt: number) {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }

    const now = Math.floor(Date.now() / 1000)
    const timeLeft = expiresAt - now
    const refreshInSeconds = timeLeft <= 0 ? REFRESH_DELAY : timeLeft + REFRESH_DELAY

    // console.log(`[刷新定时器] 页面将在 ${refreshInSeconds} 秒后刷新`)

    refreshTimer = setTimeout(() => {
      // console.log('[刷新定时器] 令牌已过期，刷新页面以重新登录')
      location.reload()
    }, refreshInSeconds * 1000)
  }

  // 强化的会话刷新逻辑
  const handleSessionRefresh = async () => {
    try {
      // 在网络不稳定时尝试恢复
      await waitForNetworkRecovery()
      networkRetries = 0 // 重置计数器

      const { data, error } = await supabase.auth.getSession()

      if (error) {
        // 特殊处理网络相关的刷新错误
        if (error.message.includes('Failed to fetch') || error.message.includes('NETWORK'))
          throw new Error('NETWORK_ERROR')

        throw error
      }

      if (data?.session) {
        // console.log('[刷新] 成功获取会话，有效期至:', new Date(data.session.expires_at * 1000))
        setupRefreshTimer(data.session.expires_at)
      }
      else {
        // console.log('[刷新] ❗ 无有效会话，刷新页面')
        location.reload()
      }
    }
    catch (error) {
      console.warn('[刷新] 会话获取失败:', error.message)

      // 网络错误专用处理
      if (error.message.includes('NETWORK_ERROR')) {
        networkRetries++

        if (networkRetries >= MAX_NETWORK_RETRIES) {
          // console.error('[刷新] 网络重试超过最大次数，刷新页面')
          location.reload()
          return
        }

        const backoffTime = 2000 * networkRetries
        console.warn(`[刷新] 网络不稳定，${backoffTime / 1000}秒后重试 (${networkRetries}/${MAX_NETWORK_RETRIES})`)
        await new Promise(resolve => setTimeout(resolve, backoffTime))
        return handleSessionRefresh()
      }

      // 处理其他类型的错误
      // console.error('[刷新] 无法恢复的异常，刷新页面:', error)
      location.reload()
    }
  }

  // 替换为带超时保护的唤醒处理流程
  const handleAwakeRefresh = async () => {
  // console.log('[唤醒] 开始处理唤醒流程')

    // 添加全局超时机制（20秒）
    let globalTimeoutId: ReturnType<typeof setTimeout> | null = null
    const globalTimeoutPromise = new Promise((_, reject) => {
      globalTimeoutId = setTimeout(() => {
        reject(new Error('唤醒处理超时（20秒）'))
      }, 20000) // 20秒全局超时
    })

    try {
    // 步骤1: 系统恢复等待（1.5秒） + 超时保护
      await Promise.race([
        new Promise(resolve => setTimeout(resolve, 1500)),
        globalTimeoutPromise,
      ])

      // 步骤2: 网络恢复等待 + 超时保护
      await Promise.race([
        waitForNetworkRecovery(),
        globalTimeoutPromise,
      ])

      // console.log('[唤醒] 网络就绪，开始刷新会话')

      // 步骤3: 会话刷新 + 超时保护
      await Promise.race([
        handleSessionRefresh(),
        globalTimeoutPromise,
      ])

      //  console.log('[唤醒] 刷新会话成功')
    }
    catch (error) {
      //  console.error('[唤醒] 不可恢复的异常:', error.message)

      // 特殊处理超时错误
      if (error.message.includes('唤醒处理超时')) {
      // console.error('[唤醒] ⚠️ 处理超过20秒，强制刷新页面')
      }
      else {
      // console.error('[唤醒] ⚠️ 其他错误，强制刷新页面')
      }

      location.reload()
    }
    finally {
    // 清理超时定时器
      if (globalTimeoutId)
        clearTimeout(globalTimeoutId)
    }
  }

  onMounted(async () => {
    // 初始化定时器
    setTimeout(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (data?.session)
          setupRefreshTimer(data.session.expires_at)
      }
      catch (error) {
        // console.error('[初始化] 会话获取失败:', error)
      }
    }, 1000)

    // 可见性变化处理
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // console.log('[可见性] 页面恢复前台状态')
        handleAwakeRefresh()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    onUnmounted(() => {
      if (refreshTimer)
        clearTimeout(refreshTimer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    })
  })
}
