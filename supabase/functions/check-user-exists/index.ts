// supabase/functions/check-user-exists/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  // 处理浏览器的 OPTIONS 预检请求
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const { email } = await req.json()

    // 创建一个特殊的、拥有管理员权限的 Supabase 客户端
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('CUSTOM_SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // 使用管理员权限查询用户
    const { data, _error } = await supabaseAdmin.auth.admin.getUserByEmail(email)

    // 如果能找到用户（无论是否验证），就意味着邮箱已存在
    if (data.user) {
      return new Response(JSON.stringify({ exists: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // 如果找不到用户，说明邮箱未被注册
    return new Response(JSON.stringify({ exists: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  }
  catch (err) {
    return new Response(String(err?.message ?? err), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
