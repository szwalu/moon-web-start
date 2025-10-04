// src/composables/useSync.ts
import { flushOutbox, setupOnlineAutoFlush } from '@/utils/offline-db'
import { supabase } from '@/utils/supabaseClient'

// 导出：尽力拿到 uid（先读 session，再读 user）；拿不到就返回 null
export async function getUidSoft(): Promise<string | null> {
  try {
    const s = await supabase.auth.getSession()
    const uid1 = s?.data?.session?.user?.id ?? null
    if (uid1)
      return uid1
  }
  catch {
    // ignore
  }
  try {
    const u = await supabase.auth.getUser()
    const uid2 = u?.data?.user?.id ?? null
    return uid2
  }
  catch {
    // ignore
  }
  return null
}

// 确保会话可用且不过期；必要时刷新
async function ensureSessionFresh(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession()
    const sess = data?.session ?? null
    const expSec = sess?.expires_at ?? 0
    const nowSec = Math.floor(Date.now() / 1000)
    // 若没有会话或即将过期（< 15s），尝试刷新
    if (!sess || expSec - nowSec < 15)
      await supabase.auth.refreshSession()
  }
  catch {
    // 忽略，让后续 onAuthStateChange + tripleFlush 再试
  }
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

    const done = (uid: string | null) => {
      if (settled)
        return

      settled = true
      try {
        unsubscribe?.()
      }
      catch {
        // ignore
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

    // 超时兜底
    const tick = () => {
      const elapsed = Date.now() - start
      if (elapsed > maxMs) {
        done(null)
        return
      }
      setTimeout(tick, 150)
    }
    tick()
  })
}

const serverOps = {
  insert: async (payload: any) => {
    const uid = await waitForUid()
    await ensureSessionFresh() // ★ 新增：保证携带有效 access token
    const toInsert = { ...payload, user_id: payload?.user_id ?? uid }
    const { data, error } = await supabase.from('notes').insert(toInsert).select()
    if (error)
      throw error
    return data?.[0]
  },
  update: async (id: string, patch: any) => {
    const uid = await waitForUid()
    await ensureSessionFresh() // ★ 新增
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
    await ensureSessionFresh() // ★ 新增
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
    await ensureSessionFresh() // ★ 新增
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
// 触发时机：1) 初次启动（setupOnlineAutoFlush 已有） 2) online 事件（已有）
// 3) visibilitychange 恢复可见（连刷三次） 4) pageshow  5) auth 状态就绪/刷新
export function useOfflineSync(onSynced?: () => void) {
  // 1/2：已有逻辑（内部会先尝试一次 + 监听 online）
  setupOnlineAutoFlush(serverOps, { onSynced })

  const tripleFlush = async () => {
    try {
      await flushOutbox(serverOps)
      onSynced?.()
    }
    catch {
      // ignore
    }

    setTimeout(async () => {
      try {
        await flushOutbox(serverOps)
        onSynced?.()
      }
      catch {
        // ignore
      }
    }, 1500)

    setTimeout(async () => {
      try {
        await flushOutbox(serverOps)
        onSynced?.()
      }
      catch {
        // ignore
      }
    }, 5000)

    setTimeout(async () => {
      try {
        await flushOutbox(serverOps)
        onSynced?.()
      }
      catch { /* ignore */ }
    }, 12000)
  }

  // 3：从后台回前台（PWA 常见）
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible')
        tripleFlush()
    })
  }

  // 4：iOS PWA 场景常用
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', () => {
      tripleFlush()
    })
  }

  // 5：auth 就绪/刷新后再冲洗一次
  supabase.auth.onAuthStateChange(async (event) => {
    const need = event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED'
    if (need)
      tripleFlush()
  })

  // 手动触发一次冲洗（如果需要按钮）
  async function manualSync() {
    await flushOutbox(serverOps)
    onSynced?.()
  }

  return { manualSync }
}

// 订阅 auth，缓存 uid（PWA 恢复慢时，flush 也能用这个 uid）
supabase.auth.onAuthStateChange((_event, session) => {
  const uid = session?.user?.id ?? null
  try {
    if (uid && typeof localStorage !== 'undefined')
      localStorage.setItem('last_uid', uid)
  }
  catch {}
})

// 启动时也尝试写一次（若已有会话）
;(async () => {
  try {
    const s = await supabase.auth.getSession()
    const uid = s?.data?.session?.user?.id ?? null
    if (uid && typeof localStorage !== 'undefined')
      localStorage.setItem('last_uid', uid)
  }
  catch {}
})()
