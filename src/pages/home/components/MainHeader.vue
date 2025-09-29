<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'
import { toggleDark } from '@/utils/dark'
import { loadRemoteDataOnceAndMergeToLocal, useAutoSave } from '@/composables/useAutoSave'

const { manualSaveData } = useAutoSave()

const route = useRoute()
const settingStore = useSettingStore()
const router = useRouter()

/** ===== 关键：仍然保留你的 safeTopStyle，用 JS 决定何时叠加 env() ===== */
const safeTopStyle = ref<{ paddingTop: string }>({ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' })
const headerWrapRef = ref<HTMLElement | null>(null)

function applyTopPaddingByScrollPos() {
  // 只要页面不是在“最顶部”，就只保留 8px；在最顶部就叠加安全区高度
  if (window.scrollY <= 0)
    safeTopStyle.value = { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }
  else
    safeTopStyle.value = { paddingTop: '8px' }
}

const isMobile = ref(false)
const isMobileSafari = ref(false)

function updateIsMobile() {
  isMobile.value = window.innerWidth <= 768
}

function detectMobileSafari() {
  const ua = navigator.userAgent
  const isiOS
    = /iP(hone|od|ad)/.test(ua)
    || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1)
  const isSafari
    = /Safari/.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Mercury)/.test(ua)
  return isiOS && isSafari
}

/**
 * 在 setup 同步阶段就设置默认状态，避免 iOS Safari 首帧“先开再关”
 */
if (typeof window !== 'undefined') {
  document.documentElement.setAttribute('data-booting', '1')

  isMobileSafari.value = detectMobileSafari()
  updateIsMobile()

  if (isMobileSafari.value)
    settingStore.isSideNavOpen = false
  else
    settingStore.isSideNavOpen = !isMobile.value
}

onMounted(() => {
  // 初始根据滚动位置设置一次（此时通常 scrollY = 0）
  applyTopPaddingByScrollPos()

  // 滚动时动态切换 safe-area 顶部内边距
  const onScroll = () => {
    // 用 rAF 防抖一帧，避免频繁布局
    requestAnimationFrame(applyTopPaddingByScrollPos)
  }
  window.addEventListener('scroll', onScroll, { passive: true })

  // 窗口尺寸变化也要重算一次
  window.addEventListener('resize', () => requestAnimationFrame(applyTopPaddingByScrollPos), { passive: true })

  // ✅ iOS 关键：键盘/地址栏动画会触发 visualViewport 变化
  if (isMobileSafari.value && 'visualViewport' in window) {
    const vv = (window as any).visualViewport as VisualViewport
    const tick = () => requestAnimationFrame(applyTopPaddingByScrollPos)
    vv.addEventListener('resize', tick)
    vv.addEventListener('scroll', tick)
    onBeforeUnmount(() => {
      vv.removeEventListener('resize', tick)
      vv.removeEventListener('scroll', tick)
    })
  }

  // 恢复过渡：放到下一帧，确保首帧渲染完成
  requestAnimationFrame(() => {
    document.documentElement.removeAttribute('data-booting')
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', applyTopPaddingByScrollPos as any)
  window.removeEventListener('resize', applyTopPaddingByScrollPos as any)
})

const user = ref<any>(null)
onMounted(() => {
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
  })
})

const logoPath = ref('/logow.jpg')
onMounted(async () => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session)
    logoPath.value = '/logo.jpg'
})

function getIconClass(routeName: string) {
  return {
    'text-$primary-c opacity-100': routeName === route.name,
  }
}

async function handleSettingsClick() {
  await manualSaveData()

  const { data: { session } } = await supabase.auth.getSession()
  if (session) {
    setTimeout(() => {
      loadRemoteDataOnceAndMergeToLocal()
    }, 2500)
  }
  else {
    const hasLoggedInBefore = localStorage.getItem('hasLoggedInBefore')
    if (hasLoggedInBefore) {
      // $message.warning(t('auth.please_login'))
    }
  }
  router.push('/setting')
}
</script>

<template>
  <div
    ref="headerWrapRef"
    class="flex items-center justify-between px-4 lg:px-8 md:px-6"
    :style="safeTopStyle"
  >
    <div class="header-left flex items-center gap-x-4">
      <HamburgerButton class="text-gray-700 dark:text-gray-300" />
      <RouterLink v-if="isMobile && !settingStore.isSideNavOpen" to="/auth">
        <img
          :src="logoPath"
          alt="Logo"
          class="w-auto h-32"
        >
      </RouterLink>
    </div>

    <div class="flex items-center gap-x-11">
      <RouterLink
        v-if="settingStore.isSetting"
        class="text-7xl"
        :class="[getIconClass('home')]"
        to="/"
        i-carbon:home
        icon-btn
      />
      <div
        v-else
        class="text-7xl"
        i-carbon:settings
        icon-btn
        @click="handleSettingsClick"
      />
      <div
        class="text-7xl"
        i-carbon:moon
        dark:i-carbon:light
        icon-btn
        @click="() => toggleDark()"
      />
    </div>
  </div>
</template>

<style scoped>
/* 仍保留你的首帧过渡禁用 */
:global(html[data-booting] .SideNav),
:global(html[data-booting] .SideNavOverlay) {
  transition: none !important;
}
</style>
