// src/composables/useSync.ts
import { flushOutbox, setupOnlineAutoFlush } from '@/utils/offline-db'
import { supabase } from '@/utils/supabaseClient'

// 小工具：安全获取当前 uid（无登录时返回 null）
async function getUid() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id ?? null
}

// —— 服务端操作封装（供 outbox 冲洗调用）——
// 统一带 user_id 保障，避免触发 RLS 403
const serverOps = {
  insert: async (payload: any) => {
    const uid = await getUid()
    if (!uid)
      throw new Error('No auth user; cannot insert')
    const toInsert = { ...payload, user_id: uid } // ★ 关键：强制写入 user_id
    const { data, error } = await supabase.from('notes').insert(toInsert).select()
    if (error)
      throw error
    return data?.[0]
  },
  update: async (id: string, patch: any) => {
    const uid = await getUid()
    if (!uid)
      throw new Error('No auth user; cannot update')
    const { error } = await supabase
      .from('notes')
      .update(patch)
      .eq('id', id)
      .eq('user_id', uid) // ★ 关键：按 user_id 约束
    if (error)
      throw error
  },
  remove: async (id: string) => {
    const uid = await getUid()
    if (!uid)
      throw new Error('No auth user; cannot delete')
    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', id)
      .eq('user_id', uid) // ★ 关键：按 user_id 约束
    if (error)
      throw error
  },
  pin: async (id: string, is_pinned: boolean) => {
    const uid = await getUid()
    if (!uid)
      throw new Error('No auth user; cannot pin')
    const { error } = await supabase
      .from('notes')
      .update({ is_pinned })
      .eq('id', id)
      .eq('user_id', uid) // ★ 关键：按 user_id 约束
    if (error)
      throw error
  },
}

// —— 组合函数：启动“上线即冲洗”，并提供手动同步 ——
// 可传入 onSynced 回调（例如在 auth.vue 里触发 fetchNotes 刷新主页）
export function useOfflineSync(onSynced?: () => void) {
  // 上线自动冲洗；页面启动时也会尝试一次
  setupOnlineAutoFlush(serverOps, { onSynced })

  // 手动触发一次冲洗（例如点击“同步”按钮）
  async function manualSync() {
    await flushOutbox(serverOps)
    onSynced?.()
  }

  return { manualSync }
}
