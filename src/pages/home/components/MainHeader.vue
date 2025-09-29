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

/**
 * 首帧：与原逻辑一致，避免“先开再关”的过渡抖动
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

  // ✅ 关键：iOS 键盘弹出/收起会改 visualViewport，触发一次“轻触重绘”
  if (isMobileSafari.value && 'visualViewport' in window) {
    const vv = (window as any).visualViewport as VisualViewport
    const tick = () => {
      // 通过切换类名触发样式重计算，确保 env(safe-area-*) 与 sticky 重新生效
      document.documentElement.classList.toggle('vv-tick')
      requestAnimationFrame(() => {
        document.documentElement.classList.toggle('vv-tick')
      })
    }
    vv.addEventListener('resize', tick)
    vv.addEventListener('scroll', tick)
    // 卸载时清理
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
  <!-- ✅ 安全区垫片：只占用刘海安全区的高度，不会增加你要求之外的间距 -->
  <div class="ios-safe-top" />

  <!-- ✅ 头部本体：sticky 固定在文档顶部，不随页面滚动被“塞进”刘海 -->
  <div class="header-wrap flex items-center justify-between px-4 lg:px-8 md:px-6">
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
/* ---------- 刘海安全区 & 头部定位 ---------- */
/* iOS Safari 动态 env() → 放到 CSS，而不是内联样式，提升刷新可靠性 */
:root { --sat: env(safe-area-inset-top); }

/* 顶部“安全区垫片”：高度=刘海安全区；sticky 保证始终贴顶且参与文档流 */
.ios-safe-top {
  position: sticky;
  top: 0;
  height: var(--sat);
  /* 让垫片具备背景，避免地址栏收起时露出“刘海下的页面内容”闪一下 */
  background: var(--body-bg, transparent);
  z-index: 50;
  pointer-events: none; /* 不影响点击 */
}

/* 头部本体：只做常规 8px 顶内边距，不再直接使用 env() */
.header-wrap {
  position: sticky;
  top: 0;               /* 贴合垫片下边缘 */
  padding-top: 8px;     /* 你之前的 8px 视觉间距 */
  z-index: 60;          /* 在垫片之上 */
  background: var(--body-bg, transparent); /* 收起地址栏时避免透底 */
  backdrop-filter: saturate(100%) blur(0px); /* 可留空，仅保证合成层 */
}

/* 首帧过渡禁用：与原逻辑一致 */
:global(html[data-booting] .SideNav),
:global(html[data-booting] .SideNavOverlay) {
  transition: none !important;
}

/* 轻触重绘时不给任何视觉变化，仅作为触发器 */
:global(html.vv-tick) {}
</style>
