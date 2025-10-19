/* eslint-env serviceworker */
/* 兼容 iOS/Safari + ESLint（不用 self） */

globalThis.addEventListener('install', (event) => {
  // 立刻启用新 SW
  event.waitUntil(globalThis.skipWaiting())
})

globalThis.addEventListener('activate', (event) => {
  // 接管所有页面
  event.waitUntil(globalThis.clients.claim())
})

// 统一解析来自服务端的 push payload：
// 支持：
// 1) 纯文本
// 2) 扁平 JSON: { title, body, url }
// 3) Apple 风格: { notification: { title, body, url } }
function parsePayload(event) {
  const fallback = { title: '云笔记', body: '你有一条新提醒', url: '/' }
  try {
    const txt = event?.data?.text?.() ?? ''
    if (!txt)
      return fallback

    try {
      const j = JSON.parse(txt)
      if (j && typeof j === 'object') {
        if (j.notification && typeof j.notification === 'object') {
          return {
            title: j.notification.title || fallback.title,
            body: j.notification.body || fallback.body,
            url: j.notification.url || fallback.url,
          }
        }
        return {
          title: j.title || fallback.title,
          body: j.body || fallback.body,
          url: j.url || fallback.url,
        }
      }
      // 虽是字符串但可显示
      return { ...fallback, body: String(txt) }
    }
    catch {
      // 非 JSON，按纯文本展示
      return { ...fallback, body: String(txt) }
    }
  }
  catch {
    return fallback
  }
}

globalThis.addEventListener('push', (event) => {
  const payload = parsePayload(event)
  const { title, body, url } = payload

  const show = globalThis.registration.showNotification(title, {
    body,
    icon: '/icons/pwa-192.png', // 你的 192x192 图标路径
    badge: '/icons/badge-72.png', // 可选：badge 图标
    tag: 'yunbiji-one', // 避免多条重复叠加
    renotify: false,
    data: { url },
  })

  event.waitUntil(show)
})

globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event?.notification?.data?.url || '/'
  const open = (async () => {
    const all = await globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // 已有窗口就聚焦，否则打开
    for (const c of all) {
      try {
        const u = new URL(c.url)
        // 你的站点同域就够了，路径不必完全一致
        if (u.origin === location.origin) {
          await c.focus()
          return
        }
      }
      catch {
        // ignore
      }
    }
    await globalThis.clients.openWindow(targetUrl)
  })()
  event.waitUntil(open)
})
