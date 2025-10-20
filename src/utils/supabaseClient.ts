// src/utils/supabaseClient.ts
import { type SupabaseClient, createClient } from '@supabase/supabase-js'

interface EnvLike {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

function readEnv(): EnvLike {
  // ✅ 先读 public/env.js（运行时可改）
  const w = (globalThis as any)?.window
  if (w && w.__ENV__)
    return w.__ENV__ as EnvLike

  // 其次读 Vite 构建注入
  const viteEnv = (import.meta as any)?.env
  if (viteEnv) {
    return {
      VITE_SUPABASE_URL: viteEnv.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: viteEnv.VITE_SUPABASE_ANON_KEY,
    }
  }

  // 最后兜底（极少用到）
  const p = typeof process !== 'undefined' ? (process as any) : undefined
  return {
    VITE_SUPABASE_URL: p?.env?.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: p?.env?.VITE_SUPABASE_ANON_KEY,
  }
}

const env = readEnv()
const SUPABASE_URL = env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // 友好报错：提示去配 env.js 或 .env
  throw new Error(
    '[supabaseClient] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. '
    + '请先在 public/env.js 或 .env.local / .env.production 配置。',
  )
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
