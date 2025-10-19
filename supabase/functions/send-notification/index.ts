// supabase/functions/send-notification/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const SUPABASE_URL = Deno.env.get('PROJECT_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')
const CRON_SECRET = Deno.env.get('CRON_SECRET')

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  // 简单鉴权
  if (CRON_SECRET) {
    const h = req.headers.get('x-cron-secret')
    if (h !== CRON_SECRET)
      return json(401, { error: 'unauthorized: bad x-cron-secret' })
  }

  // 校验 env
  const missing: string[] = []
  if (!SUPABASE_URL)
    missing.push('PROJECT_URL')
  if (!SERVICE_ROLE_KEY)
    missing.push('SERVICE_ROLE_KEY')
  if (!VAPID_PUBLIC_KEY)
    missing.push('VAPID_PUBLIC_KEY')
  if (!VAPID_PRIVATE_KEY)
    missing.push('VAPID_PRIVATE_KEY')
  if (missing.length)
    return json(500, { error: 'env_missing', missing })

  // 初始化
  let supabase
  try {
    supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!)
  }
  catch (e) {
    return json(500, { error: 'createClient_failed', message: String(e) })
  }
  try {
    webpush.setVapidDetails('mailto:you@example.com', VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!)
  }
  catch (e) {
    return json(500, { error: 'vapid_init_failed', message: String(e) })
  }

  // 接收可选 payload
  let payload = { title: '云笔记 · 每日提醒', body: '来写点今天的笔记吧～', url: '/' }
  try {
    if (req.method === 'POST') {
      const data = await req.json().catch(() => null)
      if (data && (data.title || data.body || data.url)) {
        payload = {
          title: data.title || payload.title,
          body: data.body || payload.body,
          url: data.url || payload.url,
        }
      }
    }
  }
  catch { /* ignore */ }

  // 取订阅
  const { data: subs, error: selErr } = await supabase
    .from('webpush_subscriptions')
    .select('endpoint, p256dh, auth')

  if (selErr)
    return json(500, { error: 'select_failed', message: selErr.message })
  if (!subs?.length)
    return json(200, { ok: 0, fail: 0, removed: 0, subs: 0, details: [] })

  // 发送
  let ok = 0
  let fail = 0
  let removed = 0
  const toDelete: string[] = []
  const details: Array<{ endpoint: string; code: number; error?: string }> = []

  await Promise.all(
    subs.map(async (s: any) => {
      const ep: string = s.endpoint || ''
      const isApple = ep.includes('web.push.apple.com')

      // Apple 更偏好 {notification:{...}}；其他浏览器扁平即可
      const body = isApple
        ? JSON.stringify({ notification: payload })
        : JSON.stringify(payload)

      try {
        await webpush.sendNotification(
          { endpoint: ep, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        )
        ok++
        details.push({ endpoint: ep, code: 200 })
      }
      catch (e: any) {
        fail++
        const code = e?.statusCode || e?.status || 0
        const msg = e?.body || e?.message || String(e)
        details.push({ endpoint: ep, code, error: msg })
        if (code === 404 || code === 410)
          toDelete.push(ep)
      }
    }),
  )

  if (toDelete.length > 0) {
    const delRes = await supabase.from('webpush_subscriptions').delete().in('endpoint', toDelete)
    if (!delRes.error)
      removed = toDelete.length
  }

  return json(200, { ok, fail, removed, subs: subs.length, details })
})
