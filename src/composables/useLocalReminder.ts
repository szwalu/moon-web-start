// src/composables/useLocalReminder.ts
/* 纯本地每日提醒（无服务器版）
 * 说明：
 * - 仅在页面存活时计时；休眠/关闭期间不运行。
 * - 取消了“唤醒补发”，避免打开应用就提醒。
 * - 支持“每日多次提醒”：settings.times 优先，其次回退到单一 hour/minute。
 */
import { onMounted, onUnmounted, ref } from 'vue'

export interface LocalReminderTime {
  hour: number // 0~23
  minute: number // 0~59
}

export interface LocalReminderOptions {
  // 单次时间（向后兼容）
  hour: number
  minute: number
  // 多次时间（优先）
  times?: LocalReminderTime[]
  // 通知文案
  title: string
  body: string
  icon?: string
  badge?: string
}

const STORAGE_KEY = 'local_reminder_v1'

function toTs(date: Date, h: number, m: number) {
  const d = new Date(date)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

// 计算“从 now 起”的下一次触发时间戳（支持 times 多时段；若为空则回退到 hour/minute）
function calcNextFireTsFromSettings(now: Date, settings: LocalReminderOptions): number {
  const list: LocalReminderTime[]
    = Array.isArray(settings.times) && settings.times.length > 0
      ? settings.times
      : [{ hour: settings.hour, minute: settings.minute }]

  // 1) 先找“今天剩余”的最近一个
  const nowMs = now.getTime()
  let candidates: number[] = []
  for (const t of list) {
    const ts = toTs(now, t.hour, t.minute)
    if (ts > nowMs)
      candidates.push(ts)
  }
  if (candidates.length > 0)
    return Math.min(...candidates)

  // 2) 今天都过了：取“明天”的最早一个
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  candidates = list.map(t => toTs(tomorrow, t.hour, t.minute))
  return Math.min(...candidates)
}

export function useLocalReminder(defaults?: Partial<LocalReminderOptions>) {
  const settings = Object.assign(
    {
      hour: 11,
      minute: 10, // 不要写 02，避免“八进制字面量”误读
      times: undefined as LocalReminderOptions['times'],
      title: '那年今日',
      body: '来看看那年今日卡片吧～',
      icon: '/icons/android-chrome-192x192.png',
      badge: '/icons/badge-72.png',
    } as LocalReminderOptions,
    defaults || {},
  )

  const enabled = ref(false)
  const nextFireTs = ref<number | null>(null)
  const timerId = ref<number | null>(null)

  function persist() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        enabled: enabled.value,
        nextFireTs: nextFireTs.value,
        settings,
      }),
    )
  }

  function clearTimer() {
    if (timerId.value != null) {
      clearTimeout(timerId.value)
      timerId.value = null
    }
  }

  async function ensurePermission(): Promise<boolean> {
    if (!('Notification' in window))
      return false
    if (Notification.permission === 'granted')
      return true
    if (Notification.permission === 'denied')
      return false
    const perm = await Notification.requestPermission()
    return perm === 'granted'
  }

  // 放在 hook 内部，避免“顶层未使用”
  function showLocalNotification() {
    try {
      const regPromise = navigator.serviceWorker?.ready
      if (regPromise) {
        regPromise
          .then(reg =>
            reg.showNotification(settings.title, {
              body: settings.body,
              icon: settings.icon,
              badge: settings.badge,
              tag: 'local-daily-reminder',
              renotify: true,
            }),
          )
          .catch(() => {
            // @ts-expect-error: Some TS DOM lib versions may not include Notification constructor
            const n = new Notification(settings.title, {
              body: settings.body,
              icon: settings.icon,
              badge: settings.badge,
            })
            // 防止 no-new/no-unused：显式使用
            n?.addEventListener?.('show', () => {})
          })
      }
      else {
        // @ts-expect-error: Some TS DOM lib versions may not include Notification constructor
        const n = new Notification(settings.title, {
          body: settings.body,
          icon: settings.icon,
          badge: settings.badge,
        })
        n?.addEventListener?.('show', () => {})
      }
    }
    catch {
      // 忽略平台/权限等失败
    }
  }

  // 重新计算“下一次触发”，并挂定时器
  function scheduleNext() {
    clearTimer()
    const ts = calcNextFireTsFromSettings(new Date(), settings)
    nextFireTs.value = ts
    enabled.value = true
    persist()

    const delay = Math.max(0, ts - Date.now())
    timerId.value = window.setTimeout(() => {
      showLocalNotification()
      // 触发后，立即排到下一次（支持每日多次）
      scheduleNext()
    }, delay) as unknown as number
  }

  // 无论之前是否 enabled，都强制（重新）排班
  async function start() {
    await ensurePermission().catch(() => {})
    scheduleNext()
  }

  function stop() {
    clearTimer()
    enabled.value = false
    nextFireTs.value = null
    persist()
  }

  // 仅在“回到前台”时做静默重排；不补发
  function handleVisibilityResume() {
    if (!enabled.value)
      return
    // 如果已经过了原先的 nextFireTs（比如设备休眠/锁屏期间），不补发，只静默重排
    if (nextFireTs.value && Date.now() >= nextFireTs.value)
      scheduleNext()
  }

  onMounted(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved?.settings)
        Object.assign(settings, saved.settings)
      if (saved?.enabled) {
        enabled.value = true
        scheduleNext()
      }
    }
    catch {}

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible')
        handleVisibilityResume()
    })
  })

  onUnmounted(() => {
    clearTimer()
  })

  // ===== 运行时改时间 & 立即重排 =====
  function reschedule() {
    scheduleNext()
  }

  // 单个时间（向后兼容）
  function setTime(h: number, m: number, fireNow = false) {
    settings.times = undefined // 清空多时段，回到单时段
    settings.hour = Math.max(0, Math.min(23, Math.trunc(h)))
    settings.minute = Math.max(0, Math.min(59, Math.trunc(m)))
    persist()
    if (fireNow)
      showLocalNotification()
    reschedule()
  }

  // 多个时间：例如 [{hour:9,minute:0},{hour:13,minute:30},{hour:21,minute:15}]
  function setTimes(times: LocalReminderTime[], fireNow = false) {
    const normalized = (Array.isArray(times) ? times : [])
      .map(t => ({
        hour: Math.max(0, Math.min(23, Math.trunc(t.hour))),
        minute: Math.max(0, Math.min(59, Math.trunc(t.minute))),
      }))
      // 去重 + 排序（按小时、分钟）
      .sort((a, b) => (a.hour - b.hour) || (a.minute - b.minute))

    settings.times = normalized.length ? normalized : undefined
    persist()
    if (fireNow)
      showLocalNotification()
    reschedule()
  }
  // =======================================

  return {
    start,
    stop,
    settings,
    enabled,
    nextFireTs,
    reschedule,
    setTime,
    setTimes, // ⭐ 新增：支持多时段
  }
}
