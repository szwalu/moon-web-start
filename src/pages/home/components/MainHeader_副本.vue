<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { onMounted, ref } from 'vue'
import HamburgerButton from './HamburgerButton.vue'
import { supabase } from '@/utils/supabaseClient'
import { useSettingStore } from '@/stores/setting'

const settingStore = useSettingStore()
const isMobile = ref(false)

// ✅ 添加登录用户信息
const user = ref<any>(null)

onMounted(() => {
  isMobile.value = window.innerWidth <= 768
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth <= 768
  })

  // 监听登录状态变化
  supabase.auth.getSession().then(({ data }) => {
    user.value = data?.session?.user ?? null
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = session?.user ?? null
  })
})
</script>

<template>
  <div class="flex items-center justify-between px-4 pt-12 lg:px-8 md:px-6">
    <div class="header-left flex items-center gap-x-4">
      <HamburgerButton class="text-gray-700 dark:text-gray-300" />

      <RouterLink v-if="!isMobile" to="/">
        <div text="$primary-c" class="flex items-center justify-center">
          <span i-cus-moonset class="inline-block text-32 transition-300 hover:opacity-80" />
        </div>
      </RouterLink>

      <img
        v-if="isMobile && !settingStore.isSideNavOpen"
        src="/logo.jpg"
        alt="Logo"
        class="w-auto h-32"
      >
    </div>

    <!-- ✅ 页眉右侧：注册 / 登录 / 账户 按钮 -->
    <div class="flex items-center gap-x-4">
      <RouterLink
        to="/auth"
        class="inline-block rounded-xl px-5 py-2 text-[16px] font-normal transition-colors sm:px-3 sm:py-1 sm:text-[14px] hover:text-$primary-c"
        style="min-width: 100px; text-align: center;"
      >
        {{ user ? $t('navbar.account') : $t('navbar.auth') }}
      </RouterLink>
    </div>
  </div>
</template>
