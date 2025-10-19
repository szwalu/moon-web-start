<!-- src/App.vue (Safe Mode，止抖动版) -->
<script setup lang="ts">
import { RouterView } from 'vue-router'
import { NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider, darkTheme } from 'naive-ui'
import { useDark } from '@vueuse/core'
import { computed, onMounted } from 'vue'
import { useSupabaseTokenRefresh } from '@/composables/useSupabaseTokenRefresh'

useSupabaseTokenRefresh()

// 主题（仅保留最小逻辑）
const isDark = useDark()
const theme = computed(() => (isDark.value ? darkTheme : null))

// 仅注册 SW（无任何本地通知、无状态切换）
onMounted(async () => {
  try {
    if ('serviceWorker' in navigator) {
      // bump 版本号确保新 SW 生效
      await navigator.serviceWorker.register('/sw.js?v=5')
    }
  }
  catch {
    // 静默
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
/* —— 安全模式：彻底移除可能导致 iOS PWA 抖动的一切效果 —— */

/* 固定纯色背景；不使用任何渐变/网格；不使用过渡动画 */
html, body {
  background-color: #f5f6f7; /* 稍浅的灰白，柔和不刺眼 */
  background-image: none !important;
  background-size: auto !important;
  transition: none !important;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 暗色模式下亦保持纯色，避免渐变/网格 */
.dark html, .dark body {
  background-color: #121212 !important;
  background-image: none !important;
  transition: none !important;
}

/* iOS PWA 进一步兜底，禁用任何过渡与复杂绘制 */
@supports (-webkit-touch-callout: none) {
  html, body {
    background-image: none !important;
    transition: none !important;
    will-change: auto !important;
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
  }
}

/* 全局消息/通知容器位置（保持原样即可） */
.n-message-container,
.n-notification-container {
  top: 10% !important;
}
</style>
