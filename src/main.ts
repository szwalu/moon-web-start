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

  // ⬇️ 新增：回到窗口的“宽限期” 1.5s，避免刚 pageshow 时误判强刷
  const RESUME_MUTE_MS = 1500
  const LAST_PAGESHOW_KEY = '__last_pageshow_ts'

  const now = () => Date.now()

  const canReloadNow = () => {
    const last = Number(localStorage.getItem(LAST_RELOAD_KEY) || 0)
    return now() - last > RELOAD_COOLDOWN_MS
  }

  const markReload = () => {
    localStorage.setItem(LAST_RELOAD_KEY, String(now()))
  }

  // 记录 pageshow 时间戳（若你在 index.html 里已写入，这里只是补强，不冲突）
  const touchPageshowTs = () => {
    try {
      sessionStorage.setItem(LAST_PAGESHOW_KEY, String(now()))
    }
    catch {}
  }
  window.addEventListener('pageshow', touchPageshowTs)

  const justResumed = (): boolean => {
    try {
      const ts = Number(sessionStorage.getItem(LAST_PAGESHOW_KEY) || 0)
      if (!ts)
        return false
      return now() - ts <= RESUME_MUTE_MS
    }
    catch {
      return false
    }
  }

  const triggerReloadSafely = () => {
    if (reloading)
      return
    if (!canReloadNow())
      return

    // ⬇️ 新增：刚从外链/后台回到页面的前 1.5s 内，不触发强刷
    if (justResumed())
      return

    // 如果离线，先别刷新，等线上线再刷新
    if (typeof navigator !== 'undefined' && 'onLine' in navigator && navigator.onLine === false) {
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
        caches.keys().then((keys: string[]) => keys.forEach(k => caches.delete(k)))
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
    if (!justResumed() && isChunkLoadError(e.error || e.message))
      triggerReloadSafely()
  }, true)

  // 2) 未处理的 Promise 拒绝（动态 import 大多走这里）
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    if (!justResumed() && isChunkLoadError(e.reason))
      triggerReloadSafely()
  })

  // 3) 路由懒加载失败
  router.onError((err) => {
    if (!justResumed() && isChunkLoadError(err))
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

registerSW({
  immediate: false,
  onNeedRefresh() {
    // 这里你可用 Naive UI 给个“有更新，点我刷新”的提示；用户点击时再调用 updateSW(true)
  },
  onOfflineReady() {
    // 可选：首次离线就绪提示
  },
})
