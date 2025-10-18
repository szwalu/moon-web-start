<!-- src/App.vue -->
<script setup lang="ts">
import { RouterView } from 'vue-router'
import { NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider, darkTheme } from 'naive-ui'
import { useDark } from '@vueuse/core'
import { computed, ref } from 'vue'
import { useSupabaseTokenRefresh } from '@/composables/useSupabaseTokenRefresh'

// ✅ 启动 Supabase 令牌自动刷新
useSupabaseTokenRefresh()

// ✅ 暗黑主题
const isDark = useDark()
const theme = computed(() => (isDark.value ? darkTheme : null))

// ✅ 在 iOS PWA 独立模式下，用“用户手势”触发权限请求更稳
const isStandalone
  = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  || ((navigator as any)?.standalone === true)

const canAsk
  = typeof Notification !== 'undefined'
  && typeof window !== 'undefined'
  && Notification.permission === 'default'

const showAskNotif = ref(Boolean(isStandalone && canAsk))

async function enablePushOnce() {
  try {
    if (!('serviceWorker' in navigator)) {
      showAskNotif.value = false
      return
    }
    // 确保 SW 已注册
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

    // ✅ 先立即给出“通道已通”的可见反馈
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification('云笔记 · 通知测试', {
      body: '✅ 通道正常。接下来尝试订阅并保存到云端…',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
    })

    // ✅ 再做订阅 + 保存（任何失败都会再弹提示）
    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
    if (!publicKey) {
      await reg.showNotification('云笔记 · 缺少公钥', {
        body: '❗缺少 VITE_VAPID_PUBLIC_KEY，请在 .env.local 或 Vercel 环境变量中配置',
        icon: '/icons/icon-192.png',
      })
      showAskNotif.value = false
      return
    }

    // 复用/创建订阅
    const ready = await navigator.serviceWorker.ready
    const sub = await ready.pushManager.getSubscription()
    if (!sub) {
      const { createPushSubscription } = await import('@/composables/useWebPushSubscribe')
      const subJson = await createPushSubscription()
      // 保存
      try {
        const { savePushSubscription } = await import('@/composables/useWebPushSubscribe')
        await savePushSubscription(subJson)
        await reg.showNotification('云笔记 · 订阅已保存', {
          body: '✅ 已写入 webpush_subscriptions（或待登录后自动写入）',
          icon: '/icons/icon-192.png',
        })
      }
      catch (e: any) {
        const { savePendingLocal } = await import('@/composables/useWebPushSubscribe')
        if (String(e?.message) === 'NEED_LOGIN') {
          savePendingLocal(subJson)
          await reg.showNotification('云笔记 · 待登录', {
            body: 'ℹ️ 订阅已本地暂存，登录后会自动保存到云端',
            icon: '/icons/icon-192.png',
          })
        }
        else {
          await reg.showNotification('云笔记 · 保存失败', {
            body: '❗保存订阅到云端失败，请查看控制台',
            icon: '/icons/icon-192.png',
          })
          console.warn('savePushSubscription error', e)
        }
      }
    }
    else {
      // 已存在订阅：也尝试保存一次（避免之前没写入）
      const subJson = sub.toJSON()
      try {
        const { savePushSubscription } = await import('@/composables/useWebPushSubscribe')
        await savePushSubscription(subJson)
        await reg.showNotification('云笔记 · 订阅已存在', {
          body: '✅ 已确认写入云端',
          icon: '/icons/icon-192.png',
        })
      }
      catch (e: any) {
        const { savePendingLocal } = await import('@/composables/useWebPushSubscribe')
        if (String(e?.message) === 'NEED_LOGIN') {
          savePendingLocal(subJson)
          await reg.showNotification('云笔记 · 待登录', {
            body: 'ℹ️ 订阅已本地暂存，登录后会自动保存到云端',
            icon: '/icons/icon-192.png',
          })
        }
        else {
          await reg.showNotification('云笔记 · 保存失败', {
            body: '❗保存订阅到云端失败，请查看控制台',
            icon: '/icons/icon-192.png',
          })
          console.warn('savePushSubscription error', e)
        }
      }
    }
  }
  catch (e) {
    console.warn('enablePushOnce failed', e)
    try {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification('云笔记 · 操作失败', {
        body: '❗请查看控制台错误信息',
        icon: '/icons/icon-192.png',
      })
    }
    catch {}
  }
  finally {
    showAskNotif.value = false
  }
}
</script>

<template>
  <NConfigProvider :theme="theme">
    <NMessageProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <AppProvider>
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

/* 全局消息/通知容器位置微调 */
.n-message-container,
.n-notification-container {
  top: 10% !important;
}
</style>
