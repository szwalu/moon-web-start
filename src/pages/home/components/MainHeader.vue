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
let tipTimer: number | null = null

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

onMounted(() => {
  window.addEventListener('resize', updateIsMobile, { passive: true })

  // 恢复过渡：放到下一帧，确保首帧渲染完成
  requestAnimationFrame(() => {
    document.documentElement.removeAttribute('data-booting')
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIsMobile)
  if (tipTimer !== null)
    clearTimeout(tipTimer)
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

// ✅ 新增这一段：只要是 from=notes 且移动端，显示 20 秒提示
onMounted(() => {
  if (isMobile.value && route.query.from === 'notes') {
    const countStr = localStorage.getItem('notes_to_main_tip_count')
    const currentCount = countStr ? Number(countStr) : 0

    // 只显示前 20 次
    if (currentCount < 20) {
      showBackTip.value = true

      // 自动关闭
      tipTimer = window.setTimeout(() => {
        showBackTip.value = false
      }, 20000)

      // 计数 +1
      localStorage.setItem('notes_to_main_tip_count', String(currentCount + 1))
    }
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
    class="flex items-center justify-between px-4 lg:px-8 md:px-6"
    :style="safeTopStyle"
  >
    <div class="header-left flex items-center gap-x-4">
      <HamburgerButton class="text-gray-700 dark:text-gray-300" />
      <RouterLink
        v-if="isMobile && !settingStore.isSideNavOpen"
        to="/auth"
        class="flex items-center gap-x-2"
      >
        <img
          :src="logoPath"
          alt="Logo"
          class="w-auto h-32"
        >
        <span
          v-if="showBackTip"
          style="font-size: 12px; font-weight: 400; color: #dc2626; padding-left: 2px; line-height: 1;"
        >
          👈 {{ $t('notes.back_to_notes') }}
        </span>
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
