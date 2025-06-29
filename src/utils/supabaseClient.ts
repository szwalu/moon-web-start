// src/utils/supabaseClient.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true, // ✅ 启用自动刷新 token
    persistSession: true, // ✅ 持久化 session（localStorage/IndexedDB）
    detectSessionInUrl: true, // 默认支持 OAuth 等场景
  },
})
