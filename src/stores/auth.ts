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

    if (session && !hasStarted) {
      await supabase.auth.startAutoRefresh()
      hasStarted = true
    }
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
  })

  return {
    user,
    refreshUser,
  }
}, {
  persist: true, // ✅ 正确的位置：defineStore 的第二个参数
})
