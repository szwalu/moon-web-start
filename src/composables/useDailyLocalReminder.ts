// src/composables/useDailyLocalReminder.ts
import { onBeforeUnmount, onMounted, ref } from 'vue'

interface Options {
  hour: number // 24 小时制
  minute?: number // 默认 0
  title?: string // 通知标题
  body?: string // 通知内容
  icon?: string // 192x192
  badge?: string // 72x72
  tag?: string // 防重复聚合
}

/**
 * 纯本地每日提醒（无需服务器）。前提：用户已授权通知，且 PWA 未被系统彻底杀掉（或下次打开时补发）。
 * 逻辑：
 *  - 首次：引导用户授权（需一次“用户手势”点击）
 *  - 常驻：每分钟轮询一次是否到了设定时间（±30s），到点触发一次通知并记账
 *  - 记账：localStorage 记录“今天已提醒”，避免重复
 */
export function useDailyLocalReminder(opts: Options) {
  const {
    hour,
    minute = 0,
    title = '云笔记 · 每日提醒',
    body = '来写点今天的笔记吧～',
    icon = '/icons/pwa-192.png',
    badge = '/icons/badge-72.png',
    tag = 'yunbiji-daily',
  } = opts

  const showEnableBtn = ref(false)
  let timer: number | null = null
  const LS_KEY = 'yunbiji_daily_last_fire' // 记录 YYYY-MM-DD

  const isStandalone
    = (typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(display-mode: standalone)').matches)
    // 老版 iOS PWA 标记
    || (typeof navigator !== 'undefined' && (navigator as any).standalone === true)

  // —— 只做一次权限申请（用户点击按钮时调用）
  async function requestPermission() {
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        showEnableBtn.value = false
        return
      }
      // 确保有 SW（无需特制 SW）
      await navigator.serviceWorker.register('/sw.js?v=local-daily-1')
      const perm = await Notification.requestPermission()
      showEnableBtn.value = perm === 'default'
      // 立刻跑一次调度（如果今天还未提醒且已过时间，立刻提醒一次）
      if (perm === 'granted')
        tryFireOnceIfNeeded(true).catch(() => {})
    }
    catch {
      // 静默忽略
    }
  }

  // —— 判断今天是否已经提醒过
  function isFiredToday(): boolean {
    try {
      const v = localStorage.getItem(LS_KEY)
      if (!v)
        return false
      const today = new Date()
      const yyyy = today.getFullYear()
      const mm = String(today.getMonth() + 1).padStart(2, '0')
      const dd = String(today.getDate()).padStart(2, '0')
      const todayStr = `${yyyy}-${mm}-${dd}`
      return v === todayStr
    }
    catch {
      return false
    }
  }

  function markFiredToday() {
    try {
      const today = new Date()
      const yyyy = today.getFullYear()
      const mm = String(today.getMonth() + 1).padStart(2, '0')
      const dd = String(today.getDate()).padStart(2, '0')
      localStorage.setItem(LS_KEY, `${yyyy}-${mm}-${dd}`)
    }
    catch {
      // ignore
    }
  }

  // —— 到点判断：到点 ±30 秒窗口内且今天未提醒过 → 触发一次
  async function tryFireOnceIfNeeded(allowImmediateIfPast = false) {
    if (!('Notification' in window) || !('serviceWorker' in navigator))
      return
    if (Notification.permission !== 'granted')
      return
    if (isFiredToday())
      return

    const now = new Date()
    const target = new Date(now)
    target.setHours(hour, minute, 0, 0)

    // 如果已经过了目标时间：只有在 allowImmediateIfPast=true 时才立即补发一次
    let shouldFire = false
    if (now.getTime() >= target.getTime()) {
      shouldFire = allowImmediateIfPast
    }
    else {
      // 未到时间，落在 ±30 秒的窗口内
      const diff = target.getTime() - now.getTime()
      shouldFire = diff <= 30_000 // 30s 窗口
    }

    if (!shouldFire)
      return

    try {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(title, {
        body,
        icon,
        badge,
        tag, // 聚合，避免重复
        renotify: false,
      })
      markFiredToday()
    }
    catch {
      // 忽略
    }
  }

  // —— 保存引用，便于正确解绑
  const tick = () => {
    tryFireOnceIfNeeded(false).catch(() => {})
  }

  function start() {
    // 仅在 PWA 独立模式下引导；网页模式不提示按钮，避免干扰
    if (typeof Notification !== 'undefined' && Notification.permission === 'default' && isStandalone)
      showEnableBtn.value = true
    else
      showEnableBtn.value = false

    // 可见时每分钟检查一次；切换可见性时也检查
    timer = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick, { passive: true })

    // 刚挂载时：若已授权且今天未发，且现在已过提醒时间 → 立即补一次
    tryFireOnceIfNeeded(true).catch(() => {})
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    document.removeEventListener('visibilitychange', tick)
  }

  onMounted(start)
  onBeforeUnmount(stop)

  return {
    showEnableBtn, // 用于 v-if 控制“开启提醒”按钮显示
    requestPermission, // 点击触发一次权限申请 + 立即补发
  }
}
