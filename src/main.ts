// main.ts

// ✅ 立即判断并设置暗黑模式，防止刷新页面先黑一下再变白
// ✅ 引入样式
import 'uno.css'
import '@/styles/index.scss'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPersistedstate from 'pinia-plugin-persistedstate'

// ✅ 导入主组件和插件
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import router from './router'
import { setupI18n } from './utils'

// 修正 iOS PWA 视口高度，消除底部“白条”
(function fixAppVh() {
  const setVH = () => {
    const vh = (window.visualViewport?.height ?? window.innerHeight) * 0.01
    document.documentElement.style.setProperty('--app-vh', `${vh}px`)
  }
  setVH()
  window.visualViewport?.addEventListener('resize', setVH)
  window.addEventListener('orientationchange', setVH)
  window.addEventListener('resize', setVH)
})();

// ========== 全局兜底：懒加载分包失效时自动刷新 ==========
(function installChunkFailGuard() {
  let reloading = false
  const RELOAD_COOLDOWN_MS = 2 * 60 * 1000 // 2 分钟冷却，避免连环刷新
  const LAST_RELOAD_KEY = '__last_forced_reload_ts__'

  const now = () => Date.now()
  const canReloadNow = () => {
    const last = Number(localStorage.getItem(LAST_RELOAD_KEY) || 0)
    return now() - last > RELOAD_COOLDOWN_MS
  }

  const markReload = () => localStorage.setItem(LAST_RELOAD_KEY, String(now()))

  const triggerReloadSafely = () => {
    if (reloading || !canReloadNow())
      return

    // 如果离线，先别刷新，等线上线再刷新
    if (typeof navigator !== 'undefined' && navigator && 'onLine' in navigator && navigator.onLine === false) {
      const onBackOnline = () => {
        window.removeEventListener('online', onBackOnline)
        triggerReloadSafely()
      }
      window.addEventListener('online', onBackOnline)
      return
    }

    reloading = true
    markReload()

    try {
      // 这些操作都包在 try 里，兼容 Safari/无 SW 场景
      // @ts-expect-error caches 可能在 TS DOM 类型里缺失
      if (window.caches?.keys) {
        // @ts-expect-error same as above
        caches.keys().then(keys => keys.forEach(k => caches.delete(k)))
      }
      if (navigator.serviceWorker?.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach(reg => reg.waiting?.postMessage?.({ type: 'SKIP_WAITING' }))
        })
      }
    }
    catch {}

    location.reload()
  }

  const pickMsg = (x: any): string => {
    if (!x)
      return ''
    if (typeof x === 'string')
      return x
    const m = (x && (x.message || x.reason?.message)) || ''
    return String(m || x)
  }

  const isChunkLoadError = (raw: any): boolean => {
    const msg = pickMsg(raw)
    return (
      msg.includes('Failed to fetch dynamically imported module') // 动态 import 失败（常见）
      || msg.includes('Importing a module script failed') // FF/Safari 文案
      || msg.includes('Expected a JavaScript-or-Wasm module script') // 你日志里出现过
      || /Loading chunk \d+ failed/i.test(msg) // 通用正则
      || /chunk.*failed/i.test(msg)
    )
  }

  // 1) 浏览器层 error（含模块脚本加载失败）
  window.addEventListener('error', (e: ErrorEvent) => {
    if (isChunkLoadError(e.error || e.message))
      triggerReloadSafely()
  }, true)

  // 2) 未处理的 Promise 拒绝（动态 import 大多走这里）
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    if (isChunkLoadError(e.reason))
      triggerReloadSafely()
  })

  // 3) 路由懒加载失败
  router.onError((err) => {
    if (isChunkLoadError(err))
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

  // ===== A2HS 启动纠偏（仅在独立模式下生效）=====
  function isStandaloneLaunch() {
    const iosStandalone = (window as any).navigator?.standalone === true
    const pwaStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches === true
    return iosStandalone || pwaStandalone
  }

  try {
    if (isStandaloneLaunch()) {
      const entry = localStorage.getItem('a2hs_entry')
      // 如果是“笔记专用图标”启动，但当前却在首页路径，就无痕纠偏到 /auth
      if (entry === 'notes' && location.pathname === '/')
        location.replace('/auth')
    }
  }
  catch {}
  // =============================================

  app.use(pinia)
  app.use(router)
  app.mount('#app')
}

setupApp()
registerSW({ immediate: true })
