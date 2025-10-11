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

// 🔔 新增：导入通知/提醒工具（确保你已添加 src/utils/notify.ts 与 /public/sw.js）
import {
  ensureServiceWorkerRegistered,
  // requestNotifyPermission, // 放在设置页按钮里调用更合适
  scheduleDailyReminder,
  setupVisibilityCompensation,
} from '@/utils/notify'

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

  app.use(pinia)
  app.use(router)
  app.mount('#app')

  // —— 🔔 启动提醒能力（集成你的代码）——
  // 1) 注册 SW（尽早；这里放在 mount 后也可，已在入口阶段尽快执行）
  ensureServiceWorkerRegistered('/sw.js')

  // 2) 可在设置页/按钮触发权限请求（用户手势最好）：
  //    await requestNotifyPermission()

  // 3) 启动“每天 9:00”的提醒（系统通知 or 应用内回退）
  //    这里示例的应用内提醒：显示一个全局 Banner（可以替换为你自己的 Naive UI 提示）
  scheduleDailyReminder({
    hour: 15, // 小时部分
    minute: 9, // 分钟部分
    title: '那年今日回顾',
    body: '来看看那年今日的卡片吧～',
    onInAppRemind: () => {
      try {
        // 替代 alert：改用控制台/全局事件/Naive UI message 等
        // 或：console.info('🔔 今日回顾：点这里打开你的复盘视图（示例）')
        window.dispatchEvent(new CustomEvent('open-anniversary'))
      }
      catch (e) {
        // ignore
      }
    },
  })

  // 4) 可见性补偿（避免错过当天 9:00）
  setupVisibilityCompensation({
    hour: 9,
    minute: 0,
    onInAppRemind: () => {
      try {
        // 或：console.info('🔔 今日回顾（补偿提醒）')
        window.dispatchEvent(new CustomEvent('open-anniversary'))
      }
      catch (e) {
        // ignore
      }
    },
  })
}

setupApp()
registerSW({ immediate: true })
