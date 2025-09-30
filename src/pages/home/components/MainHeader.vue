<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'
import { toggleDark } from '@/utils/dark'
import { loadRemoteDataOnceAndMergeToLocal, useAutoSave } from '@/composables/useAutoSave'

const { manualSaveData } = useAutoSave()

// 通过 padding-top“让开”刘海与键盘偏移：env(safe-area) + --vk-offset-top + 8px 视觉留白
const safeTopStyle = computed(() => {
  return {
    paddingTop: 'calc(env(safe-area-inset-top, 0px) + var(--vk-offset-top, 0px) + 8px)',
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

const _user = ref<any>(null)
const logoPath = ref('/logow.jpg')

// 记录并解绑 visualViewport 监听
let _vvResize: (() => void) | null = null
let _vvScroll: (() => void) | null = null
let _vvRaf = 0

// 只调整一次的开关：一旦设置过 --vk-offset-top，就不再改动
let _vkHasAdjusted = false
const VK_VAR_NAME = '--vk-offset-top'

onMounted(async () => {
  window.addEventListener('resize', updateIsMobile, { passive: true })

  // 恢复过渡：放到下一帧，确保首帧渲染完成
  requestAnimationFrame(() => {
    document.documentElement.removeAttribute('data-booting')
  })

  // 监听登录状态
  supabase.auth.onAuthStateChange((_event, session) => {
    _user.value = session?.user ?? null
  })

  // 根据会话切换 Logo
  const { data: { session } } = await supabase.auth.getSession()
  if (session)
    logoPath.value = '/logo.jpg'

  // —— 视觉视口兜底：只在“键盘首次明显出现”时设置一次，收起时不还原、不调整 ——
  if ('visualViewport' in window) {
    const vv = window.visualViewport!

    const scheduleUpdate = () => {
      if (_vvRaf)
        cancelAnimationFrame(_vvRaf)
      _vvRaf = requestAnimationFrame(() => {
        // “键盘明显出现”的判定：可视高度比窗口高度小很多（留一定冗余）
        const keyboardLikely
          = vv.height < window.innerHeight * 0.92
          || (window.innerHeight - vv.height) > 80

        // 只在“首次从未调整过且检测到键盘出现”时写入一次；其余情况一律不改动
        if (keyboardLikely && !_vkHasAdjusted) {
          const off = Math.max(vv.offsetTop || 0, 0)
          document.documentElement.style.setProperty(VK_VAR_NAME, `${off}px`)
          _vkHasAdjusted = true
        }
        // 键盘收起时不做任何处理（不清零、不回调），避免页面跳动
      })
    }

    _vvResize = () => scheduleUpdate()
    _vvScroll = () => scheduleUpdate()

    vv.addEventListener('resize', _vvResize, { passive: true })
    vv.addEventListener('scroll', _vvScroll, { passive: true })
    scheduleUpdate()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIsMobile)

  if ('visualViewport' in window) {
    const vv = window.visualViewport as any
    if (_vvResize)
      vv.removeEventListener('resize', _vvResize)
    if (_vvScroll)
      vv.removeEventListener('scroll', _vvScroll)
    if (_vvRaf)
      cancelAnimationFrame(_vvRaf)
  }
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
    class="app-header flex items-center justify-between px-4 lg:px-8 md:px-6"
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
/* Header 固定贴顶，由 padding-top 让出安全区与键盘偏移 */
.app-header {
  position: sticky;
  top: 0; /* 关键：贴在视口顶部，不再把 env() 用于 top */
  z-index: 50;
  background: var(--bg, #fff);      /* 不透明背景避免视觉穿透刘海 */
  will-change: padding-top;         /* 我们动态改变的是 padding-top */
  overflow-anchor: none;            /* 防止滚动锚点导致的跳动 */
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  contain: paint;                   /* 轻量的合成层，有助于稳定渲染 */
}

/* 暗黑模式下给 header 一个接近不透明的深色背景 */
:global(html.dark) .app-header {
  background: rgba(24, 24, 28, 0.98);
}

/* 可选：抑制 iOS 顶部橡皮筋回弹对下层的连带影响（仅页面层面，安全） */
:global(body) {
  overscroll-behavior-y: contain;
}

/* 首帧禁用过渡：你原有逻辑保留 */
:global(html[data-booting] .SideNav),
:global(html[data-booting] .SideNavOverlay) {
  transition: none !important;
}
</style>
