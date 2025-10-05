// src/composables/useSync.ts
import { flushOutbox, setupOnlineAutoFlush } from '@/utils/offline-db'
import { supabase } from '@/utils/supabaseClient'

// 封装服务端操作实现
const serverOps = {
  insert: async (payload: any) => {
    const { data, error } = await supabase.from('notes').insert(payload).select()
    if (error)
      throw error
    return data?.[0]
  },
  update: async (id: string, patch: any) => {
    const { error } = await supabase.from('notes').update(patch).eq('id', id)
    if (error)
      throw error
  },
  remove: async (id: string) => {
    const { error } = await supabase.from('notes').delete().eq('id', id)
    if (error)
      throw error
  },
  pin: async (id: string, is_pinned: boolean) => {
    const { error } = await supabase.from('notes').update({ is_pinned }).eq('id', id)
    if (error)
      throw error
  },
}

// 导出组合函数
export function useOfflineSync() {
  // 启动自动监听（上线立即冲洗）
  setupOnlineAutoFlush(serverOps)

  // 如果你想在某处手动触发同步：
  async function manualSync() {
    await flushOutbox(serverOps)
  }

  return { manualSync }
}
