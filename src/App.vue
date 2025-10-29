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
/* —— 仅 iOS PWA 命中 —— */
.pwa-ios html,
.pwa-ios body,
.pwa-ios #app {
  /* 根层背景与应用一致，避免露出网格/浅灰 */
  background-color: var(--app-bg) !important;
  background-image: none !important;
  height: 100%;
  min-height: 100dvh !important;
  overflow-x: hidden;
}

/* 关键覆盖：用固定定位的“底部涂层”完全盖住安全区
   无论 bounce、滚动、容器阴影/圆角、甚至根层高度差，都看不到“白带” */
.pwa-ios body::after {
  content: "";
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: env(safe-area-inset-bottom, 0px);
  background: var(--app-bg);     /* 和应用背景完全一致 */
  pointer-events: none;
  z-index: 2147483647;           /* 顶层，确保盖住一切 */
}

/* 如果你是深色主题，var(--app-bg) 会跟随 .dark :root 覆写，无需额外处理 */
</style>
