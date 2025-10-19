<!-- src/App.vue -->
<script setup lang="ts">
import { RouterView } from 'vue-router'
import { NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider, darkTheme } from 'naive-ui'
import { useDark } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'
import { useSupabaseTokenRefresh } from '@/composables/useSupabaseTokenRefresh'

useSupabaseTokenRefresh()

// ============== 主题 ==============
const isDark = useDark()
const theme = computed(() => (isDark.value ? darkTheme : null))

// ============== UI 状态 ==============
const showAskNotif = ref(false)
const showDebugBtn = ref(false)

// 是否显示本地系统级通知（调试用，默认关闭，避免页面闪动）
const DEBUG_LOCAL_TOAST = false

// 统一系统通知（受 DEBUG_LOCAL_TOAST 控制）
async function notify(title: string, body?: string) {
  if (!DEBUG_LOCAL_TOAST)
    return
  try {
    if (!('serviceWorker' in navigator))
      return
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: 'daily-note',
      renotify: false,
    })
  }
  catch {}
}

// 统一获取 VAPID 公钥（优先环境变量，必要时可临时硬编码一串公钥）
const PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

// ============== 允许通知（按钮触发） ==============
async function enablePushOnce() {
  try {
    if (!('serviceWorker' in navigator)) {
      showAskNotif.value = false
      return
    }
    // 强制加载最新 SW，避免旧 SW 引起前端异常重绘
    await navigator.serviceWorker.register('/sw.js?v=4')

    if (!('Notification' in window)) {
      showAskNotif.value = false
      return
    }
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') {
      showAskNotif.value = false
      return
    }

    // 订阅 + 保存（静默执行，不弹本地通知）
    if (!PUBLIC_KEY) {
      await notify('云笔记 · 缺少公钥', '请配置 VITE_VAPID_PUBLIC_KEY 后重试')
      showAskNotif.value = false
      return
    }

    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    if (!existing) {
      const { createPushSubscription, savePushSubscription, savePendingLocal } = await import('@/composables/useWebPushSubscribe')
      const subJson = await createPushSubscription(PUBLIC_KEY)
      try {
        await savePushSubscription(subJson)
        await notify('云笔记 · 订阅已保存', '已写入 webpush_subscriptions')
      }
      catch (e: any) {
        if (String(e?.message) === 'NEED_LOGIN') {
          savePendingLocal(subJson)
          await notify('云笔记 · 待登录', '订阅已本地暂存，登录后会自动写入')
        }
        else {
          await notify('云笔记 · 保存失败', '保存订阅到云端失败，请稍后再试')
          console.warn('savePushSubscription error', e)
        }
      }
    }
    else {
      const subJson = existing.toJSON()
      const { savePushSubscription, savePendingLocal } = await import('@/composables/useWebPushSubscribe')
      try {
        await savePushSubscription(subJson)
        await notify('云笔记 · 订阅已存在', '已确认写入云端')
      }
      catch (e: any) {
        if (String(e?.message) === 'NEED_LOGIN') {
          savePendingLocal(subJson)
          await notify('云笔记 · 待登录', '订阅已本地暂存，登录后会自动写入')
        }
        else {
          await notify('云笔记 · 保存失败', '保存订阅到云端失败，请稍后再试')
          console.warn('savePushSubscription error', e)
        }
      }
    }
  }
  catch {
    await notify('云笔记 · 操作失败', '请稍后再试')
  }
  finally {
    showAskNotif.value = false
  }
}

// ============== 调试按钮（手动触发入库） ==============
async function debugSubscribeNow() {
  try {
    if (!('serviceWorker' in navigator)) {
      await notify('调试', 'SW 不支持')
      return
    }
    await navigator.serviceWorker.register('/sw.js?v=4')
    const reg = await navigator.serviceWorker.ready
    await notify('调试', 'SW: ready')

    const publicKey = PUBLIC_KEY
    await notify('调试', `VAPID 公钥前 12：${publicKey ? publicKey.slice(0, 12) : '缺失'}`)
    if (!publicKey) {
      await notify('缺少公钥', '配置 VITE_VAPID_PUBLIC_KEY 后重试')
      return
    }

    const { supabase } = await import('@/utils/supabaseClient')
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData?.user?.id
    await notify('调试', `当前用户：${uid || '未登录'}`)

    const sub = await reg.pushManager.getSubscription()
    const { createPushSubscription, savePushSubscription, savePendingLocal, flushPendingSubscriptionIfAny } = await import('@/composables/useWebPushSubscribe')

    if (!uid) {
      const subJson = sub?.toJSON() ?? await createPushSubscription(publicKey)
      savePendingLocal(subJson)
      await notify('待登录', '订阅已暂存，登录后会自动写入')
      return
    }

    if (!sub) {
      const subJson = await createPushSubscription(publicKey)
      try {
        await savePushSubscription(subJson)
        await notify('订阅已保存', '写库成功')
      }
      catch (e: any) {
        await notify('写库失败', String(e?.message || e).slice(0, 120))
      }
    }
    else {
      const subJson = sub.toJSON()
      try {
        await savePushSubscription(subJson)
        await notify('订阅已保存', '已确认写入云端')
      }
      catch (e: any) {
        await notify('写库失败', String(e?.message || e).slice(0, 120))
      }
    }

    await flushPendingSubscriptionIfAny()
  }
  catch {
    await notify('调试异常', '请稍后再试')
  }
  finally {
    showDebugBtn.value = true
  }
}

// ============== 自动初始化（静默，不弹本地通知） ==============
onMounted(async () => {
  try {
    if ('serviceWorker' in navigator) {
      // 强制版本号，确保新 SW 生效，避免旧 SW 造成重绘
      await navigator.serviceWorker.register('/sw.js?v=4')
    }
    else {
      return
    }

    const isStandalone
      = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || ((navigator as any).standalone === true)

    // 权限：default 才展示按钮引导
    if (typeof Notification !== 'undefined' && Notification.permission === 'default' && isStandalone)
      showAskNotif.value = true
    else
      showAskNotif.value = false

    // 已授权时显示“调试订阅保存”按钮
    showDebugBtn.value
      = typeof Notification !== 'undefined'
      && Notification.permission === 'granted'
      && isStandalone

    // 已授权：静默确认订阅并入库（不弹本地通知，避免闪动）
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      if (!PUBLIC_KEY)
        return
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (!sub) {
        const { createPushSubscription, savePushSubscription, savePendingLocal } = await import('@/composables/useWebPushSubscribe')
        const subJson = await createPushSubscription(PUBLIC_KEY)
        try {
          await savePushSubscription(subJson)
        }
        catch (e: any) {
          if (String(e?.message) === 'NEED_LOGIN')
            savePendingLocal(subJson)
          else
            console.warn('savePushSubscription error', e)
        }
      }
      else {
        const subJson = sub.toJSON()
        const { savePushSubscription, savePendingLocal, flushPendingSubscriptionIfAny } = await import('@/composables/useWebPushSubscribe')
        try {
          await savePushSubscription(subJson)
        }
        catch (e: any) {
          if (String(e?.message) === 'NEED_LOGIN')
            savePendingLocal(subJson)
          else
            console.warn('savePushSubscription error', e)
        }
        await flushPendingSubscriptionIfAny()
      }
    }
  }
  catch {
    // 静默忽略
  }
})
</script>

<template>
  <NConfigProvider :theme="theme">
    <NMessageProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <AppProvider>
            <!-- 调试按钮（权限已授予 + PWA 独立模式时显示） -->
            <div
              v-if="showDebugBtn"
              style="position: fixed; z-index: 9999; left: 50%; transform: translateX(-50%); bottom: 58px; background: #0069d9; color:#fff; padding: 10px 14px; border-radius: 10px; will-change: transform; -webkit-backface-visibility: hidden;"
            >
              <button
                style="background: transparent; color:#fff; font-size: 14px;"
                aria-label="调试订阅保存"
                @click="debugSubscribeNow"
              >
                调试订阅保存
              </button>
            </div>

            <!-- 仅在 iOS PWA 且尚未授权时出现的一次性按钮 -->
            <div
              v-if="showAskNotif"
              style="position: fixed; z-index: 9999; left: 50%; transform: translateX(-50%); bottom: 18px; background: #111; color:#fff; padding: 10px 14px; border-radius: 10px; will-change: transform; -webkit-backface-visibility: hidden;"
            >
              <button
                style="background: transparent; color:#fff; font-size: 14px;"
                aria-label="允许通知（点击测试）"
                @click="enablePushOnce"
              >
                允许通知（点击测试）
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

<style>
/* —— 基础背景（移除过渡，减少 iOS PWA 闪屏） —— */
body, html {
  background-color: #e9ecef;
  background-image:
    linear-gradient(rgba(0, 0, 0, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.06) 1px, transparent 1px);
  background-size: 25px 25px;
  /* transition: background-color 0.3s ease;  ← 去掉避免 iOS 渐隐闪屏 */
}

.dark body, .dark html {
  background-color: #1a1a1a;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
}

/* —— iOS PWA 定向优化：禁用过渡与网格渐变，进一步止闪 —— */
@supports (-webkit-touch-callout: none) {
  html, body { transition: none !important; }
  /* 如仍有闪动，可取消下面两行注释，彻底移除背景网格 */
  /* body, html { background-image: none !important; } */
}

/* 全局消息/通知容器位置微调 */
.n-message-container,
.n-notification-container {
  top: 10% !important;
}
</style>
