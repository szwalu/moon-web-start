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
const showBackTip = ref(false)
// 移除了 tipTimer

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
  window.addEventListener('resize', updateIsMobile, { passive: true })

  // 恢复过渡
  requestAnimationFrame(() => {
    document.documentElement.removeAttribute('data-booting')
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIsMobile)
  // 移除了 clearTimeout
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

// ✅ 修改后的逻辑：手动关闭，不自动消失
onMounted(() => {
  if (isMobile.value) {
    // 1. 清理 URL 参数
    if (route.query.from === 'notes') {
      const { from: _from, ...restQuery } = route.query
      router.replace({
        path: route.path,
        query: restQuery,
      })
    }

    // 2. 核心逻辑
    const countStr = localStorage.getItem('notes_to_main_tip_count')
    const currentCount = countStr ? Number(countStr) : 0

    // 只显示前 1000 次
    if (currentCount < 1000) {
      showBackTip.value = true
      localStorage.setItem('notes_to_main_tip_count', String(currentCount + 1))
    }
  }
})

// ✅ 新增：点击气泡关闭
function closeTip() {
  showBackTip.value = false
}

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

      <RouterLink
        v-if="isMobile && !settingStore.isSideNavOpen"
        to="/auth"
        class="relative flex items-center gap-x-2"
      >
        <img
          :src="logoPath"
          alt="Logo"
          class="w-auto h-32"
        >

        <div
          v-if="showBackTip"
          class="bubble-tip"
          @click="closeTip"
        >
          {{ $t('notes.back_to_notes') }}
        </div>
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
/* 消除首帧过渡 */
:global(html[data-booting] .SideNav),
:global(html[data-booting] .SideNavOverlay) {
  transition: none !important;
}

/* ✅ 新增：黄色气泡样式 */
.bubble-tip {
  /* 定位：Logo 右侧垂直居中 */
  position: absolute;
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 14px; /* 气泡距离 Logo 的间距 */

  /* 外观 */
  background-color: #fdb927; /* 截图同款黄色 */
  color: #ffffff;
  font-size: 14px;
  font-weight: 500;
  padding: 8px 12px;
  border-radius: 8px;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  z-index: 50;
  line-height: 1.2;
}

/* ✅ 新增：左侧小三角 */
.bubble-tip::before {
  content: '';
  position: absolute;
  left: -8px; /* 三角形突出的位置 */
  top: 50%;
  transform: translateY(-50%);

  width: 0;
  height: 0;
  border-top: 8px solid transparent;
  border-bottom: 8px solid transparent;
  border-right: 8px solid #fdb927; /* 颜色必须与背景一致 */
}
</style>
