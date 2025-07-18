<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'

// ✅ 导入主题切换函数
import { toggleDark } from '@/utils/dark'
import { useAutoSave } from '@/composables/useAutoSave'

const { manualSaveData } = useAutoSave()

const { t } = useI18n()
const route = useRoute()
const settingStore = useSettingStore()
const router = useRouter()
const $message = useMessage()

const isMobile = ref(false)
onMounted(() => {
  isMobile.value = window.innerWidth <= 768
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth <= 768
  })
})

const user = ref<any>(null)
onMounted(() => {
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
  })
})

const logoPath = ref('/logow.jpg')
onMounted(async () => {
  const { data: { user } } = await supabase.auth.getUser()
  if (user)
    logoPath.value = '/logo.jpg'
})

function getIconClass(routeName: string) {
  return {
    'text-$primary-c opacity-100': routeName === route.name,
  }
}

async function handleSettingsClick() {
  try {
    await manualSaveData() // 🟢 手动保存数据
  }
  catch (e) {
    // console.warn('保存数据失败:', e)
  }

  let sessionInfo
  try {
    sessionInfo = await supabase.auth.getSession()
  }
  catch (e) {
    // console.error('获取 session 失败:', e)
    $message.warning('获取登录状态失败，请稍后重试')
    return
  }

  const session = sessionInfo?.data?.session
  const user = session?.user
  const token = session?.access_token

  if (user && token) {
    // ✅ 已登录
    router.push('/setting')
  }
  else if (!user && token) {
    // ⚠️ 假登出：尝试刷新
    try {
      const { data: refreshed, error } = await supabase.auth.refreshSession()
      if (error)
        throw error
      if (refreshed?.session?.user) {
        // ✅ 恢复成功，再获取一次 session 并跳转
        router.push('/setting')
      }
      else {
        $message.warning('请手动刷新页面后再试')
      }
    }
    catch (e) {
      // console.error('刷新 session 异常:', e)
      $message.warning('会话刷新失败，请手动刷新页面')
    }
  }
  else {
    // ❌ 真登出或未登录
    $message.warning(t('auth.please_login'))
    setTimeout(() => {
      router.push('/setting')
    }, 300)
  }
}
</script>

<template>
  <div class="flex items-center justify-between px-4 pt-12 lg:px-8 md:px-6">
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
        class="text-7xl" :class="[getIconClass('home')]"
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
      <!-- ✅ 使用 toggleDark 切换明暗模式 -->
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
