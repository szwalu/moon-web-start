export type NotifyMode = 'system' | 'inapp'

/** 检查浏览器是否支持系统通知 */
export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
}

/** 注册 Service Worker（幂等） */
export async function ensureServiceWorkerRegistered(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator))
    return null
  try {
    // vite-plugin-pwa 的 registerSW() 已经注册并控制了页面
    const reg = await navigator.serviceWorker.ready
    return reg || null
  }
  catch {
    return null
  }
}

/** 请求通知权限（需用户手势触发时机更稳妥：比如设置里点击“开启提醒”按钮） */
export async function requestNotifyPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported())
    return 'denied'
  try {
    const res = await Notification.requestPermission()
    return res
  }
  catch {
    return 'denied'
  }
}

/** 计算到下一次 hh:mm 的毫秒数（本地时区） */
function msUntilNext(hour: number, minute: number): number {
  const now = new Date()
  const next = new Date()
  next.setHours(hour, minute, 0, 0)
  if (next.getTime() <= now.getTime())
    next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

/** 触发系统通知（需要 SW registration + 权限） */
async function showSystemNotification(title: string, body: string) {
  const reg = await ensureServiceWorkerRegistered()
  if (!reg)
    return false
  try {
    await reg.showNotification(title, {
      body,
      icon: '/icon-192.png', // 站点图标（按需调整）
      badge: '/icon-192.png',
      tag: 'daily-review', // 防止重复叠加
      renotify: true,
    })
    return true
  }
  catch {
    return false
  }
}

/** 应用内提醒的回调（由外部实现 UI，比如弹 Banner/Message） */
export type InAppHandler = () => void

let _timerId: number | null = null

/**
 * 安排“每天固定时间”的提醒。
 * - 支持系统通知（如果权限允许）
 * - 否则回退为应用内提醒（仅在页面打开时）
 * - 是否“记账”为当天已提醒：交给前端点击行为处理（App.vue）
 */
export async function scheduleDailyReminder(
  opts: {
    hour?: number
    minute?: number
    title?: string
    body?: string
    onInAppRemind?: InAppHandler
  } = {},
) {
  const {
    hour = 9,
    minute = 0,
    title = '今日回顾',
    body = '点一下，回顾一下今天（或最近）的卡片/笔记吧～',
    onInAppRemind,
  } = opts

  // 清理旧定时器
  if (_timerId) {
    window.clearTimeout(_timerId)
    _timerId = null
  }

  // 确保 SW 已注册（系统通知必需）
  const swOk = await ensureServiceWorkerRegistered()

  const supported = isNotificationSupported()
  const permission = supported ? Notification.permission : 'denied'
  const canSystemNotify = !!(supported && swOk && permission === 'granted')

  const fireOnce = async () => {
    if (canSystemNotify) {
      const ok = await showSystemNotification(title, body)
      if (!ok) {
        if (onInAppRemind)
          onInAppRemind()
        else window.dispatchEvent(new CustomEvent('review-reminder', { detail: { markOnClick: true } }))
      }
    }
    else {
      if (onInAppRemind)
        onInAppRemind()
      else window.dispatchEvent(new CustomEvent('review-reminder', { detail: { markOnClick: true } }))
    }

    _timerId = window.setTimeout(fireOnce, msUntilNext(hour, minute))
  }
  // 等到下一个 hh:mm 触发
  _timerId = window.setTimeout(fireOnce, msUntilNext(hour, minute))
}

/** 在页面重新可见时的补偿检查（比如用户 9:00 之后才打开页面） */
export function setupVisibilityCompensation(
  opts: {
    hour?: number
    minute?: number
    onInAppRemind?: InAppHandler
  } = {},
) {
  const { hour = 9, minute = 0, onInAppRemind } = opts
  const key = 'last_compensate_date'

  const handler = () => {
    if (document.visibilityState !== 'visible')
      return
    const today = new Date().toISOString().slice(0, 10)
    const done = localStorage.getItem(key) === today
    if (done)
      return

    // 若已经过了目标时间，且今天还未提醒过，则补一次
    const now = new Date()
    const passed = now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute)
    if (passed) {
      if (onInAppRemind)
        onInAppRemind()
      else window.dispatchEvent(new CustomEvent('review-reminder', { detail: { markOnClick: true } }))
    }

    localStorage.setItem(key, today)
  }

  window.addEventListener('visibilitychange', handler)
  // 返回卸载函数（按需调用）
  return () => window.removeEventListener('visibilitychange', handler)
}
