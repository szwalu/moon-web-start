import { onMounted, onUnmounted } from 'vue'
import { supabase } from '@/utils/supabaseClient'
import { useAuthStore } from '@/stores/auth'

/**
 * 新版本的全局会话管理器。
 * 它的核心职责是：
 * 1. 监听 Supabase 认证状态，并将其同步到 Pinia 的 authStore。
 * 2. 在页面可见时，静默刷新令牌以保持会话活跃。
 */
export function useSupabaseTokenRefresh() {
  const authStore = useAuthStore()

  // 页面可见性变化的处理器
  const handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible') {
      await new Promise(resolve => setTimeout(resolve, 2000))
      await supabase.auth.getSession()
    }
  }

  onMounted(() => {
    // 这是整个应用中【唯一】的 onAuthStateChange 监听器
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      // eslint-disable-next-line no-console
      console.log(`[Global Auth Listener] Event: ${event}`, session)

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        // 当登录或令牌刷新成功时，将用户信息更新到 Pinia store
        authStore.setUser(session?.user ?? null)
        // ✅ 在这里设置最准确的标记
        localStorage.setItem('hasLoggedInBefore', 'true')
      }
      else if (event === 'SIGNED_OUT') {
        // 当登出时，清除 Pinia store 中的用户信息，然后刷新页面
        authStore.clearUser()
        location.reload()
      }
    })

    document.addEventListener('visibilitychange', handleVisibilityChange)

    onUnmounted(() => {
      authListener?.subscription.unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    })
  })
}
