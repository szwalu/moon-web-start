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

const PENDING_KEY = 'pending_webpush_subscription_v1'

/** 仅负责向浏览器申请 Push 订阅，返回 JSON（未涉及登录/数据库） */
export async function createPushSubscription(publicKeyOverride?: string): Promise<any> {
  if (!('serviceWorker' in navigator))
    throw new Error('SW not supported')
  const reg = await navigator.serviceWorker.ready

  // ✅ 优先使用传入的公钥；没有则读环境变量
  const publicKey = publicKeyOverride || import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!publicKey)
    throw new Error('Missing VAPID public key')

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })

  return sub.toJSON()
}

export async function savePushSubscription(subJson: any): Promise<void> {
  const { data: userData } = await supabase.auth.getUser()
  const user = userData?.user
  if (!user)
    throw new Error('NEED_LOGIN')

  const keys = subJson?.keys || {}
  const { error } = await supabase.from('webpush_subscriptions').upsert({
    user_id: user.id,
    endpoint: subJson?.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
  })
  if (error)
    throw error
}

export async function flushPendingSubscriptionIfAny() {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw)
      return
    const subJson = JSON.parse(raw)
    await savePushSubscription(subJson)
    localStorage.removeItem(PENDING_KEY)
  }
  catch {}
}

export function savePendingLocal(subJson: any) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(subJson))
  }
  catch {}
}
