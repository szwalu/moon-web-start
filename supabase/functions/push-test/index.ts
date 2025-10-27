// supabase/functions/push-test/index.ts
/// <reference lib="deno.unstable" />

// 1) Deno 版 Web Push（JSR）
import * as webpush from 'jsr:@negrel/webpush@0.5.0'

// 2) Supabase JS 客户端（Edge 运行时）
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

interface SubRow {
  endpoint: string
  p256dh: string
  auth: string
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const VAPID_EXPORTED_JWK = Deno.env.get('VAPID_EXPORTED_JWK') // ← 你刚设置的 JWK JSON

// —— CORS 相关 —— //
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

// 基础 JSON 头
const BASE_JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

// 组合后的“JSON + CORS”头
const JSON_CORS_HEADERS = { ...BASE_JSON_HEADERS, ...CORS_HEADERS }

Deno.serve(async (req) => {
  // —— A) 预检请求处理（必须返回 200 且附带 CORS 头）—— //
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: CORS_HEADERS })

  try {
    // —— 0) 鉴权：沿用前端会话的 JWT，让 RLS 生效 —— //
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false, detectSessionInUrl: false },
    })

    const { data: userInfo } = await supabase.auth.getUser()
    if (!userInfo?.user) {
      return new Response(JSON.stringify({ error: 'unauthenticated' }), {
        status: 401,
        headers: JSON_CORS_HEADERS,
      })
    }

    // —— 1) 导入 VAPID（JWK JSON）并创建 ApplicationServer —— //
    if (!VAPID_EXPORTED_JWK) {
      return new Response(JSON.stringify({ error: 'Missing VAPID_EXPORTED_JWK' }), {
        status: 500,
        headers: JSON_CORS_HEADERS,
      })
    }
    const exported = JSON.parse(VAPID_EXPORTED_JWK) // { publicKey, privateKey }
    const vapidKeys = await webpush.importVapidKeys(exported)
    const appServer = await webpush.ApplicationServer.new({
      // 建议改成你的联系邮箱或站点链接
      contactInformation: 'mailto:admin@example.com',
      vapidKeys,
    })

    // —— 2) 查询当前用户的订阅（受 RLS 约束）—— //
    const { data: subs, error } = await supabase
      .from('web_push_subscriptions')
      .select('endpoint,p256dh,auth')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: JSON_CORS_HEADERS,
      })
    }
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, results: [] }), {
        headers: JSON_CORS_HEADERS,
      })
    }

    // —— 3) 组装 payload（与 SW 中的 push 解析保持一致）—— //
    const payload = JSON.stringify({
      title: '记得写笔记哟',
      body: '（push-test）来自云端的测试推送',
      tag: 'daily-note',
      data: { url: '/auth' }, // SW 的 notificationclick 跳到 /auth
    })

    // —— 4) 逐个发送；404/410 视为失效，顺带清理 —— //
    const results: Array<{ endpoint: string; ok: boolean; status?: number; error?: string }> = []

    await Promise.allSettled(
      (subs as SubRow[]).map(async (s) => {
        try {
          const subscriber = appServer.subscribe({
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          })

          // 发送文本负载
          await subscriber.pushTextMessage(payload, { ttl: 60 })
          results.push({ endpoint: s.endpoint, ok: true })
        }
        catch (e) {
          const status = (e && typeof (e as any).statusCode === 'number') ? (e as any).statusCode : 0
          const msg = (e as any)?.message ?? String(e ?? 'unknown error')
          results.push({ endpoint: s.endpoint, ok: false, status, error: msg })

          // 404 / 410 代表订阅失效：清理数据库
          if (status === 404 || status === 410) {
            try {
              await supabase.from('web_push_subscriptions').delete().eq('endpoint', s.endpoint)
            }
            catch {
              // 清理失败忽略
            }
          }
        }
      }),
    )

    return new Response(JSON.stringify({ ok: true, sent: results.filter(r => r.ok).length, results }), {
      headers: JSON_CORS_HEADERS,
    })
  }
  catch (e) {
    return new Response(JSON.stringify({ error: (e as any)?.message ?? 'unknown error' }), {
      status: 500,
      headers: JSON_CORS_HEADERS,
    })
  }
})
