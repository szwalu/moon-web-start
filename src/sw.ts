/* eslint-disable no-console */
/// <reference lib="webworker" />

// 提前声明，避免 TS 对 self 的类型报错
declare const self: ServiceWorkerGlobalScope

// 放在文件最上面
console.log('[SW] booted at', new Date().toISOString())

self.addEventListener('install', (_event) => {
  console.log('[SW] install')
  // ① 安装后立刻进入 waiting
  self.skipWaiting()
})

self.addEventListener('activate', (_event) => {
  console.log('[SW] activate')
  // ② 立刻接管所有同源客户端
  _event.waitUntil(self.clients.claim())
})

// 统一的通知标题 & 资源（可按需替换）
const DEFAULT_TITLE = '记得写笔记哟'
const DEFAULT_OPTIONS: NotificationOptions = {
  body: '每天 9:00 小提醒',
  tag: 'daily-note', // 同 tag 可覆盖展示，但配合 renotify 会再响
  renotify: true,
  icon: '/icons/android-chrome-192x192.png',
  badge: '/icons/badge-72.png',
}

// ========== 1) 处理推送：解析 payload（若没有 payload，就用默认文案） ==========
self.addEventListener('push', (event: PushEvent) => {
  // ★ 输出原始推送内容，便于在 Service Worker Console 中查看
  const raw = event.data?.text() ?? ''
  console.log('[SW] push payload raw:', raw)

  let title = DEFAULT_TITLE
  const options: NotificationOptions = { ...DEFAULT_OPTIONS }

  try {
    const data = raw ? JSON.parse(raw) : {}
    if (data && typeof data === 'object') {
      if (data.title)
        title = String(data.title)
      if (data.body)
        options.body = String(data.body)
      if (data.tag)
        options.tag = String(data.tag)
      if (data.data && typeof data.data === 'object')
        options.data = data.data as any
    }
  }
  catch (err) {
    console.error('[SW] JSON parse failed:', err)
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ========== 2) 点击通知：优先聚焦已打开的同源页面，否则新开 /auth ==========
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()

  event.waitUntil((async () => {
    const targetUrl = new URL('/auth', self.location.origin).href
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

    // 1) 找一个同源的窗口（优先已可见的）
    let targetClient: WindowClient | undefined
    for (const c of clientsList) {
      const wc = c as WindowClient
      if (wc.url.startsWith(self.location.origin)) {
        targetClient = wc
        // 如果已经在 /auth 了，直接聚焦即可
        if (wc.url === targetUrl) {
          await wc.focus()
          return
        }
        break
      }
    }

    // 2) 有窗口：先导航到 /auth，再聚焦（navigate 可能返回 Promise）
    if (targetClient) {
      if ('navigate' in targetClient) {
        try {
          await targetClient.navigate(targetUrl)
        }
        catch {}
      }
      try {
        await targetClient.focus()
      }
      catch {}
      return
    }

    // 3) 没有窗口：新开一个
    await self.clients.openWindow(targetUrl)
  })())
})
