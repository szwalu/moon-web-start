// main.ts
import 'uno.css'
import '@/styles/index.scss'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import piniaPersistedstate from 'pinia-plugin-persistedstate'

// ✅ 导入插件
import App from './App.vue'
import router from './router'
import { setupI18n } from './utils'

const app = createApp(App)

async function setupApp() {
  await setupI18n(app)

  const pinia = createPinia() // ✅ 单独创建 pinia 实例
  pinia.use(piniaPersistedstate) // ✅ 使用持久化插件

  app.use(pinia)
  app.use(router)
  app.mount('#app')
}

setupApp()
