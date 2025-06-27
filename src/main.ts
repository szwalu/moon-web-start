import 'uno.css'
import '@/styles/index.scss'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { setupI18n } from './utils'
import { supabase } from '@/utils/supabaseClient'

const app = createApp(App)

async function waitForSessionInit(): Promise<void> {
  // ✅ Step 1: 启用自动刷新机制
  supabase.auth.startAutoRefresh()

  // ✅ Step 2: 强制读取本地缓存 session
  const { data: { session } } = await supabase.auth.getSession()

  if (session?.user) {
    window.__currentUser = session.user
    return
  }

  // ✅ Step 3: 等待首次登录状态事件
  return new Promise((resolve) => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      window.__currentUser = session?.user || null
      data.subscription.unsubscribe()
      resolve()
    })
  })
}

async function setupApp() {
  await setupI18n(app)
  app.use(createPinia())
  app.use(router)

  await waitForSessionInit()

  // ✅ 后续状态监听（如自动刷新 token、登出等）
  supabase.auth.onAuthStateChange((_event, session) => {
    window.__currentUser = session?.user || null
    // console.log('[auth event]', _event, session)
  })

  // ✅ 监听页面恢复事件，避免 iOS 假登出（新增）
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        await supabase.auth.refreshSession()
        window.__currentUser = session.user
        // console.log('[visibilitychange] Session refreshed:', session)
      }
      else {
        window.__currentUser = null
        // console.log('[visibilitychange] No active session')
      }
    }
  })

  app.mount('#app')
}

setupApp()
