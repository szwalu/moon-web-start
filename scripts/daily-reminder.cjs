// scripts/daily-reminder.js
const { createClient } = require('@supabase/supabase-js')
const admin = require('firebase-admin')

// 🔍【新增】调试代码：看看环境变量到底传进来了没有？
console.log('--- 调试信息开始 ---');
console.log('SUPABASE_URL 类型:', typeof process.env.SUPABASE_URL);
console.log('SUPABASE_URL 长度:', process.env.SUPABASE_URL ? process.env.SUPABASE_URL.length : 0);
console.log('SUPABASE_URL 内容预览:', process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 5) + '...' : '空值');
console.log('--- 调试信息结束 ---');


// 1. 初始化 Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY, // 注意：这里要用 Service Key (服务端专用)，不能用 Anon Key
)

// 2. 初始化 Firebase Admin (你需要下载一个服务账号 json 文件)
// 在 Firebase 控制台 -> 项目设置 -> 服务账号 -> 生成新的私钥
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

async function sendDailyReminders() {
  console.log('开始执行每日提醒任务...')

  // 3. 从数据库找出所有开启了提醒 (有 token) 的用户
  const { data: users, error } = await supabase
    .from('users')
    .select('fcm_token')
    .not('fcm_token', 'is', null)

  if (error) {
    console.error('读取用户失败:', error)
    return
  }

  console.log(`找到 ${users.length} 个用户需要发送提醒`)

  // 4. 循环发送
  for (const user of users) {
    if (!user.fcm_token)
      continue

    const message = {
      notification: {
        title: '📝 每日回顾时间到',
        body: '即使只有一句话，也要记录下今天的闪光点。',
      },
      token: user.fcm_token,
    }

    try {
      await admin.messaging().send(message)
      console.log('发送成功:', `${user.fcm_token.slice(0, 10)}...`)
    }
    catch (e) {
      console.error('发送失败 (可能 token 过期):', e.message)
      // 可选：如果 token 失效，可以在这里从数据库删除它
    }
  }
}

sendDailyReminders()
