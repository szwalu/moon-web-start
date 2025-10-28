/* eslint-disable no-console */
// ✅ 手动触发即时推送（测试每日提醒是否生效）
// ------------------------------------------------------------
// 用法：
//   1. 在 Supabase 后台设置环境变量（与 daily-push 一样）
//   2. 替换 YOUR_USER_ID_HERE 为你自己的 user_id
//   3. 部署: supabase functions deploy push-now
//   4. 在浏览器 / curl / Postman 访问：
//      https://<project>.supabase.co/functions/v1/push-now
// ------------------------------------------------------------

import * as webpush from 'jsr:@negrel/webpush@0.5.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ====== 环境变量 ======
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!
const VAPID_EXPORTED_JWK = Deno.env.get('VAPID_EXPORTED_JWK')!

// ====== 初始化 ======
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const vapidKeys = await webpush.importVapidKeys(JSON.parse(VAPID_EXPORTED_JWK))
const appServer = await webpush.ApplicationServer.new({
  contactInformation: 'mailto:admin@example.com',
  vapidKeys,
})

// ====== 固定用户 ======
const TARGET_USER_ID = '8e3abbea-2304-4749-bf32-29f1f4797faa' // ← 替换为你自己的 user_id

// ====== 辅助函数 ======
async function sendPush(endpoint: string, p256dh: string, auth: string) {
  const subscriber = appServer.subscribe({
    endpoint,
    keys: { p256dh, auth },
  })

  const payload = JSON.stringify({
    title: '云笔记即时测试通知 ✅',
    body: '如果你看到这条消息，说明云端推送已成功！',
    tag: 'instant-test',
  })

  const res = await subscriber.pushTextMessage(payload, { ttl: 60 })
  return res?.statusCode ?? '(no status)'
}

// ====== 入口函数 ======
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })

  try {
    const { data: subs, error } = await supabase
      .from('web_push_subscriptions')
      .select('endpoint,p256dh,auth,updated_at')
      .eq('user_id', TARGET_USER_ID)
      .order('updated_at', { ascending: false })
      .limit(1)

    if (error)
      throw error
    if (!subs?.length)
      throw new Error('❌ 未找到订阅记录，请先在前端点一次“订阅通知”')

    const s = subs[0]
    const status = await sendPush(s.endpoint, s.p256dh, s.auth)

    console.log(`[push-now] ✅ sent status=${status}`)

    return new Response(
      JSON.stringify({
        ok: true,
        message: '已发送即时测试通知',
        status,
        endpoint: `${s.endpoint.slice(0, 60)}…`,
      }),
      {
        headers: {
          'content-type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    )
  }
  catch (err) {
    console.error('[push-now] ❌ error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }
})
