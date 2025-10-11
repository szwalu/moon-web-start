<script setup lang="ts">
import { RouterView, useRouter } from 'vue-router'

// Naive UI 组件与主题
import {
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  NNotificationProvider,
  createDiscreteApi,
  darkTheme,
} from 'naive-ui'

// 其它依赖
import { useDark } from '@vueuse/core'
import { computed, onMounted, onUnmounted } from 'vue'
import { useSupabaseTokenRefresh } from '@/composables/useSupabaseTokenRefresh'

// 启动令牌刷新
useSupabaseTokenRefresh()

// 暗黑模式
const isDark = useDark()
const theme = computed(() => (isDark.value ? darkTheme : null))

const LAST_GLOBAL_REVIEW_KEY = 'last_global_review_date'
function setLastRemindToday() {
  const today = new Date().toISOString().slice(0, 10)
  localStorage.setItem(LAST_GLOBAL_REVIEW_KEY, today)
}

// 🔔 全局监听“今日回顾”事件（独立于 Provider，避免解析/时序问题）
onMounted(() => {
  const { message } = createDiscreteApi(['message'])
  const router = useRouter()

  const handler = (_e: CustomEvent) => {
    message.info('🔔 今日回顾：点这里打开你的复盘视图', {
      duration: 0,
      closable: true,
      onClick: () => {
        setLastRemindToday() // ✅ 点击时才标记今天已提醒
        router.push('/calendar') // 可选：点击即跳转
        message.destroyAll()
      },
      onClose: () => {
        // 仅关闭不记账：用户手滑关了，还能再看到
        // 如果你想“关闭也算确认”，就在这里也调用 setLastRemindToday()
      },
    })
  }

  window.addEventListener('review-reminder', handler as EventListener)
  onUnmounted(() => window.removeEventListener('review-reminder', handler as EventListener))
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
</style>
