/* eslint-env serviceworker */
globalThis.addEventListener('install', e => e.waitUntil(globalThis.skipWaiting()))
globalThis.addEventListener('activate', e => e.waitUntil(globalThis.clients.claim()))

function parsePayload(event) {
  const fallback = { title: '云笔记', body: '你有一条新提醒', url: '/' }
  try {
    const txt = event?.data?.text?.() ?? ''
    if (!txt)
      return fallback
    try {
      const j = JSON.parse(txt)
      if (j && typeof j === 'object') {
        if (j.notification && typeof j.notification === 'object')
          return { title: j.notification.title || fallback.title, body: j.notification.body || fallback.body, url: j.notification.url || fallback.url }

        return { title: j.title || fallback.title, body: j.body || fallback.body, url: j.url || fallback.url }
      }
      return { ...fallback, body: String(txt) }
    }
    catch {
      return { ...fallback, body: String(txt) }
    }
  }
  catch { return fallback }
}

globalThis.addEventListener('push', (event) => {
  const { title, body } = parsePayload(event)
  event.waitUntil(
    globalThis.registration.showNotification(title, {
      body,
      icon: '/icons/pwa-192.png',
      badge: '/icons/badge-72.png',
      tag: 'yunbiji-one',
      renotify: false,
    }),
  )
})

globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(globalThis.clients.openWindow('/'))
})
