// supabase/functions/clean-orphan-audios/index.ts
// Deno Deploy (Supabase Edge Functions)

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

interface OrphanReport {
  bucket: string
  graceDays: number
  totalObjects: number
  referenced: number
  orphans: number
  deleted?: number
  paths?: string[]
}

const BUCKET = 'note-audios'

// 默认 7 天宽限期（只清理创建时间早于此的对象）
function getGraceDays(url: URL): number {
  const fromQuery = url.searchParams.get('graceDays')
  const n = fromQuery ? Number.parseInt(fromQuery, 10) : Number.NaN
  if (Number.isFinite(n) && n >= 0)
    return n

  const env = Deno.env.get('GRACE_DAYS')
  const envN = env ? Number.parseInt(env, 10) : Number.NaN
  if (Number.isFinite(envN) && envN >= 0)
    return envN

  return 7
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const dryRun = url.searchParams.get('dryRun') === '1'
    const graceDays = getGraceDays(url)

    const supabaseUrl = Deno.env.get('PROJECT_URL')!
    // ⚠️ 必须配置为 Service Role 才能安全删除 Storage 对象
    const serviceKey = Deno.env.get('SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { headers: { 'X-Client-Info': 'clean-orphan-audios' } },
    })

    // 1) 取出“被笔记引用的相对路径集合”
    //    这里调用我们刚建好的 rpc_collect_note_audio_paths
    const { data: refRows, error: refErr } = await admin.rpc(
      'rpc_collect_note_audio_paths',
    )
    if (refErr)
      throw refErr

    const referenced = new Set<string>((refRows || []) as string[])

    // 2) 列出该桶所有对象（名字就是相对路径）
    //    复用已有的 rpc_list_storage_objects
    const { data: allObjs, error: objErr } = await admin.rpc(
      'rpc_list_storage_objects',
      { p_bucket: BUCKET },
    )
    if (objErr)
      throw objErr

    // 3) 过滤“未引用 & 过了宽限期”的对象
    const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000)
    const orphans = (allObjs || [])
      .filter((o: any) => !referenced.has(o.name))
      .filter((o: any) => new Date(o.created_at) < cutoff)
      .map((o: any) => o.name)

    let deleted = 0
    if (!dryRun && orphans.length > 0) {
      // 按 1k 一组分片删除（防止一次性过长）
      const chunk = 1000
      for (let i = 0; i < orphans.length; i += chunk) {
        const batch = orphans.slice(i, i + chunk)
        const { error: delErr } = await admin.storage.from(BUCKET).remove(batch)
        if (delErr)
          throw delErr
        deleted += batch.length
      }
    }

    const report: OrphanReport = {
      bucket: BUCKET,
      graceDays,
      totalObjects: (allObjs || []).length,
      referenced: referenced.size,
      orphans: orphans.length,
      deleted: dryRun ? 0 : deleted,
      paths: dryRun ? orphans : undefined, // 预演返回名单以便核对
    }

    return new Response(JSON.stringify(report, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }
  catch (e: any) {
    return new Response(
      JSON.stringify({ error: String(e?.message || e) }, null, 2),
      { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } },
    )
  }
})
