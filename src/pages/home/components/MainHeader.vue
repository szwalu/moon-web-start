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

/** 首帧：与原逻辑一致 */
if (typeof window !== 'undefined') {
  document.documentElement.setAttribute('data-booting', '1')
  isMobileSafari.value = detectMobileSafari()
  updateIsMobile()
  if (isMobileSafari.value)
    settingStore.isSideNavOpen = false
  else settingStore.isSideNavOpen = !isMobile.value
}

const headerEl = ref<HTMLElement | null>(null)

/** 计算并写入头部实际高度（用于 spacer 占位），避免“拉大间距” */
function writeHeaderHeightVar() {
  const h = headerEl.value?.offsetHeight ?? 56 // 合理缺省
  document.documentElement.style.setProperty('--header-h', `${h}px`)
}

onMounted(() => {
  window.addEventListener('resize', updateIsMobile, { passive: true })

  // 头部渲染后写一次高度；延迟到下一帧更准确
  requestAnimationFrame(() => {
    writeHeaderHeightVar()
    document.documentElement.removeAttribute('data-booting')
  })

  // iOS 键盘/地址栏变化 → 视口变化，重算一次高度更稳妥
  if (isMobileSafari.value && 'visualViewport' in window) {
    const vv = (window as any).visualViewport as VisualViewport
    const tick = () => requestAnimationFrame(writeHeaderHeightVar)
    vv.addEventListener('resize', tick)
    vv.addEventListener('scroll', tick)
    onBeforeUnmount(() => {
      vv.removeEventListener('resize', tick)
      vv.removeEventListener('scroll', tick)
    })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIsMobile)
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
  <!-- ✅ spacer：只占“头部实际高度 + 刘海安全区”，不额外放大页面间距 -->
  <div class="header-spacer" aria-hidden="true" />

  <!-- ✅ 头部固定在 safe-area 之下，无论滚动/聚焦都不会进刘海 -->
  <div ref="headerEl" class="header-fixed flex items-center justify-between px-4 lg:px-8 md:px-6">
    <div class="header-left flex items-center gap-x-4">
      <HamburgerButton class="text-gray-700 dark:text-gray-300" />
      <RouterLink v-if="isMobile && !settingStore.isSideNavOpen" to="/auth">
        <img :src="logoPath" alt="Logo" class="w-auto h-32">
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
:root { --sat: env(safe-area-inset-top); }

/* 占位元素：恰好等于头部本体高度 + 刘海安全区 */
.header-spacer {
  height: calc(var(--header-h, 56px) + var(--sat));
}

/* 头部本体：固定在视口 top = 刘海安全区，保留你原来的 8px 视觉内边距 */
.header-fixed {
  position: fixed;
  top: var(--sat);
  left: 0;
  right: 0;
  padding-top: 8px;
  z-index: 100; /* 高于内容 */
  background: var(--body-bg, transparent);
  /* 可选：若顶部有透底闪烁，可给背景色或加一点点模糊 */
  /* backdrop-filter: saturate(100%) blur(0px); */
}

/* 首帧过渡禁用：与原逻辑一致 */
:global(html[data-booting] .SideNav),
:global(html[data-booting] .SideNavOverlay) {
  transition: none !important;
}
</style>
