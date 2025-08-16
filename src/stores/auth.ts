// src/stores/auth.ts
import { defineStore } from 'pinia'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/utils/supabaseClient'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
  }),
  actions: {
    // 设置用户的核心 action
    setUser(newUser: User | null) {
      this.user = newUser
    },
    // 清除用户的 action
    clearUser() {
      this.user = null
    },
    // 一个方便的 action，用于从 supabase 获取当前用户并更新 store
    async refreshUser() {
      const { data } = await supabase.auth.getUser()
      this.user = data.user
    },
  },
})
