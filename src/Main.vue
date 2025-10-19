<script setup>
import { RouterView } from 'vue-router'
import { NButton, NLayout, NLayoutContent, NLayoutHeader, NSpace, useMessage } from 'naive-ui'
import { onMounted, ref } from 'vue'
import { useSupabaseTokenRefresh } from '@/composables/useSupabaseTokenRefresh'

// 启动令牌刷新
useSupabaseTokenRefresh()

// --- PWA 推送通知逻辑 ---
const publicVapidKey = 'BBiSxungGb4HJ5KBt4bTJ01_UiSqjJ9afGW7PiVBr3lx8K4jCASqdNdDLwTHxw6ORoWrxAu9sUGo671dfTfnWJQ'
const VITE_API_SERVER_URL = 'http://localhost:3000'
const isSubscribed = ref(false)
const swRegistration = ref(null)
const message = useMessage()

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i)
    outputArray[i] = rawData.charCodeAt(i)

  return outputArray
}

async function subscribeUser() {
  if (!('serviceWorker' in navigator && 'PushManager' in window)) {
    message.error('您的浏览器不支持推送通知。')
    return
  }
  try {
    const applicationServerKey = urlBase64ToUint8Array(publicVapidKey)
    const subscription = await swRegistration.value.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    })
    // console.log('用户 Push Subscription:', subscription); // <-- 已移除
    await fetch(`${VITE_API_SERVER_URL}/subscribe`, {
      method: 'POST',
      body: JSON.stringify(subscription),
      headers: {
        'content-type': 'application/json',
      },
    })
    // console.log('Subscription 已发送到服务器'); // <-- 已移除
    message.success('订阅成功！')
    isSubscribed.value = true
  }
  catch (error) {
    // console.error('订阅失败:', error); // <-- 已移除
    if (Notification.permission === 'denied')
      message.warning('您已拒绝通知权限，请在浏览器设置中重新开启。')
    else
      message.error('订阅失败，请稍后再试。')
  }
}

async function sendNotification() {
  // console.log('正在请求服务器发送通知...'); // <-- 已移除
  try {
    const response = await fetch(`${VITE_API_SERVER_URL}/send-notification`, { method: 'POST' })
    if (response.ok)
      message.success('发送指令已发出！')
    else
      throw new Error('服务器响应错误')
  }
  catch (error) {
    // console.error('发送请求失败:', error); // <-- 已移除
    message.error('发送请求失败，请检查服务器连接。')
  }
}

onMounted(async () => {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js')
      swRegistration.value = registration
      // console.log('Service Worker 已注册'); // <-- 已移除
      const subscription = await registration.pushManager.getSubscription()
      isSubscribed.value = !(subscription === null)
      if (isSubscribed.value) {
        // console.log('用户已经订阅过了。'); // <-- 已移除
      }
    }
    catch (error) {
      // console.error('Service Worker 注册失败:', error); // <-- 已移除
    }
  }
})
</script>

<template>
  <NLayout style="height: 100vh;">
    <NLayoutHeader bordered style="height: 64px; padding: 0 24px; display: flex; align-items: center; justify-content: space-between;">
      <span style="font-size: 1.2em; font-weight: bold;">我的笔记应用</span>
      <NSpace>
        <NButton v-if="!isSubscribed" type="primary" @click="subscribeUser">
          订阅通知
        </NButton>
        <NButton v-else type="success" @click="sendNotification">
          发送一条测试通知
        </NButton>
      </NSpace>
    </NLayoutHeader>
    <NLayoutContent content-style="padding: 24px;">
      <RouterView />
    </NLayoutContent>
  </NLayout>
</template>
