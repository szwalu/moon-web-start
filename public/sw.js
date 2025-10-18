// public/sw.js
/* eslint-env serviceworker */

globalThis.addEventListener('install', () => globalThis.skipWaiting())
globalThis.addEventListener('activate', e => e.waitUntil(globalThis.clients.claim()))

globalThis.addEventListener('push', (event) => {
  let data = {}
  if (event.data) {
    try {
      data = event.data.json()
    }
    catch {
      data = {}
    }
  }
  const title = data.title || '云笔记'
  const body = data.body || '写点今天的想法吧～'

  event.waitUntil(
    globalThis.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
    }),
  )
})

globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c)
          return c.focus()
      }

      if (globalThis.clients.openWindow)
        return globalThis.clients.openWindow('/')
      return undefined
    }),
  )
})
