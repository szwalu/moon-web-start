<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'
import { toggleDark } from '@/utils/dark'
import { loadRemoteDataOnceAndMergeToLocal, useAutoSave } from '@/composables/useAutoSave'

const { manualSaveData } = useAutoSave()

// --- 修改点：将 isMobile 相关的定义和函数全部移到顶部 ---
const isMobile = ref(false)
const isMobileSafari = ref(false)
let scrollY = 0

function updateIsMobile() {
  isMobile.value = window.innerWidth <= 768
}

function handleFocusIn(event: FocusEvent) {
  const target = event.target as HTMLElement
  if (isMobile.value && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
    scrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.width = '100%'
    document.body.style.top = `-${scrollY}px`
  }
}

function handleFocusOut() {
  if (isMobile.value && document.body.style.position === 'fixed') {
    document.body.style.position = ''
    document.body.style.width = ''
    document.body.style.top = ''
    window.scrollTo(0, scrollY)
  }
}
// --- 修改点结束 ---

const safeTopStyle = computed(() => {
  return {
    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
  }
})

const route = useRoute()
const settingStore = useSettingStore()
const router = useRouter()

// setup 同步阶段的初始化
if (typeof window !== 'undefined') {
  document.documentElement.setAttribute('data-booting', '1')

  isMobileSafari.value = detectMobileSafari()
  updateIsMobile()

  if (isMobileSafari.value)
    settingStore.isSideNavOpen = false
  else
    settingStore.isSideNavOpen = !isMobile.value
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

onMounted(() => {
  window.addEventListener('resize', updateIsMobile, { passive: true })

  document.addEventListener('focusin', handleFocusIn)
  document.addEventListener('focusout', handleFocusOut)

  requestAnimationFrame(() => {
    document.documentElement.removeAttribute('data-booting')
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIsMobile)

  document.removeEventListener('focusin', handleFocusIn)
  document.removeEventListener('focusout', handleFocusOut)

  if (document.body.style.position === 'fixed')
    handleFocusOut()
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
    'text-$primary-c opacity-100': route.name === routeName,
  }
}

async function handleSettingsClick() {
  await manualSaveData()

  const {
    data: { session },
  } = await supabase.auth.getSession()

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
/* 可选：如果你的侧栏/遮罩类名是 .SideNav / .SideNavOverlay，可以用下面这段消除首帧过渡 */
:global(html[data-booting] .SideNav),
:global(html[data-booting] .SideNavOverlay) {
  transition: none !important;
}
</style>
