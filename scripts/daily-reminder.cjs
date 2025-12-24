// scripts/daily-reminder.js
const { createClient } = require('@supabase/supabase-js')
const admin = require('firebase-admin')

// 1. 初始化 Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

// 2. 初始化 Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

async function sendDailyReminders() {
  console.log('--- 开始执行定时提醒任务 ---')

  // ==========================================
  // 🔥 核心修改：根据当前时间决定文案
  // ==========================================
  const now = new Date()
  const currentUtcHour = now.getUTCHours() // 获取当前的 UTC 小时 (0-23)

  console.log(`当前 UTC 小时: ${currentUtcHour}`)

  let notifTitle = ''
  let notifBody = ''

  // 判断逻辑：
  // 上午 10:12 PST 运行 -> UTC 是 18:12 -> 小时数是 18 (或者前后有延迟，定为 17-19)
  // 晚上 20:12 PST 运行 -> UTC 是 04:12 -> 小时数是 4  (或者前后有延迟，定为 3-5)

  if (currentUtcHour >= 16 && currentUtcHour <= 20) {
    // ☀️ 第一波：上午 10:12 的提醒 (使用你原来的文案)
    console.log('判定为：上午提醒')
    notifTitle = '📝 每日笔记时间到'
    notifBody = '即使只有一句话，也要记录下今天的闪光点。\nEven one sentence is enough to capture today’s highlight.'
  }
  else {
    // 🌙 第二波：晚上 20:12 的提醒 (使用新设计的文案)
    console.log('判定为：晚上提醒')
    notifTitle = '📝 每日回顾时间到'
    notifBody = '哪怕过得很平凡，也值得回顾下今天的点滴。\nEven an ordinary day is worth looking back on.'
  }

  // ==========================================
  // 3. 获取用户并去重 (防止一人收到两条)
  // ==========================================
  const { data: users, error } = await supabase
    .from('users')
    .select('fcm_token')
    .not('fcm_token', 'is', null)

  if (error) {
    console.error('读取用户失败:', error)
    return
  }

  // 使用 Set 进行去重，防止同一个 Token 出现多次
  const uniqueTokens = [...new Set(users.map(u => u.fcm_token))]
  console.log(`数据库记录: ${users.length} 条，去重后需发送: ${uniqueTokens.length} 台设备`)

  if (uniqueTokens.length === 0) {
    console.log('没有用户订阅，任务结束。')
    return
  }

  // ==========================================
  // 4. 批量发送 (更高效的写法)
  // ==========================================
  const message = {
    notification: {
      title: notifTitle,
      body: notifBody,
    },
    tokens: uniqueTokens, // ⚠️ 注意：这里用 tokens (复数) 配合 sendEachForMulticast
  }

  try {
    const response = await admin.messaging().sendEachForMulticast(message)
    console.log(`✅ 发送成功: ${response.successCount} 条`)
    console.log(`❌ 发送失败: ${response.failureCount} 条`)
  }
  catch (e) {
    console.error('发送过程中出错:', e)
  }
}

sendDailyReminders()
