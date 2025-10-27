/* eslint-disable no-console */
// supabase/functions/push-cron/index.ts
/// <reference lib="deno.unstable" />

import * as webpush from 'jsr:@negrel/webpush@0.5.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

interface SubRow {
  endpoint: string
  p256dh: string
  auth: string
  timezone: string
  target_hour: number
  target_minute: number
  last_sent_key: string | null
  user_id?: string
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!
const VAPID_EXPORTED_JWK = Deno.env.get('VAPID_EXPORTED_JWK')!

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}
const JSON_CORS_HEADERS = { ...JSON_HEADERS, ...CORS_HEADERS }

// —— 可选：常驻一个调试尾巴（仅用于 Test 强制直发时默认值） —— //
const DEFAULT_FORCE_TAIL = 'q_Jx8kBlumHC'

// —— 时间工具 —— //
function nowPartsInZone(tz: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(new Date())
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === t)?.value ?? ''
  const yyyy = get('year')
  const mm = get('month')
  const dd = get('day')
  const HH = get('hour')
  const MM = get('minute')
  return { date: `${yyyy}-${mm}-${dd}`, HH, MM }
}
function makeMinuteKey(tz: string) {
  const { date, HH, MM } = nowPartsInZone(tz)
  return `${date}T${HH}:${MM}@${tz}`
}
function tail12(endpoint: string) {
  return endpoint.slice(-12)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: CORS_HEADERS })

  try {
    const supabase = supabaseAdmin

    // 允许 Test 时传入“强制直发”的尾巴或完整 endpoint（仅用于排障）
    let forceTail = DEFAULT_FORCE_TAIL
    let forceEndpoint = ''
    try {
      const isJson = req.method === 'POST' && req.headers.get('content-type')?.includes('application/json')
      if (isJson) {
        const body = await req.json().catch(() => ({} as any))
        if (body && body.force_endpoint_tail)
          forceTail = String(body.force_endpoint_tail).trim()

        const fe = (body?.force_endpoint ?? '').toString().trim()
        forceEndpoint = fe
      }
    }
    catch (err) {
      // ignore body parse errors
      console.log('[push-cron] body parse skipped:', (err as any)?.message ?? String(err))
    }
    const hasForce = Boolean(forceTail) || Boolean(forceEndpoint)

    // 导入 VAPID
    const exported = JSON.parse(VAPID_EXPORTED_JWK)
    const vapidKeys = await webpush.importVapidKeys(exported)
    const appServer = await webpush.ApplicationServer.new({
      contactInformation: 'mailto:admin@example.com',
      vapidKeys,
    })

    // =============== A) 正常分钟调度路径 =============== //
    const { data: tzRows, error: tzErr } = await supabase
      .from('web_push_subscriptions')
      .select('timezone')
      .not('timezone', 'is', null)
      .neq('timezone', '')
      .order('timezone')
      .limit(10000)

    if (tzErr) {
      return new Response(JSON.stringify({ error: tzErr.message }), {
        status: 500,
        headers: JSON_CORS_HEADERS,
      })
    }

    const tzSet = new Set<string>()
    for (const r of (tzRows ?? []) as Array<{ timezone: string }>) {
      if (r?.timezone)
        tzSet.add(r.timezone)
    }

    const candidates: SubRow[] = []
    const sampleRows: Array<{
      tail: string
      tz: string
      th: number
      tm: number
      lsk: string | null
      now_key: string
      hit_hour_now: boolean
      hit_minute_now: boolean
      already_sent_this_minute: boolean
    }> = []

    for (const tz of tzSet) {
      try {
        const { HH, MM } = nowPartsInZone(tz)
        const hour = Number(HH)
        const minute = Number(MM)
        const minuteKey = makeMinuteKey(tz)

        const { data: rows, error: rowsErr } = await supabase
          .from('web_push_subscriptions')
          .select('endpoint,p256dh,auth,timezone,target_hour,target_minute,last_sent_key')
          .eq('timezone', tz)
          .eq('target_hour', hour)
          .eq('target_minute', minute)
          .limit(10000)

        if (rowsErr)
          continue

        const list = (rows ?? []) as SubRow[]
        for (const s of list) {
          const { HH: h2, MM: m2 } = nowPartsInZone(s.timezone)
          const hitH = Number(h2) === s.target_hour
          const hitM = Number(m2) === s.target_minute
          const notSentThisMinute = s.last_sent_key !== minuteKey

          if (sampleRows.length < 3) {
            sampleRows.push({
              tail: tail12(s.endpoint),
              tz: s.timezone,
              th: s.target_hour,
              tm: s.target_minute,
              lsk: s.last_sent_key,
              now_key: minuteKey,
              hit_hour_now: hitH,
              hit_minute_now: hitM,
              already_sent_this_minute: !notSentThisMinute,
            })
          }

          if (hitH && hitM && notSentThisMinute)
            candidates.push(s)
        }
      }
      catch (err) {
        // ignore illegal timezones, etc.
        console.log('[push-cron] per-tz scan skipped:', (err as any)?.message ?? String(err))
      }
    }

    // =============== B) 强制直发（仅 Test 用） =============== //
    if (candidates.length === 0 && hasForce) {
      let q = supabase
        .from('web_push_subscriptions')
        .select('endpoint,p256dh,auth,timezone,target_hour,target_minute,last_sent_key')
        .limit(1)

      if (forceEndpoint)
        q = q.eq('endpoint', forceEndpoint)
      else if (forceTail)
        q = q.like('endpoint', `%${forceTail}`)

      const { data: forceRows } = await q
      if (forceRows && forceRows.length > 0) {
        const one = forceRows[0] as SubRow
        candidates.push(one)
      }
    }

    if (candidates.length === 0) {
      console.log(
        JSON.stringify({
          scanned_timezones: tzSet.size,
          matched: 0,
          sent: 0,
          endpoint_tails_sent: [],
          endpoint_tails_failed: [],
          failures: [],
          sample_rows: sampleRows,
          force_tail_used: forceTail || null,
          force_endpoint_used: forceEndpoint || null,
        }),
      )
      return new Response(
        JSON.stringify({
          ok: true,
          scanned_timezones: tzSet.size,
          matched: 0,
          sent: 0,
          results: [],
        }),
        { headers: JSON_CORS_HEADERS },
      )
    }

    // 统一 payload
    const payload = JSON.stringify({
      title: '记得写笔记哟',
      body: hasForce ? '（force 测试）直发到此订阅' : '每日提醒：写 1 条笔记记录今天 ✍️',
      tag: 'daily-note',
      data: { url: '/auth' },
    })

    const results: Array<{ endpoint: string; ok: boolean; status?: number; error?: string; timezone?: string }> = []
    const updates: Array<{ endpoint: string; last_sent_key: string }> = []
    const failureTails: string[] = []
    const failureCodes: number[] = []

    await Promise.allSettled(
      candidates.map(async (s) => {
        const minuteKey = makeMinuteKey(s.timezone)
        try {
          const subscriber = appServer.subscribe({
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          })
          await subscriber.pushTextMessage(payload, { ttl: 60 })

          results.push({ endpoint: s.endpoint, ok: true, timezone: s.timezone })
          updates.push({ endpoint: s.endpoint, last_sent_key: minuteKey })
        }
        catch (e) {
          const status
            = (e && typeof (e as any).statusCode === 'number') ? (e as any).statusCode : 0
          const msg = (e as any)?.message ?? String(e ?? 'unknown error')

          results.push({ endpoint: s.endpoint, ok: false, status, error: msg, timezone: s.timezone })
          failureTails.push(tail12(s.endpoint))
          if (status)
            failureCodes.push(status)

          if (status === 404 || status === 410) {
            try {
              await supabase
                .from('web_push_subscriptions')
                .delete()
                .eq('endpoint', s.endpoint)
            }
            catch (errDel) {
              // ignore deletion failure
              console.log('[push-cron] cleanup failed:', (errDel as any)?.message ?? String(errDel))
            }
          }
        }
      }),
    )

    if (updates.length > 0) {
      const tasks = updates.map((u) => {
        return supabase
          .from('web_push_subscriptions')
          .update({ last_sent_key: u.last_sent_key })
          .eq('endpoint', u.endpoint)
      })

      await Promise.allSettled(tasks)
    }

    const sent = results.filter(r => r.ok).length
    const tailsOk = results.filter(r => r.ok).map(r => tail12(r.endpoint))

    // —— 新增：把本轮结果写入 push_logs —— //
    try {
      const logs = results.map((r) => {
        const tz = r.timezone ?? 'unknown'
        const minuteKey = tz ? makeMinuteKey(tz) : ''
        return {
          endpoint_tail: tail12(r.endpoint),
          timezone: tz,
          minute_key: minuteKey,
          status: r.ok ? 'ok' : 'fail',
          status_code: r.status ?? null,
          error: r.error ?? null,
          user_id: null,
        }
      })

      if (logs.length > 0)
        await supabase.from('push_logs').insert(logs)
    }
    catch (e) {
      // 写日志失败不影响主流程
      console.log('[push-cron] write logs failed:', (e as any)?.message ?? String(e))
    }

    console.log(
      JSON.stringify({
        scanned_timezones: tzSet.size,
        matched: candidates.length,
        sent,
        endpoint_tails_sent: tailsOk,
        endpoint_tails_failed: failureTails,
        failure_status_codes: failureCodes,
        force_tail_used: forceTail || null,
        force_endpoint_used: forceEndpoint || null,
      }),
    )

    return new Response(
      JSON.stringify({
        ok: true,
        scanned_timezones: tzSet.size,
        matched: candidates.length,
        sent,
        results: results.map(r => ({ ...r, endpoint: tail12(r.endpoint) })),
      }),
      { headers: JSON_CORS_HEADERS },
    )
  }
  catch (e) {
    return new Response(
      JSON.stringify({ error: (e as any)?.message ?? 'unknown error' }),
      { status: 500, headers: JSON_CORS_HEADERS },
    )
  }
})
