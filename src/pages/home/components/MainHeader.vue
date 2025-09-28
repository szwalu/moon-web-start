<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'
import { toggleDark } from '@/utils/dark'
import { loadRemoteDataOnceAndMergeToLocal, useAutoSave } from '@/composables/useAutoSave'

const { manualSaveData } = useAutoSave()

// ================== 头部安全区 ==================
const safeTopStyle = computed(() => {
  return {
    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
  }
})

const router = useRouter()
const route = useRoute()
const settingStore = useSettingStore()

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

// ================== 侧栏：安全区 + 自动收起 ==================
let sideNavEl: HTMLElement | null = null
let sideNavObserver: MutationObserver | null = null

function querySideNav(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('.SideNav')
    || document.querySelector<HTMLElement>('.side-nav')
    || document.querySelector<HTMLElement>('[data-sidenav]')
    || Array.from(document.querySelectorAll<HTMLElement>('[role="navigation"], aside, nav'))
      .find(el => getComputedStyle(el).position === 'fixed')
    || null
  )
}

function applySafeTopToSideNav() {
  if (!sideNavEl)
    return

  sideNavEl.style.paddingTop = 'calc(env(safe-area-inset-top, 0px) + 8px)'
  const headerCandidate
    = sideNavEl.querySelector<HTMLElement>('.SideNavHeader, .side-nav__header, header, .header')
  if (headerCandidate)
    headerCandidate.style.paddingTop = 'calc(env(safe-area-inset-top, 0px) + 8px)'
}

function closeSideNavIfMobile() {
  if (isMobile.value)
    settingStore.isSideNavOpen = false
}

function isLikelyNavigateTarget(el: Element | null) {
  if (!el)
    return false

  const a = el.closest('a') as HTMLAnchorElement | null
  if (a && a.getAttribute('href') && a.getAttribute('target') !== '_blank')
    return true

  if (el.closest('[data-nav-link]'))
    return true

  if (el.closest('button,[role="menuitem"],[data-action="navigate"]'))
    return true

  return false
}

function onSideNavClickCapture(e: MouseEvent) {
  if (!sideNavEl || !sideNavEl.contains(e.target as Node))
    return

  const target = e.target as Element | null
  if (isLikelyNavigateTarget(target)) {
    requestAnimationFrame(() => {
      closeSideNavIfMobile()
    })
  }
}

function mountSideNavHooks() {
  sideNavEl = querySideNav()
  if (!sideNavEl)
    return

  applySafeTopToSideNav()
  document.addEventListener('click', onSideNavClickCapture, true)
}

function unmountSideNavHooks() {
  document.removeEventListener('click', onSideNavClickCapture, true)
  sideNavEl = null
}

// ================== 初始可视化与首帧优化 ==================
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
  window.addEventListener('resize', () => {
    updateIsMobile()
    applySafeTopToSideNav()
  }, { passive: true })

  // —— 1) 侧栏挂钩（支持异步渲染的侧栏容器）
  mountSideNavHooks()
  sideNavObserver = new MutationObserver(() => {
    if (!sideNavEl)
      mountSideNavHooks()
  })
  sideNavObserver.observe(document.documentElement, { childList: true, subtree: true })

  // —— 2) 路由 / hash 变化后自动关闭（移动端）
  router.afterEach(() => {
    closeSideNavIfMobile()
  })
  window.addEventListener('hashchange', () => {
    closeSideNavIfMobile()
  })

  requestAnimationFrame(() => {
    document.documentElement.removeAttribute('data-booting')
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', closeSideNavIfMobile as any)
  window.removeEventListener('resize', updateIsMobile as any)
  unmountSideNavHooks()
  if (sideNavObserver) {
    sideNavObserver.disconnect()
    sideNavObserver = null
  }
})

// ================== 其余原有逻辑 ==================
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
/* 关闭首帧过渡，避免“先开再关”闪烁 */
:global(html[data-booting] .SideNav),
:global(html[data-booting] .SideNavOverlay) {
  transition: none !important;
}

/* 兜底：给常见的侧栏容器/头部加上安全区上内边距（如果你的类名不同，上面的 JS 已经用行内样式覆盖了） */
:global(.SideNav),
:global(.SideNavHeader) {
  padding-top: calc(env(safe-area-inset-top, 0px) + 8px);
}
</style>
