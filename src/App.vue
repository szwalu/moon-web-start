<script setup>
import { RouterView } from 'vue-router'

// ✅ 新增：导入 Supabase 实例
import { NDialogProvider, NMessageProvider, NNotificationProvider } from 'naive-ui'
import { supabase } from '@/utils/supabaseClient'

// ✅ 保留原逻辑

// ✅ 新增：监听页面唤醒时刷新 session
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      // 强制刷新 session
      const { data: refreshed } = await supabase.auth.refreshSession()
      if (refreshed?.session?.user)
        window.__currentUser = refreshed.session.user
      else
        window.__currentUser = null
    }
    else {
      window.__currentUser = session.user
    }
  }
})
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
/* 样式保持不变 */
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
