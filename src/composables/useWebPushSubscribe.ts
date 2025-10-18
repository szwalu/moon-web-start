// src/composables/useWebPushSubscribe.ts
import { supabase } from '@/utils/supabaseClient'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i)
  return arr
}

export async function subscribeAndSaveWebPush() {
  // 1) 需要已登录（因为表策略依赖 auth.uid()）
  const { data: userData } = await supabase.auth.getUser()
  const user = userData?.user
  if (!user)
    throw new Error('Not authenticated')

  // 2) SW 已在 App.vue 注册；这里拿到 registration
  const reg = await navigator.serviceWorker.ready

  // 3) 用 VAPID 公钥订阅
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!publicKey)
    throw new Error('Missing VAPID public key')

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })

  // 4) upsert 到数据库（用 endpoint 去重）
  const j = sub.toJSON() as any
  const keys = j.keys || {}
  const { error } = await supabase.from('webpush_subscriptions').upsert({
    user_id: user.id,
    endpoint: sub.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
  })

  if (error)
    throw error
  return true
}
