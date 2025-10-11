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
      icon: '/icon-192.png', // 你站点的图标（可改）
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

/** 本地存上次提醒的日期（YYYY-MM-DD），用于应用内提醒防多次弹 */
function setLastInAppRemindToday(key = 'last_inapp_review_date') {
  const d = new Date()
  const mark = d.toISOString().slice(0, 10) // YYYY-MM-DD
  localStorage.setItem(key, mark)
}
function isInAppRemindedToday(key = 'last_inapp_review_date') {
  const mark = localStorage.getItem(key) || ''
  const today = new Date().toISOString().slice(0, 10)
  return mark === today
}

/** 应用内提醒的回调（由外部实现 UI，比如弹 Banner） */
export type InAppHandler = () => void

let _timerId: number | null = null

/**
 * 安排“每天固定时间”的提醒。
 * - 支持系统通知（如果权限允许）
 * - 否则回退为应用内提醒（仅在页面打开时）
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
  const canSystemNotify = supported && swOk && permission === 'granted'

  const fireOnce = async () => {
    if (canSystemNotify) {
      const ok = await showSystemNotification(title, body)
      if (!ok && onInAppRemind) {
        if (!isInAppRemindedToday()) {
          onInAppRemind()
          setLastInAppRemindToday()
        }
      }
    }
    else if (onInAppRemind) {
      // 回退：应用内提醒（一天一次）
      if (!isInAppRemindedToday()) {
        onInAppRemind()
        setLastInAppRemindToday()
      }
    }

    // 这次触发后，安排下一次
    _timerId = window.setTimeout(fireOnce, msUntilNext(hour, minute))
  }

  // 先等到下一个 9:00（或你设置的时间）再触发
  _timerId = window.setTimeout(fireOnce, msUntilNext(hour, minute))
}

/** 在页面重新可见时补偿检查（比如用户 9:00 之后才打开页面） */
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

    // 若已经过了目标时间，且今天还未应用内提醒过，则补一次
    const now = new Date()
    const passed = now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute)
    if (passed && !isInAppRemindedToday()) {
      onInAppRemind?.()
      setLastInAppRemindToday()
    }
    localStorage.setItem(key, today)
  }

  window.addEventListener('visibilitychange', handler)
  // 可选：在卸载时移除（视框架而定）
  return () => window.removeEventListener('visibilitychange', handler)
}
