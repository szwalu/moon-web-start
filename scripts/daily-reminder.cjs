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
  // 🔥 核心逻辑：根据 UTC 时间判断早晚
  // ==========================================
  const now = new Date()
  const currentUtcHour = now.getUTCHours()

  console.log(`当前 UTC 小时: ${currentUtcHour}`)

  let notifTitle = ''
  let notifBody = ''
  // 默认为空，不带红点
  let dataPayload = {}

  // 判断逻辑：
  // 上午 09:12 PST = UTC 17:12 -> 范围大致在 16 - 20 之间
  // 晚上 20:12 PST = UTC 04:12 -> 范围在其他时间
  if (currentUtcHour >= 16 && currentUtcHour <= 20) {
    // ☀️ 早晨：使用“笔记时间”文案 + 🔴 带红点
    console.log('判定为：上午提醒 (带红点)')
    notifTitle = '📝 每日笔记时间到'
    notifBody = '即使只有一句话，也要记录下今天的闪光点。\nEven one sentence is enough to capture today’s highlight.'

    // 写入红点数据
    dataPayload = {
      badge_count: '1',
    }
  }
  else {
    // 🌙 晚上：使用“回顾时间”文案 + ⚪️ 不带红点
    console.log('判定为：晚上提醒 (无红点)')
    notifTitle = '📝 每日回顾时间到'
    notifBody = '哪怕过得很平凡，也值得回顾下今天的点滴。\nEven an ordinary day is worth looking back on.'

    // dataPayload 保持为空
  }

  console.log('🔥 正在进行强制红点测试 🔥')
  dataPayload = { badge_count: '1' }

  // ==========================================
  // 3. 获取用户并去重
  // ==========================================
  const { data: users, error } = await supabase
    .from('users')
    .select('fcm_token')
    .not('fcm_token', 'is', null)

  if (error) {
    console.error('读取用户失败:', error)
    return
  }

  const uniqueTokens = [...new Set(users.map(u => u.fcm_token))]
  console.log(`需发送设备数: ${uniqueTokens.length}`)

  if (uniqueTokens.length === 0)
    return

  // ==========================================
  // 4. 发送消息
  // ==========================================
  const message = {
    notification: {
      title: notifTitle,
      body: notifBody,
    },
    // 将 data 数据（包含可能的 badge）放入消息
    data: dataPayload,
    tokens: uniqueTokens,
  }

  try {
    const response = await admin.messaging().sendEachForMulticast(message)
    console.log(`✅ 发送成功: ${response.successCount}`)
    console.log(`❌ 发送失败: ${response.failureCount}`)
  }
  catch (e) {
    console.error('发送出错:', e)
  }
}

sendDailyReminders()
