/* public/sw.js */

/* 安装&激活：立刻接管 */
globalThis.addEventListener('install', (event) => {
  event.waitUntil(globalThis.skipWaiting())
})

globalThis.addEventListener('activate', (event) => {
  event.waitUntil(globalThis.clients.claim())
})

/* 接收推送：读取 payload，然后展示系统通知 */
globalThis.addEventListener('push', (event) => {
  let data = {}
  try {
    // 我们的 Edge Function 发送的是 JSON：{ title, body, url? }
    if (event.data)
      data = event.data.json()
  }
  catch (e) {
    // 兼容非 JSON 的情况
    data = { title: '云笔记', body: String(event.data || '收到提醒') }
  }

  const title = data.title || '云笔记'
  const body = data.body || '来写点今天的笔记吧～'
  const url = data.url || '/' // 点击通知要打开的地址（可按需自定义）

  const options = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { url },
  }

  event.waitUntil(globalThis.registration.showNotification(title, options))
})

/* 点击通知：唤起/打开页面 */
globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification && event.notification.data && event.notification.data.url) || '/'

  event.waitUntil((async () => {
    const allClients = await globalThis.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })

    // 如果已有打开的页面，就聚焦；没有就新开
    const client = allClients.find(c => c.url.includes(url))
    if (client)
      await client.focus()
    else
      await globalThis.clients.openWindow(url)
  })())
})
