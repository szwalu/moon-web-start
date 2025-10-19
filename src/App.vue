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
            <!-- ✅ 首次且仅在 PWA 独立模式下显示的“开启提醒”按钮（授权后不再出现） -->
            <div
              v-if="showEnableBtn"
              style="position: fixed; z-index: 9999; left: 50%; transform: translateX(-50%); bottom: 18px; background: #111; color:#fff; padding: 8px 12px; border-radius: 10px; font-size: 14px;"
            >
              <button
                style="background: transparent; color:#fff; font-size: 14px;"
                aria-label="开启每日提醒"
                @click="requestPermission"
              >
                开启每日提醒（每天 21:00）
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

// ✅ 新增：每日本地提醒（例：每天 21:00）
import { useDailyLocalReminder } from '@/composables/useDailyLocalReminder'
const { showEnableBtn, requestPermission } = useDailyLocalReminder({
hour: 22,
minute: 30,
  title: '云笔记 · 每日提醒',
  body: '来写点今天的笔记吧～',
})
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
