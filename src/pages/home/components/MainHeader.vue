<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'
import { toggleDark } from '@/utils/dark'
import { loadRemoteDataOnceAndMergeToLocal, useAutoSave } from '@/composables/useAutoSave'

const { manualSaveData } = useAutoSave()

const safeTopStyle = computed(() => {
  return {
    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
  }
})

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

/** 新增：移动端关闭侧栏的统一函数 */
function closeSideNavIfMobile() {
  if (isMobile.value)
    settingStore.isSideNavOpen = false
}

/** 新增：委托监听侧栏内部链接点击（锚点/站内链接）后自动关闭侧栏 */
function onSideNavLinkClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target)
    return
  // 只关心侧栏内的 <a>
  const a = target.closest('a') as HTMLAnchorElement | null
  const sideNav = (target.closest('.SideNav') || document.querySelector('.SideNav')) as HTMLElement | null
  if (!a || !sideNav)
    return
  const href = a.getAttribute('href') || ''
  const isInternal
    = href.startsWith('#')
    || href.startsWith('/')
    || (a.origin === window.location.origin && href) // 绝对站内链接
  const isNewTab = a.getAttribute('target') === '_blank'
  if (isInternal && !isNewTab) {
    // 让浏览器/路由先处理跳转/滚动，再关闭侧栏，避免“提前收起导致跳转被阻断”的边缘情况
    requestAnimationFrame(() => closeSideNavIfMobile())
  }
}

/**
 * 在 setup 同步阶段就设置默认状态，避免 iOS Safari 首帧“先开再关”：
 * - PC：默认打开
 * - 其它移动端：默认关闭
 * - iOS Safari：强制关闭
 * 同时在首帧禁用过渡，mounted 后恢复。
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
  window.addEventListener('resize', updateIsMobile, { passive: true })

  // 新增：路由切换后（含从 / 到 /#music 这类 hash 变化），自动关闭侧栏（移动端）
  router.afterEach(() => {
    closeSideNavIfMobile()
  })

  // 新增：捕获侧栏内部链接点击，锚点/站内跳转后关闭侧栏
  document.addEventListener('click', onSideNavLinkClick, true)

  // 恢复过渡：放到下一帧，确保首帧渲染完成
  requestAnimationFrame(() => {
    document.documentElement.removeAttribute('data-booting')
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIsMobile)
  document.removeEventListener('click', onSideNavLinkClick, true)
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

/* ✅ 修复：侧栏顶部在 iOS 全屏/PWA 下避开刘海区 */
:global(.SideNav),
:global(.SideNavHeader) {
  padding-top: calc(env(safe-area-inset-top, 0px) + 8px);
}
</style>
