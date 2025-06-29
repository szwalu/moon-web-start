// src/stores/auth.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/utils/supabaseClient'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<any>(null)
  let hasStarted = false

  async function refreshUser() {
    const { data: { session } } = await supabase.auth.getSession()
    user.value = session?.user ?? null

    // ✅ 确保自动刷新循环只启动一次
    if (session && !hasStarted) {
      await supabase.auth.startAutoRefresh()
      hasStarted = true
    }
  }

  // ✅ 会话状态变化监听（登录/登出/刷新）
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
  })

  return {
    user,
    refreshUser,
  }
})
