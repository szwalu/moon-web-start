import 'uno.css'
import '@/styles/index.scss'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { setupI18n } from './utils'

// ✅ 新增：导入 supabase
import { supabase } from '@/utils/supabaseClient'

const app = createApp(App)

async function setupApp() {
  await setupI18n(app)

  app.use(createPinia())
  app.use(router)

  // ✅ 定义全局变量：保存当前用户（全局可访问）
  window.__currentUser = null

  // ✅ 尝试恢复 session
  const { data: { session } } = await supabase.auth.getSession()
  if (session && session.user) {
    //  console.log('✅ 恢复登录状态：', session.user.email)
    window.__currentUser = session.user
  }
  else {
    // console.log('⛔ 当前未登录')
  }

  // ✅ 监听登录和登出事件
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
      // console.log('✅ 用户登录：', session?.user.email)
      window.__currentUser = session?.user || null
    }
    if (event === 'SIGNED_OUT') {
      // console.warn('⛔️ 用户登出')
      window.__currentUser = null
    }
  })

  app.mount('#app')
}

setupApp()
