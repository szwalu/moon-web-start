<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'
import { toggleDark } from '@/utils/dark'
import { loadRemoteDataOnceAndMergeToLocal, useAutoSave } from '@/composables/useAutoSave'

const { manualSaveData } = useAutoSave()

const headerRef = ref<HTMLElement | null>(null)

const safeTopStyle = computed(() => {
  return {
    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
  }
})

const route = useRoute()
const settingStore = useSettingStore()
const router = useRouter()

const isMobile = ref(false)

function updateIsMobile() {
  isMobile.value = window.innerWidth <= 768
}

// 原始代码中的 isMobileSafari 和相关逻辑不再需要，可以简化
if (typeof window !== 'undefined') {
  document.documentElement.setAttribute('data-booting', '1')
  updateIsMobile()
  settingStore.isSideNavOpen = !isMobile.value
}

// --- 全新解决方案：开始 ---

let originalScrollY = 0

/**
 * 当输入框聚焦时，将页眉从 fixed 切换到 absolute 定位，避免浏览器视口调整带来的跳动。
 */
function handleFocusIn(event: FocusEvent) {
  const target = event.target as HTMLElement
  if (isMobile.value && headerRef.value && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
    // 锁定前，先禁用过渡动画，防止切换时闪烁
    headerRef.value.classList.add('no-transition')

    // 记录当前滚动位置
    originalScrollY = window.scrollY

    // 切换到 absolute 定位
    headerRef.value.style.position = 'absolute'
    headerRef.value.style.top = `${originalScrollY}px`
  }
}

/**
 * 当输入框失焦时，将页眉恢复为 fixed 定位。
 */
function handleFocusOut() {
  if (isMobile.value && headerRef.value) {
    // 恢复 fixed 定位，并清除 top 值
    headerRef.value.style.position = '' // 恢复为 CSS 文件中定义的样式 (通常是 fixed 或 sticky)
    headerRef.value.style.top = ''

    // 稍作延迟后恢复过渡效果，确保布局稳定
    setTimeout(() => {
      headerRef.value?.classList.remove('no-transition')
    }, 100)
  }
}

// --- 全新解决方案：结束 ---

onMounted(() => {
  window.addEventListener('resize', updateIsMobile, { passive: true })

  // --- 挂载新的事件监听器 ---
  document.addEventListener('focusin', handleFocusIn)
  document.addEventListener('focusout', handleFocusOut)

  requestAnimationFrame(() => {
    document.documentElement.removeAttribute('data-booting')
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIsMobile)

  // --- 卸载新的事件监听器 ---
  document.removeEventListener('focusin', handleFocusIn)
  document.removeEventListener('focusout', handleFocusOut)
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
    ref="headerRef"
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
/* 这个 CSS 规则是新方案的关键部分 */
.no-transition {
  transition: none !important;
}

:global(html[data-booting] .SideNav),
:global(html[data-booting] .SideNavOverlay) {
  transition: none !important;
}
</style>
