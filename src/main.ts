// main.ts

// ✅ 立即判断并设置暗黑模式，防止刷新页面先黑一下再变白
// ✅ 引入样式
import 'uno.css'
import '@/styles/index.scss'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPersistedstate from 'pinia-plugin-persistedstate'

// ✅ 导入主组件和插件
import App from './App.vue'
import router from './router'
import { setupI18n } from './utils'

const savedTheme = localStorage.getItem('vueuse-color-scheme')
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

if (savedTheme === 'dark' || (!savedTheme && prefersDark))
  document.documentElement.classList.add('dark')
else
  document.documentElement.classList.remove('dark')

const app = createApp(App)

async function setupApp() {
  await setupI18n(app)

  const pinia = createPinia()
  pinia.use(piniaPersistedstate)

  app.use(pinia)
  app.use(router)
  app.mount('#app')
}

setupApp()
