<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'

// ✅ 导入主题切换函数
import { toggleDark } from '@/utils/dark'
import { loadRemoteDataOnceAndMergeToLocal, useAutoSave } from '@/composables/useAutoSave'

const { manualSaveData } = useAutoSave()

const safeTopStyle = computed(() => {
  // 小基准 8px + iOS 刘海安全区；不会把头推得太夸张
  return { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }
})

// const { t } = useI18n()
const route = useRoute()
const settingStore = useSettingStore()
const router = useRouter()
// const $message = useMessage()

const isMobile = ref(false)

function updateIsMobile() {
  isMobile.value = window.innerWidth <= 768
}

onMounted(() => {
  updateIsMobile() // 初始判断一次
  window.addEventListener('resize', updateIsMobile, { passive: true })
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
  // 1. 首先，执行所有与导航无关的操作
  await manualSaveData()
  const { data: { session } } = await supabase.auth.getSession()

  // 2. 根据会话状态，处理各自的特定逻辑
  if (session) {
    // 如果用户已登录，则设置一个延迟任务来合并远程数据
    setTimeout(() => {
      loadRemoteDataOnceAndMergeToLocal()
    }, 2500)
  }
  else {
    // 如果用户未登录，再检查 localStorage
    const hasLoggedInBefore = localStorage.getItem('hasLoggedInBefore')
    if (hasLoggedInBefore) {
      // 仅当用户是“曾经登录过但已登出”的状态时，才显示提示信息
      $message.warning(t('auth.please_login'))
    }
    // 对于“从未登录过”的用户，则不显示任何消息，直接跳转
  }

  // 3. 最后，无论用户处于何种状态，都执行统一的导航操作
  router.push('/setting')
}

onMounted(() => {
  // 进入导航站首页时，强制关闭一次侧栏，清理历史残留
  if (route.path === '/') {
    settingStore.isSideNavOpen = false
    sessionStorage.removeItem('isSideNavOpen')
    localStorage.removeItem('isSideNavOpen')
  }
})
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
        @click="(e) => toggleDark()"
      />
    </div>
  </div>
</template>
