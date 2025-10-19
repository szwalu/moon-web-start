<script setup>
import { NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider, darkTheme } from 'naive-ui'
import { useDark } from '@vueuse/core'
import { computed } from 'vue'

// 1. 导入我们即将创建的新组件
import Main from './Main.vue'

// 暗黑模式逻辑保持不变
const isDark = useDark()
const theme = computed(() => (isDark.value ? darkTheme : null))
</script>

<template>
  <NConfigProvider :theme="theme">
    <NMessageProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <Main />
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style>
/* 你的全局样式保持不变 */
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
