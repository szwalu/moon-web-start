<script setup>
import { RouterView } from 'vue-router'

// --- 1. 新增: 导入 NConfigProvider, darkTheme, useDark 和 computed ---
import { NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider, darkTheme } from 'naive-ui'
import { useDark } from '@vueuse/core'
import { computed } from 'vue'
import { useSupabaseTokenRefresh } from '@/composables/useSupabaseTokenRefresh'

// 启动令牌刷新
useSupabaseTokenRefresh()

// --- 2. 新增: 添加暗黑模式逻辑 ---
// useDark() 会自动检测并响应系统的暗黑模式切换
const isDark = useDark()

// 创建一个计算属性，当 isDark 为 true 时，应用 darkTheme，否则不应用任何特定主题（即为亮色模式）
const theme = computed(() => (isDark.value ? darkTheme : null))
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
/* 您的样式代码保持不变 */
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

/* 全局样式文件中 */
.n-message-container,
.n-notification-container {
  top: 10% !important;
}
/* iOS PWA 模式：强制根层纯色背景，消除底部白带 */
@supports (-webkit-touch-callout: none) {
  @media (display-mode: standalone) {
    html, body, #app {
      background-color: var(--app-bg) !important;
      background-image: none !important;
      min-height: 100dvh !important;
      overscroll-behavior-y: contain;
    }
  }
}
</style>
