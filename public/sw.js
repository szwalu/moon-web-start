/* public/sw.js v3 */
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
  catch { raw = {} }

  const n = raw.notification && typeof raw.notification === 'object' ? raw.notification : raw
  const title = n.title || '云笔记'
  const body = n.body || '来写点今天的笔记吧～'
  const url = n.url || '/'

  const options = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { url },
    tag: 'daily-note', // ✅ 相同 tag 会“覆盖”上一条，不会无限叠加
    renotify: false, // ✅ 关闭“您有 X 条新通知”的再次提醒
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
