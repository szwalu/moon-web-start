import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  try {
    const { type, message, email } = await req.json()

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const toEmail = Deno.env.get('TO_EMAIL')
    const fromEmail = 'feedback@woabc.com'

    // ✅ 显示中文类型名
    const typeLabelMap: Record<string, string> = {
      'apply-site': '网站收录申请',
      'apply-link': '友情链接申请',
      'feedback': '意见反馈',
    }
    const typeKey = (type || '').toString().trim()
    const typeLabel = typeLabelMap[typeKey] || typeKey

    // ✅ 附加信息
    const now = new Date()
    const time = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const ip = req.headers.get('x-forwarded-for') || '未知'
    const referer = req.headers.get('referer') || '未知页面'

    const subject = `📬 新反馈：${typeLabel}`

    const html = `
      <p><strong>类型：</strong> ${typeLabel}</p>
      <p><strong>内容：</strong><br/>${message?.replace(/\n/g, '<br/>')}</p>
      <p><strong>邮箱：</strong> ${email || '未填写'}</p>
      <hr/>
      <p><strong>提交时间：</strong> ${time}</p>
      <p><strong>IP 地址：</strong> ${ip}</p>
      <p><strong>来源页面：</strong> ${referer}</p>
    `

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmail,
        subject,
        html,
      }),
    })

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    // console.log('Resend API 返回:', response.status, resText)
    // console.log('Resend API 返回:', response.status, resText)

    if (!response.ok)
      return new Response('邮件发送失败', { status: 500, headers })

    return new Response('发送成功', { status: 200, headers })
  }
  catch (err) {
    console.error('函数内部错误:', err)
    return new Response('服务器内部错误', {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }
})
