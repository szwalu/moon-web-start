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

  const { data, error } = await supabase.auth.getSession()

  if (error) {
    // ⛔ 网络问题或刷新失败，避免跳转，只提示
    $message.error(t('auth.refresh_failed') || '刷新失败，请稍后再试')
    return
  }

  if (!data.session) {
    // ✅ session 为空，说明是假登出或真登出
    if (user.value) {
      // ✅ 本地还有 user，但 session 无效 —— 判定为“假登出”
      $message.warning('检测到登录状态异常，请刷新主页后重试')
    }
    else {
      // ✅ 真登出或未登录
      $message.warning(t('auth.please_login') || '请先登录您的账户')
      setTimeout(() => {
        router.push('/setting')
      }, 300)
    }
    return
  }

  // ✅ session 正常，允许跳转
  router.push('/setting')
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
