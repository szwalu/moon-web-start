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
            <AppContainer class="full-viewport">
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
 }
 /* 仅在非静默期才允许背景过渡，避免回到 PWA 时那一下闪 */
 html:not(.restoring), body:not(.restoring) {
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

/* 让 html/body/#app 可被子元素 100% 高度继承 */
html, body, #app { height: 100%; }

/* 页面通用：真正铺到“最大视口”（含 home 指示条下方） */
:root { --safe-bottom: env(safe-area-inset-bottom, 0px); }

.full-viewport {
  /* 现代浏览器优先 */
  height: 100lvh;
  min-height: 100lvh;
  padding-bottom: var(--safe-bottom);
  box-sizing: border-box;
}

/* 旧 iOS / 老浏览器兜底 */
@supports not (height: 100lvh) {
  .full-viewport {
    height: 100dvh;
    min-height: -webkit-fill-available;
  }
}

/* 恢复首帧临时去动画，避免猛烈闪一下 */
.restoring * {
  transition: none !important;
  animation: none !important;
}
</style>
