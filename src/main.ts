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
  const { data: { session } } = await supabase.auth.getSession()

  if (session?.user) {
    window.__currentUser = session.user
    return
  }

  return new Promise((resolve) => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      window.__currentUser = session?.user || null
      data.subscription.unsubscribe() // ✅ 正确用法
      resolve()
    })
  })
}

async function setupApp() {
  await setupI18n(app)
  app.use(createPinia())
  app.use(router)

  await waitForSessionInit()

  supabase.auth.onAuthStateChange((_event, session) => {
    window.__currentUser = session?.user || null
  })

  app.mount('#app')
}

setupApp()
