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

// ========== 全局兜底：懒加载分包失效时自动刷新 ==========
(function installChunkFailGuard() {
  let reloading = false
  const triggerReloadSafely = () => {
    if (reloading)
      return
    reloading = true
    try {
      // 尝试清理浏览器缓存
      // @ts-expect-error: window.caches 在 DOM lib 中未完整定义
      if (window.caches?.keys) {
        // @ts-expect-error: caches API 在 TS DOM 类型里可能缺失
        caches.keys().then(keys => keys.forEach(k => caches.delete(k)))
      }
      if (navigator.serviceWorker?.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach(reg => reg.waiting?.postMessage?.({ type: 'SKIP_WAITING' }))
        })
      }
    }
    catch {
      // 忽略非致命异常
    }
    location.reload()
  }

  const isChunkLoadError = (msg: string) =>
    msg.includes('Failed to fetch dynamically imported module')
    || msg.includes('Importing a module script failed')
    || msg.includes('Expected a JavaScript-or-Wasm module script')

  // 1) 捕捉浏览器层面的模块脚本加载失败
  window.addEventListener(
    'error',
    (e: ErrorEvent) => {
      const msg = String(e?.message || '')
      if (isChunkLoadError(msg))
        triggerReloadSafely()
    },
    true,
  )

  // 2) 捕捉未处理的 Promise 拒绝
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason = String((e && (e as any).reason) || '')
    if (isChunkLoadError(reason))
      triggerReloadSafely()
  })

  // 3) Vue Router 级别兜底
  router.onError((err) => {
    const msg = String((err && (err as any).message) || err || '')
    if (isChunkLoadError(msg))
      triggerReloadSafely()
  })
})()
// ========== 兜底结束 ==========

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
