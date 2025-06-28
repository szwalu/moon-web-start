// src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true, // ✅ 自动刷新 token（防止 token 过期后中断）
    persistSession: true, // ✅ 将 session 存入 localStorage
    detectSessionInUrl: true, // ✅ 支持 OAuth 等跳转回来的 token 自动解析
  },
})
