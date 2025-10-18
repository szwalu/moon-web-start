<!-- src/App.vue -->
<script setup lang="ts">
import { RouterView } from 'vue-router'
import { NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider, darkTheme } from 'naive-ui'
import { useDark } from '@vueuse/core'
import { computed, onMounted } from 'vue'
import { useSupabaseTokenRefresh } from '@/composables/useSupabaseTokenRefresh'

// ✅ 启动令牌自动刷新（必须放在 <script setup> 里而不是外面）
useSupabaseTokenRefresh()

// ✅ 暗黑主题
const isDark = useDark()
const theme = computed(() => (isDark.value ? darkTheme : null))

// ✅ 第一步：注册 SW + 请求通知权限 + 本地测试一条通知
onMounted(async () => {
  try {
    if ('serviceWorker' in navigator)
      await navigator.serviceWorker.register('/sw.js')
    else
      return

    if ('Notification' in window) {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted')
        return
    }
    else {
      return
    }

    const reg = await navigator.serviceWorker.ready
    await reg.showNotification('云笔记 · 通知测试', {
      body: '✅ 通道已打通！下一步我们再接入 Supabase + 定时。',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
    })
  }
  catch (e) {
    console.warn('Notification test failed', e)
  }
})
</script>

<template>
  <NConfigProvider :theme="theme">
    <NMessageProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <AppProvider>
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
