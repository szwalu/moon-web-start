<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'
import { supabase } from '@/utils/supabaseClient'

// ✅ 导入 autoSave 手动保存
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

function handleSettingsClick() {
  if (user.value) {
    router.push('/setting')
  }
  else {
    $message.warning(t('auth.please_login'))
    setTimeout(() => {
      router.push('/setting')
    }, 300)
  }
}

// ✅ 点击“小房子”按钮时手动保存后再跳转
async function handleBackHomeClick() {
  const loadingRef = $message.loading(t('messages.saving'), { duration: 0 })
  await manualSaveData()
  loadingRef.destroy()
  $message.success(t('messages.saveSuccess'))
  router.push('/')
}

// 假设 toggleDark 为全局函数
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
      <!-- ✅ 小房子按钮：点击后保存并跳转 -->
      <div
        v-if="settingStore.isSetting"
        class="text-7xl"
        :class="[getIconClass('home')]"
        i-carbon:home
        icon-btn
        @click="handleBackHomeClick"
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
