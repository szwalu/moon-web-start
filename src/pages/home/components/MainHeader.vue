<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'

// 1. 导入 useRouter
import { onMounted, ref } from 'vue'

import { useMessage } from 'naive-ui'

// 2. 导入 naive-ui 的 useMessage
import { useI18n } from 'vue-i18n'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'

// 3. 导入 supabase 客户端

const { t } = useI18n()
const route = useRoute()
const settingStore = useSettingStore()
const router = useRouter() // 4. 获取 router 实例，用于手动跳转
const $message = useMessage() // 5. 获取 message 实例，用于弹窗提示

const isMobile = ref(false)
onMounted(() => {
  isMobile.value = window.innerWidth <= 768
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth <= 768
  })
})

// 6. 【新增】获取并监听用户登录状态
const user = ref<any>(null)
onMounted(() => {
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
  })
})

const logoPath = ref('/logow.jpg') // 默认未登录

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

// 7. 【新增】处理设置按钮点击事件的函数
function handleSettingsClick() {
  if (user.value) {
  // 如果用户已登录，正常跳转到设置页面
    router.push('/setting')
  }
  else {
  // 如果用户未登录，弹出提示
    $message.warning(t('auth.please_login')) // ✅ 国际化

    // 等待 0.5 秒后跳转到设置页面
    setTimeout(() => {
      router.push('/setting')
    }, 300)
  }
}

// 8. 确保 toggleDark 函数可用（如果它在别处定义，请确保已导入）
// 假设它是一个全局函数或在父组件中处理
declare function toggleDark(event: MouseEvent): void
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
      <div
        class="text-7xl"
        i-carbon:moon
        dark:i-carbon:light
        icon-btn
        @click="(e) => toggleDark(e)"
      />
    </div>
  </div>
</template>
