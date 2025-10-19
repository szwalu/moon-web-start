<!-- src/App.vue -->
<script setup lang="ts">
import { RouterView } from 'vue-router'
import { NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider, darkTheme } from 'naive-ui'
import { useDark } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'
import { useSupabaseTokenRefresh } from '@/composables/useSupabaseTokenRefresh'

import { supabase } from '@/utils/supabaseClient'
import {
  createPushSubscription,
  flushPendingSubscriptionIfAny,
  savePendingLocal,
  savePushSubscription,
} from '@/composables/useWebPushSubscribe'

useSupabaseTokenRefresh()

// 主题
const isDark = useDark()
const theme = computed(() => (isDark.value ? darkTheme : null))

// UI 状态（不要在顶层访问 window/navigator，先置为 false，mounted 再判断）
const showAskNotif = ref(false)
const showDebugBtn = ref(false)

// 通知工具：所有可见反馈统一用系统通知（避免 no-alert / no-console）
async function notify(title: string, body?: string) {
  try {
    if (!('serviceWorker' in navigator))
      return
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
    })
  }
  catch {}
}

// 允许通知（按钮触发）
async function enablePushOnce() {
  try {
    if (!('serviceWorker' in navigator)) {
      showAskNotif.value = false
      return
    }
    await navigator.serviceWorker.register('/sw.js')

    if (!('Notification' in window)) {
      showAskNotif.value = false
      return
    }
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') {
      showAskNotif.value = false
      return
    }

    // 先给出通道已通
    await notify('云笔记 · 通知测试', '✅ 通道正常。接下来尝试订阅并保存到云端…')

    // 订阅 + 保存
    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
    if (!publicKey) {
      await notify('云笔记 · 缺少公钥', '❗请配置 VITE_VAPID_PUBLIC_KEY 后重试')
      showAskNotif.value = false
      return
    }

    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) {
      const subJson = await createPushSubscription()
      try {
        await savePushSubscription(subJson)
        await notify('云笔记 · 订阅已保存', '✅ 已写入 webpush_subscriptions（或待登录后自动写入）')
      }
      catch (e: any) {
        if (String(e?.message) === 'NEED_LOGIN') {
          savePendingLocal(subJson)
          await notify('云笔记 · 待登录', 'ℹ️ 订阅已本地暂存，登录后会自动保存到云端')
        }
        else {
          await notify('云笔记 · 保存失败', '❗保存订阅到云端失败，请稍后再试')
        }
      }
    }
    else {
      const subJson = sub.toJSON()
      try {
        await savePushSubscription(subJson)
        await notify('云笔记 · 订阅已存在', '✅ 已确认写入云端')
      }
      catch (e: any) {
        if (String(e?.message) === 'NEED_LOGIN') {
          savePendingLocal(subJson)
          await notify('云笔记 · 待登录', 'ℹ️ 订阅已本地暂存，登录后会自动保存到云端')
        }
        else {
          await notify('云笔记 · 保存失败', '❗保存订阅到云端失败，请稍后再试')
        }
      }
    }
  }
  catch {
    await notify('云笔记 · 操作失败', '❗请稍后再试')
  }
  finally {
    showAskNotif.value = false
  }
}

// 调试按钮：逐步做检查并尽量写库（只用系统通知做反馈）
async function debugSubscribeNow() {
  try {
    if (!('serviceWorker' in navigator)) {
      await notify('调试', 'SW 不支持')
      return
    }
    await navigator.serviceWorker.register('/sw.js')
    const reg = await navigator.serviceWorker.ready
    await notify('调试', 'SW: ready')

    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
    await notify('调试', `VAPID 公钥前 12：${publicKey ? publicKey.slice(0, 12) : '缺失'}`)
    if (!publicKey) {
      await notify('缺少公钥', '配置 VITE_VAPID_PUBLIC_KEY 后重试')
      return
    }

    const { data: userData } = await supabase.auth.getUser()
    const uid = userData?.user?.id
    await notify('调试', `当前用户：${uid || '未登录'}`)
    if (!uid) {
      const exist = await reg.pushManager.getSubscription()
      const subJson = exist?.toJSON() ?? await createPushSubscription()
      savePendingLocal(subJson)
      await notify('待登录', '订阅已暂存，登录后会自动写入')
      return
    }

    const sub = await reg.pushManager.getSubscription()
    if (!sub) {
      const subJson = await createPushSubscription()
      try {
        await savePushSubscription(subJson)
        await notify('订阅已保存', '✅ 写库成功')
      }
      catch (e: any) {
        await notify('写库失败', String(e?.message || e).slice(0, 120))
      }
    }
    else {
      const subJson = sub.toJSON()
      try {
        await savePushSubscription(subJson)
        await notify('订阅已保存', '✅ 已确认写入云端')
      }
      catch (e: any) {
        await notify('写库失败', String(e?.message || e).slice(0, 120))
      }
    }

    await flushPendingSubscriptionIfAny()
  }
  catch (e) {
    await notify('调试异常', '❗请稍后再试')
  }
  finally {
    showDebugBtn.value = true
  }
}

// 挂载后再做环境判断与自动检查（避免顶层访问 window/navigator）
onMounted(async () => {
  try {
    if ('serviceWorker' in navigator)
      await navigator.serviceWorker.register('/sw.js')
    else
      return

    // 环境判断放到运行期
    const isStandalone
      = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || ((navigator as any).standalone === true)

    // 权限是 default 时展示引导按钮
    if (typeof Notification !== 'undefined' && Notification.permission === 'default' && isStandalone)
      showAskNotif.value = true
    else
      showAskNotif.value = false

    // 已授权时显示调试按钮
    showDebugBtn.value
      = typeof Notification !== 'undefined'
      && Notification.permission === 'granted'
      && isStandalone

    // 自动检查：已授权则尝试订阅并保存
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker.ready
      await notify('云笔记 · 自动检查', '✅ 权限已授予，正在确认订阅并保存到云端…')

      const sub = await reg.pushManager.getSubscription()
      if (!sub) {
        const subJson = await createPushSubscription()
        try {
          await savePushSubscription(subJson)
          await notify('云笔记 · 订阅已保存', '✅ 已写入 webpush_subscriptions（或待登录后自动写入）')
        }
        catch (e: any) {
          if (String(e?.message) === 'NEED_LOGIN') {
            savePendingLocal(subJson)
            await notify('云笔记 · 待登录', 'ℹ️ 订阅已本地暂存，登录后会自动保存到云端')
          }
          else {
            await notify('云笔记 · 保存失败', '❗保存订阅失败，请稍后再试')
          }
        }
      }
      else {
        const subJson = sub.toJSON()
        try {
          await savePushSubscription(subJson)
          await notify('云笔记 · 已确认', '✅ 订阅已存在并已写入云端')
        }
        catch (e: any) {
          if (String(e?.message) === 'NEED_LOGIN') {
            savePendingLocal(subJson)
            await notify('云笔记 · 待登录', 'ℹ️ 订阅已本地暂存，登录后会自动写入')
          }
          else {
            await notify('云笔记 · 保存失败', '❗保存订阅失败，请稍后再试')
          }
        }
      }

      await flushPendingSubscriptionIfAny()
    }
  }
  catch {
    // 静默忽略
  }
})
</script>

<template>
  <NConfigProvider :theme="theme">
    <NMessageProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <AppProvider>
            <!-- 调试按钮（权限已授予 + PWA 独立模式时显示） -->
            <div
              v-if="showDebugBtn"
              style="position: fixed; z-index: 9999; left: 50%; transform: translateX(-50%); bottom: 58px; background: #0069d9; color:#fff; padding: 10px 14px; border-radius: 10px;"
            >
              <button
                style="background: transparent; color:#fff; font-size: 14px;"
                aria-label="调试订阅保存"
                @click="debugSubscribeNow"
              >
                调试订阅保存
              </button>
            </div>

            <!-- 仅在 iOS PWA 且尚未授权时出现的一次性按钮 -->
            <div
              v-if="showAskNotif"
              style="position: fixed; z-index: 9999; left: 50%; transform: translateX(-50%); bottom: 18px; background: #111; color:#fff; padding: 10px 14px; border-radius: 10px;"
            >
              <button
                style="background: transparent; color:#fff; font-size: 14px;"
                aria-label="允许通知（点击测试）"
                @click="enablePushOnce"
              >
                允许通知（点击测试）
              </button>
            </div>

            <AppContainer>
              <RouterView />
            </AppContainer>
          </AppProvider>
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style>
body, html {
  background-color: #e9ecef;
  background-image:
    linear-gradient(rgba(0, 0, 0, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.06) 1px, transparent 1px);
  background-size: 25px 25px;
  transition: background-color 0.3s ease;
}
.dark body, .dark html {
  background-color: #1a1a1a;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
}
.n-message-container,
.n-notification-container {
  top: 10% !important;
}
</style>
