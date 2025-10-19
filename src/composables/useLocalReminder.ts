// src/composables/useLocalReminder.ts
/* 纯本地每日提醒（无服务器版）
 * 说明：
 * - 仅在页面存活时计时；休眠/关闭期间不运行。
 * - 回到页面/唤醒时会“补发一次”（在宽限期内）并自动排到次日。
 */
import { onMounted, onUnmounted, ref } from 'vue'

export interface LocalReminderOptions {
  hour: number // 本地时间-小时 0~23
  minute: number // 本地时间-分钟 0~59
  title: string
  body: string
  icon?: string // 可选：通知图标
  badge?: string // 可选：通知角标
}

const STORAGE_KEY = 'local_reminder_v1'
// 补发宽限期（默认 10 分钟）：仅当“错过的时间”在此范围内才补发
const DEFAULT_CATCHUP_WINDOW_MS = 10 * 60 * 1000

function calcNextFireTs(hour: number, minute: number): number {
  const now = new Date()
  const target = new Date()
  target.setHours(hour, minute, 0, 0)
  if (target.getTime() <= now.getTime())
    target.setDate(target.getDate() + 1)
  return target.getTime()
}

export function useLocalReminder(defaults?: Partial<LocalReminderOptions>) {
  const settings = Object.assign(
    {
      hour: 11,
      minute: 10, // ← 不要写 02，避免“八进制字面量”错误
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
  const lastFireTs = ref<number | null>(null)

  // 一次性：用于在“首次进入/启动”时跳过补发
  const suppressCatchupOnce = ref(false)
  // 可配置的宽限期
  const catchupWindowMsRef = ref<number>(DEFAULT_CATCHUP_WINDOW_MS)

  function persist() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        enabled: enabled.value,
        nextFireTs: nextFireTs.value,
        lastFireTs: lastFireTs.value,
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
            // @ts-expect-error: Notification constructor may be missing/partial in some TS DOM libs
            const n = new Notification(settings.title, {
              body: settings.body,
              icon: settings.icon,
              badge: settings.badge,
            })
            // 避免 no-new/no-unused：挂一个空监听器即可视为已使用
            n?.addEventListener?.('show', () => {})
          })
      }
      else {
        // @ts-expect-error: Notification constructor may be missing/partial in some TS DOM libs
        const n = new Notification(settings.title, {
          body: settings.body,
          icon: settings.icon,
          badge: settings.badge,
        })
        // 同理，避免 no-new/no-unused
        n?.addEventListener?.('show', () => {})
      }
      // 记录最近一次发送时间
      lastFireTs.value = Date.now()
      persist()
    }
    catch {
      // 忽略所有通知失败（例如无权限/平台不支持）
    }
  }

  function scheduleNext(forceToday = false) {
    clearTimer()
    const now = Date.now()

    // 默认：若今天该时刻已过，则排到明天
    let ts = calcNextFireTs(settings.hour, settings.minute)

    // 若手动调整时间并要求今天触发，且“今天的目标时刻”还没过，就用今天的
    if (forceToday) {
      const target = new Date()
      target.setHours(settings.hour, settings.minute, 0, 0)
      const candidate = target.getTime()
      if (candidate > now)
        ts = candidate
    }

    nextFireTs.value = ts
    enabled.value = true
    persist()

    const delay = Math.max(0, ts - now)
    timerId.value = window.setTimeout(() => {
      showLocalNotification()
      // 发完按“明天同一时间”再排一次
      scheduleNext(false)
    }, delay) as unknown as number
  }

  // 无论之前是否 enabled，都强制（重新）排班
  async function start(options?: {
    forceToday?: boolean
    skipCatchupOnLoad?: boolean
    catchupWindowMs?: number
  }) {
    const forceToday = options?.forceToday === true
    suppressCatchupOnce.value = options?.skipCatchupOnLoad === true
    if (Number.isFinite(options?.catchupWindowMs))
      catchupWindowMsRef.value = Number(options!.catchupWindowMs)

    await ensurePermission().catch(() => {})
    scheduleNext(forceToday)

    // 若首次启动就已错过目标时刻（理论上不会，因为 scheduleNext 会取未来），
    // 这里仍加一道保险逻辑（受 skipCatchupOnLoad 和宽限期控制）
    if (nextFireTs.value && Date.now() >= nextFireTs.value) {
      if (!suppressCatchupOnce.value) {
        const missedFor = Date.now() - nextFireTs.value
        if (missedFor <= catchupWindowMsRef.value)
          showLocalNotification()
      }
      suppressCatchupOnce.value = false
      scheduleNext(false)
    }
  }

  function stop() {
    clearTimer()
    enabled.value = false
    nextFireTs.value = null
    persist()
  }

  function handleVisibilityResume() {
    if (!enabled.value || !nextFireTs.value)
      return

    // 如果是“首次进入后”的第一次可见且要求跳过补发，则只清标志，不补发
    if (suppressCatchupOnce.value) {
      suppressCatchupOnce.value = false
      return
    }

    const now = Date.now()
    if (now >= nextFireTs.value) {
      const missedFor = now - nextFireTs.value
      const withinWindow = missedFor <= catchupWindowMsRef.value
      if (withinWindow)
        showLocalNotification()
      // 不论是否补发，都排到下一次
      scheduleNext(false)
    }
  }

  onMounted(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved?.settings)
        Object.assign(settings, saved.settings)
      if (typeof saved?.lastFireTs === 'number')
        lastFireTs.value = saved.lastFireTs
      if (saved?.enabled) {
        enabled.value = true
        // 仅重排，不在此处决定是否补发（补发交给 visibility 事件或 start 的保险逻辑）
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
  function reschedule(opts?: { forceToday?: boolean }) {
    const forceToday = opts?.forceToday === true
    scheduleNext(forceToday)
  }

  function setTime(h: number, m: number, fireNow = false, opts?: { forceToday?: boolean }) {
    settings.hour = Math.max(0, Math.min(23, Math.trunc(h)))
    settings.minute = Math.max(0, Math.min(59, Math.trunc(m)))
    persist()
    if (fireNow)
      showLocalNotification()
    reschedule(opts)
  }
  // =======================================

  return {
    start,
    stop,
    settings,
    enabled,
    nextFireTs,
    // 新增导出
    reschedule,
    setTime,
  }
}
