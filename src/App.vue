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
    // 1) 确保 SW 已注册
    await navigator.serviceWorker.register('/sw.js')

    // 2) 用户手势里请求权限（iOS 更稳）
    if (!('Notification' in window)) {
      showAskNotif.value = false
      return
    }
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') {
      showAskNotif.value = false
      return
    }

    // 3) 本地测试一条通知（验证通道）
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification('云笔记 · 通知测试', {
      body: '✅ 已开启通知！后续我们再接入 Supabase + 定时。',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
    })
  }
  catch (e) {
    // 静默忽略
    console.warn('enablePushOnce failed', e)
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
