/* public/sw.js */
globalThis.addEventListener('install', (event) => {
  event.waitUntil(globalThis.skipWaiting())
})

globalThis.addEventListener('activate', (event) => {
  event.waitUntil(globalThis.clients.claim())
})

globalThis.addEventListener('push', (event) => {
  let raw = {}
  try {
    if (event.data)
      raw = event.data.json()
  }
  catch {
    raw = {}
  }

  // 同时兼容两种结构：
  // 1) { title, body, url? }
  // 2) { notification: { title, body, url? } }
  const n = raw.notification && typeof raw.notification === 'object' ? raw.notification : raw
  const title = n.title || '云笔记'
  const body = n.body || '来写点今天的笔记吧～'
  const url = n.url || '/'

  const options = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { url },
  }

  event.waitUntil(globalThis.registration.showNotification(title, options))
})

globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification?.data?.url) || '/'
  event.waitUntil((async () => {
    const all = await globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const hit = all.find(c => c.url.includes(url))
    if (hit)
      await hit.focus()
    else await globalThis.clients.openWindow(url)
  })())
})
