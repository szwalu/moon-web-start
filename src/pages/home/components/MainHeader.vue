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
    await manualSaveData() // 保存数据
  }
  catch (e) {
    // console.warn('保存数据失败:', e);
    $message.warning('保存数据失败，请稍后重试')
  }

  let sessionInfo
  try {
    sessionInfo = await supabase.auth.getSession()
  }
  catch (e) {
    // console.error('获取 session 失败:', e);
    $message.warning('获取登录状态失败，请稍后重试')
    return
  }

  const session = sessionInfo?.data?.session

  // 检查客户端状态与后端会话是否一致
  if (session?.user) {
    if (!user.value) {
      // console.log('假登出：后端会话有效，同步客户端状态');
      user.value = session.user // 修复客户端状态
    }
    router.push('/setting')
  }
  else {
    // 尝试刷新会话
    try {
      const { data: refreshed, error } = await supabase.auth.refreshSession()
      if (error) {
        // console.error('刷新 session 失败:', error);
        throw error
      }
      if (refreshed?.session?.user) {
        // console.log('刷新会话成功，同步客户端状态');
        user.value = refreshed.session.user
        router.push('/setting')
      }
      else {
        // 真登出：无有效会话
        // console.log('真登出：无有效会话');
        $message.warning(t('auth.please_login'))
        setTimeout(() => {
          router.push('/setting') // 跳转到登录页面
        }, 300)
      }
    }
    catch (e) {
      console.error('刷新 session 异常:', e)
      // 额外检查本地 token
      if (checkLocalToken()) {
        // 本地 token 存在，可能是网络或服务端问题
        $message.warning('会话刷新失败，请检查网络后重试')
      }
      else {
        // 无本地 token，确认真登出
        $message.warning(t('auth.please_login'))
        setTimeout(() => {
          router.push('/setting')
        }, 300)
      }
    }
  }
}

// 检查本地 token
function checkLocalToken() {
  const tokenKey = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'))
  if (tokenKey) {
    try {
      const tokenData = JSON.parse(localStorage.getItem(tokenKey))
      return tokenData?.access_token && tokenData?.refresh_token
    }
    catch (e) {
      // console.error('本地 token 解析失败:', e);
      return false
    }
  }
  return false
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
