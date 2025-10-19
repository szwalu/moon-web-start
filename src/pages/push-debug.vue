<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'

const message = useMessage()

const isStandalone = ref(false)
const hasSW = ref(false)
const hasNotif = ref(false)
const permission = ref<'default' | 'denied' | 'granted'>('default')

onMounted(() => {
  isStandalone.value
    = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || ((navigator as any).standalone === true)
  hasSW.value = 'serviceWorker' in navigator
  hasNotif.value = 'Notification' in window
  permission.value = (window as any).Notification?.permission ?? 'default'
})

// ========== A. 触发系统权限弹窗（必须用户点击触发） ==========
async function ask() {
  try {
    if (!('Notification' in window)) {
      message.error('设备不支持 Notification')
      return
    }
    if (!('serviceWorker' in navigator)) {
      message.error('无 Service Worker')
      return
    }

    // 注册 SW（强制版本号，确保是最新）
    await navigator.serviceWorker.register('/sw.js?v=perm-check-1')
    const perm = await Notification.requestPermission()
    permission.value = perm
    message.info(`权限结果：${perm}`)
  }
  catch (e: any) {
    message.error(`异常：${e?.message || String(e)}`)
  }
}

// ========== B. 本地测试通知（不走网络，证明设备端能展示） ==========
async function localNotify() {
  try {
    if (!('serviceWorker' in navigator)) {
      message.error('无 Service Worker')
      return
    }
    await navigator.serviceWorker.register('/sw.js?v=perm-check-1')
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification('本地测试通知', {
      body: '这条通知不走网络，只测试展示',
      icon: '/icons/pwa-192.png',
      badge: '/icons/badge-72.png',
      tag: 'debug-local',
      renotify: false,
    })
    message.success('已尝试显示（锁屏或通知中心查看）')
  }
  catch (e: any) {
    message.error(`异常：${e?.message || String(e)}`)
  }
}
</script>

<template>
  <div style="padding:16px;font-family:system-ui, -apple-system">
    <h2>Push 权限自检</h2>
    <ul style="line-height:1.8">
      <li>isStandalone: <b>{{ isStandalone }}</b></li>
      <li>SW 支持: <b>{{ hasSW }}</b></li>
      <li>Notification 支持: <b>{{ hasNotif }}</b></li>
      <li>当前权限: <b>{{ permission }}</b></li>
    </ul>

    <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap">
      <button style="padding:8px 12px" @click="ask">A. 触发系统“允许通知”弹窗</button>
      <button style="padding:8px 12px" @click="localNotify">B. 本地测试通知</button>
    </div>

    <p style="margin-top:12px;color:#666">
      提示：A 需要用户手势；若没弹出，先删除 PWA 并清理网站数据后重试。
      B 不走网络，仅测本地展示（前台不一定横幅，锁屏/通知中心查看）。
    </p>
  </div>
</template>
