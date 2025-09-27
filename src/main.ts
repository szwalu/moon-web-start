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

  app.use(pinia)
  app.use(router)
  app.mount('#app')
}

// === [PWA 校验] 运行时确认是否以 Standalone 启动（iOS 桌面全屏） ===
;(function checkStandalone() {
  const isStandalone
      = window.matchMedia?.('(display-mode: standalone)').matches
      // iOS 独有：从主屏幕打开时为 true
      || (navigator as any).standalone === true
  // eslint-disable-next-line no-console
  console.log('[PWA] display-mode standalone =', isStandalone)

  // 如果不是 Standalone，临时给个可视化提示（调试用，确认后可删）
  const TIP_ID = 'pwa-standalone-tip'
  document.getElementById(TIP_ID)?.remove()
  if (!isStandalone) {
    const tip = document.createElement('div')
    tip.id = TIP_ID
    tip.textContent = '当前非 Standalone（iOS 桌面全屏）模式'
    tip.style.cssText
        = 'position:fixed;z-index:999999;left:0;right:0;top:0;'
        + 'background:#ffdcdf;color:#b00020;padding:6px 10px;'
        + 'font-size:12px;text-align:center'
    document.body.appendChild(tip)
  }
})()
// === [PWA 校验 END] ===

setupApp()
registerSW({ immediate: true })
