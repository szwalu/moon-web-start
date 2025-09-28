<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'
import { toggleDark } from '@/utils/dark'
import { loadRemoteDataOnceAndMergeToLocal, useAutoSave } from '@/composables/useAutoSave'

const { manualSaveData } = useAutoSave()

/** 顶部安全区（避免页眉在 PWA/全屏时贴到刘海） */
const safeTopStyle = computed(() => {
  return {
    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
  }
})

const route = useRoute()
const router = useRouter()
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

/** —— 关键修复 1：发生站内导航/滚动时，统一关闭侧栏 —— */
function closeSideNav() {
  settingStore.isSideNavOpen = false
}

/** 捕获阶段委托：只要点到站内 <a>（含锚点），下一帧关闭侧栏 */
function onAnyInternalLinkClickCapture(e: MouseEvent) {
  const t = e.target as Element | null
  if (!t)
    return

  const a = t.closest('a') as HTMLAnchorElement | null
  if (!a)
    return

  const href = a.getAttribute('href') || ''
  const isInternal = href.startsWith('/') || href.startsWith('#') || a.origin === window.location.origin
  const isNewTab = a.target === '_blank'
  if (isInternal && !isNewTab) {
    requestAnimationFrame(() => {
      closeSideNav()
    })
  }
}

/** —— 关键修复 2：iOS 刘海/PWA 下为抽屉/侧栏强制补安全区 —— */
function applySafeInsetForDrawers() {
  const selectors = [
    '.n-drawer',
    '.n-drawer-body',
    '.n-drawer-header',
    '.SideNav',
    '.SideNavHeader',
    '.side-nav',
    '.side-nav__header',
  ]
  for (const sel of selectors) {
    const nodes = document.querySelectorAll<HTMLElement>(sel)
    for (const el of nodes)
      el.style.paddingTop = 'calc(env(safe-area-inset-top, 0px) + 8px)'
  }
}

/** 首帧：避免“先开再关” */
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
    applySafeInsetForDrawers()
  }, { passive: true })

  // —— 导航发生后，统一关闭侧栏（包括仅 hash 变化）
  router.afterEach(() => {
    closeSideNav()
    // 路由切换后也补一遍安全区（抽屉可能新挂载）
    requestAnimationFrame(() => {
      applySafeInsetForDrawers()
    })
  })
  window.addEventListener('hashchange', () => {
    closeSideNav()
  })

  // —— 捕获阶段监听任意站内 <a> 点击
  document.addEventListener('click', onAnyInternalLinkClickCapture, true)

  // —— 初次挂载也补一次安全区
  requestAnimationFrame(() => {
    applySafeInsetForDrawers()
  })

  // 恢复过渡
  requestAnimationFrame(() => {
    document.documentElement.removeAttribute('data-booting')
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onAnyInternalLinkClickCapture, true)
  window.removeEventListener('hashchange', closeSideNav as any)
  window.removeEventListener('resize', updateIsMobile as any)
})

/** —— 其余原有逻辑 —— */
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
/* 关闭首帧过渡，避免“先开再关”闪烁 */
:global(html[data-booting] .SideNav),
:global(html[data-booting] .SideNavOverlay) {
  transition: none !important;
}

/* —— 刘海/PWA 安全区兜底：覆盖 Naive UI Drawer 与自定义侧栏 —— */
:global(.n-drawer),
:global(.n-drawer-body),
:global(.n-drawer-header),
:global(.SideNav),
:global(.SideNavHeader),
:global(.side-nav),
:global(.side-nav__header) {
  padding-top: calc(env(safe-area-inset-top, 0px) + 8px) !important;
}

/* 某些实现里 header/Logo 绝对定位，再兜一层 */
:global(.n-drawer-header),
:global(.SideNavHeader),
:global(.side-nav__header) {
  position: relative;
}

/* 如你的侧栏头部 Logo 是绝对定位并标了 data-logo，可再抬一格（可选） */
:global(.n-drawer-header > *[data-logo]),
:global(.SideNavHeader > *[data-logo]),
:global(.side-nav__header > *[data-logo]) {
  margin-top: env(safe-area-inset-top, 0px);
}
</style>
