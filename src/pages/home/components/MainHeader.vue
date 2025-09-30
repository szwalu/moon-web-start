<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'
import { toggleDark } from '@/utils/dark'
import { loadRemoteDataOnceAndMergeToLocal, useAutoSave } from '@/composables/useAutoSave'

const { manualSaveData } = useAutoSave()

// 视觉内边距独立处理，避免键盘期 env() 变 0 牵连布局
const safeTopStyle = computed(() => {
  return {
    paddingTop: '8px',
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

const user = ref<any>(null)
const logoPath = ref('/logow.jpg')

onMounted(async () => {
  window.addEventListener('resize', updateIsMobile, { passive: true })

  // 恢复过渡：放到下一帧，确保首帧渲染完成
  requestAnimationFrame(() => {
    document.documentElement.removeAttribute('data-booting')
  })

  // 监听登录状态
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
  })

  // 根据会话切换 Logo
  const { data: { session } } = await supabase.auth.getSession()
  if (session)
    logoPath.value = '/logo.jpg'

  // —— 视觉视口兜底：在键盘/旋转等场景确保 top 计算稳定 ——
  if ('visualViewport' in window) {
    const vv = window.visualViewport!
    const updateVv = () => {
      const off = Math.max(vv.offsetTop || 0, 0)
      document.documentElement.style.setProperty('--vk-offset-top', `${off}px`)
    }
    vv.addEventListener('resize', updateVv, { passive: true })
    vv.addEventListener('scroll', updateVv, { passive: true })
    updateVv()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIsMobile)
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
/* 让页眉粘在安全区下沿，避免被顶进刘海；顺序：constant() 兜底 -> env() -> 叠加可视视口偏移 */
.app-header {
  position: sticky;
  top: constant(safe-area-inset-top, 0px);
  top: env(safe-area-inset-top, 0px);
  top: calc(env(safe-area-inset-top, 0px) + var(--vk-offset-top, 0px));
  z-index: 50;
  /* 背景保持不透明，避免“看见”刘海下层内容造成视觉误判 */
  background: var(--bg, #fff);
  /* 减少 iOS 粘滞重绘抖动 */
  will-change: top;
}

/* 暗黑模式下，给 header 一个接近不透明的深色背景 */
:global(html.dark) .app-header {
  background: rgba(24, 24, 28, 0.98);
}

/* 首帧禁用过渡：你原有逻辑保留 */
:global(html[data-booting] .SideNav),
:global(html[data-booting] .SideNavOverlay) {
  transition: none !important;
}
</style>
