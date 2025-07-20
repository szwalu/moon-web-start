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
  await manualSaveData() // 🟢 强制保存
  // 1. 本地读取 session（不可靠，只用于提示）
  const localSession = await supabase.auth.getSession()

  // 2. 尝试远程确认用户是否真的登录
  const { data, error } = await supabase.auth.getUser()

  if (!data.user || error) {
    if (localSession.data.session) {
      // ✅ 情况一：本地有 session，但 getUser 拉不到 → 假登出
      // console.warn('⚠️ 假登出：本地 session 存在，但远程 user 拉不到')
      window.$message?.error('⚠️ 登录状态已失效，请刷新主页重新登录')
    }
    else {
      // ✅ 情况二：本地也没有 session → 真登出
      $message.warning(t('auth.please_login'))
      setTimeout(() => {
        router.push('/setting') // 根据你的项目路由调整
      }, 300)
    }
  }
  else {
    // ✅ 情况三：登录状态有效，进入设置页
    router.push('/setting')
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
