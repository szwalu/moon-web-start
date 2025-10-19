// public/sw.js

globalThis.addEventListener('push', (e) => {
  const data = e.data.json()
  const title = data.title || '默认标题'
  const options = {
    body: data.body || '默认内容',
    icon: 'icon.png', // 你可以放一张图片作为图标
  }

  e.waitUntil(globalThis.registration.showNotification(title, options))
})
