// src/composables/useSync.ts
import { flushOutbox, setupOnlineAutoFlush } from '@/utils/offline-db'
import { supabase } from '@/utils/supabaseClient'

// 小工具：尽力拿到 uid（先读 session，再读 user）；拿不到就返回 null
async function getUidSoft(): Promise<string | null> {
  try {
    const s = await supabase.auth.getSession()
    const uid1 = s?.data?.session?.user?.id ?? null
    if (uid1)
      return uid1
  }
  catch {}

  try {
    const u = await supabase.auth.getUser()
    return u?.data?.user?.id ?? null
  }
  catch {}

  return null
}

// 等待 auth 就绪（最多等 5 秒）；PWA 场景很关键
async function waitForUid(maxMs = 5000): Promise<string> {
  const start = Date.now()

  // 先同步尝试几次
  for (let i = 0; i < 4; i++) {
    const uid = await getUidSoft()
    if (uid)
      return uid
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  // 订阅一次 auth 事件，谁先来用谁
  return new Promise<string>((resolve, reject) => {
    let settled = false
    let unsubscribe: (() => void) | null = null

    const done = (uid?: string | null) => {
      if (settled)
        return
      settled = true

      if (unsubscribe) {
        try {
          unsubscribe()
        }
        catch {}

        unsubscribe = null
      }

      if (uid)
        resolve(uid)

      else
        reject(new Error('Auth not ready'))
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null
      if (uid)
        done(uid)
    })

    // 保存取消订阅函数
    unsubscribe = () => {
      data?.subscription?.unsubscribe()
    }

    // 同时跑一个定时器超时
    const tick = () => {
      if (Date.now() - start > maxMs) {
        done(null)
        return
      }
      setTimeout(tick, 150)
    }

    tick()
  })
}

// —— 服务端操作封装（供 outbox 冲洗调用）——
// 统一保障 user_id（RLS 403 的根源通常在这里）
const serverOps = {
  insert: async (payload: any) => {
    const uid = await waitForUid()
    const toInsert = { ...payload, user_id: payload?.user_id ?? uid }
    const { data, error } = await supabase.from('notes').insert(toInsert).select()
    if (error)
      throw error
    return data?.[0]
  },
  update: async (id: string, patch: any) => {
    const uid = await waitForUid()
    const { error } = await supabase
      .from('notes')
      .update(patch)
      .eq('id', id)
      .eq('user_id', uid)
    if (error)
      throw error
  },
  remove: async (id: string) => {
    const uid = await waitForUid()
    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', id)
      .eq('user_id', uid)
    if (error)
      throw error
  },
  pin: async (id: string, is_pinned: boolean) => {
    const uid = await waitForUid()
    const { error } = await supabase
      .from('notes')
      .update({ is_pinned })
      .eq('id', id)
      .eq('user_id', uid)
    if (error)
      throw error
  },
}

// —— 组合函数：更“激进”的自动冲洗 ——
// 触发时机：
// 1) 初次启动（setupOnlineAutoFlush 已有）
// 2) online 事件（已有）
// 3) visibilitychange 恢复可见
// 4) pageshow（iOS PWA 从后台回前台常用）
// 5) auth 状态就绪/刷新（SIGNED_IN, INITIAL_SESSION, TOKEN_REFRESHED）
export function useOfflineSync(onSynced?: () => void) {
  // 1/2：已有逻辑（内部会先尝试一次 + 监听 online）
  setupOnlineAutoFlush(serverOps, { onSynced })

  // 3：从后台回前台
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        const tryFlush = async () => {
          try {
            await flushOutbox(serverOps)
            onSynced?.()
          }
          catch {}
        }
        // 立刻一次 + 1.5s 再试 + 5s 再试（PWA 恢复网络/会话经常滞后）
        tryFlush()
        setTimeout(tryFlush, 1500)
        setTimeout(tryFlush, 5000)
      }
    })
  }

  // 4：iOS PWA 场景常用
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', async () => {
      try {
        await flushOutbox(serverOps)
        onSynced?.()
      }
      catch {}
    })
  }

  // 5：auth 就绪/刷新后再冲洗一次（参数以下划线命名，避免未使用报错）
  supabase.auth.onAuthStateChange(async (event, _session) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
      try {
        await flushOutbox(serverOps)
        onSynced?.()
      }
      catch {}
    }
  })

  // 手动触发一次冲洗（页面可挂按钮）
  async function manualSync() {
    await flushOutbox(serverOps)
    onSynced?.()
  }

  return { manualSync }
}
