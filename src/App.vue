<script setup>
import { RouterView } from 'vue-router'

// --- 1. 导入 NConfigProvider, darkTheme, useDark 和 computed ---
import { NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider, darkTheme } from 'naive-ui'
import { useDark } from '@vueuse/core'

// ✅ 新增: 引入生命周期钩子
import { computed, onMounted, onUnmounted } from 'vue'
import { useSupabaseTokenRefresh } from '@/composables/useSupabaseTokenRefresh'

// 启动令牌刷新
useSupabaseTokenRefresh()

// --- 2. 添加暗黑模式逻辑 ---
const isDark = useDark()
const theme = computed(() => (isDark.value ? darkTheme : null))

// --- 3. ✅ 新增: PWA 键盘弹起高度适配逻辑 ---
// 配合 index.html 的 fixed 锁定，解决 iOS 键盘遮挡光标问题
function updateAppHeight() {
  const app = document.getElementById('app')
  if (!app)
    return

  // 获取当前视觉视口的高度（键盘弹起时，这个值会变小）
  // 如果浏览器不支持 visualViewport，就降级使用 innerHeight
  const height = window.visualViewport ? window.visualViewport.height : window.innerHeight

  // 强制修改 #app 的高度，使其在键盘弹起时“变矮”，从而迫使内部滚动条生效
  app.style.height = `${height}px`

  // 防止 iOS 滚动偏移，强制重置
  window.scrollTo(0, 0)
}

onMounted(() => {
  // 监听可视视口变化（键盘弹起/收回）
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateAppHeight)
    window.visualViewport.addEventListener('scroll', updateAppHeight)
  }
  else {
    window.addEventListener('resize', updateAppHeight)
  }

  // 初始化执行一次
  updateAppHeight()
})

onUnmounted(() => {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', updateAppHeight)
    window.visualViewport.removeEventListener('scroll', updateAppHeight)
  }
  else {
    window.removeEventListener('resize', updateAppHeight)
  }
})
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
  /* ✅ 修改: 将高度改为 100%，跟随 JS 控制的 #app 高度变化 */
  /* 原来的 100lvh 会强制撑满屏幕，导致容器变矮时内容被切断 */
  height: 100%;
  min-height: 100%;

  padding-bottom: var(--safe-bottom);
  box-sizing: border-box;
  /* 确保内部滚动 */
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 恢复首帧临时去动画，避免猛烈闪一下 */
.restoring * {
  transition: none !important;
  animation: none !important;
}
</style>
