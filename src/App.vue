<script setup>
import { RouterView } from 'vue-router'
import { NDialogProvider, NMessageProvider, NNotificationProvider } from 'naive-ui'
import { useSupabaseTokenRefresh } from '@/composables/useSupabaseTokenRefresh'

// 【重要】导入所有需要的 Provider 组件和我们新建的逻辑组件

// 启动令牌刷新
useSupabaseTokenRefresh()
</script>

<template>
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
</style>
