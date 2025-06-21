<script setup lang="ts">
import { RouterLink } from 'vue-router'

import { onMounted, ref } from 'vue'

// 1. 导入 ref 和 onMounted
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'

const route = useRoute()
const settingStore = useSettingStore()

// 2. 增加 isMobile 状态，用于判断是否为移动端尺寸
const isMobile = ref(false)
onMounted(() => {
  isMobile.value = window.innerWidth <= 768
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth <= 768
  })
})

function getIconClass(routeName: string) {
  return {
    'text-$primary-c opacity-100': routeName === route.name,
  }
}
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

    <div class="flex items-center gap-x-8">
      <RouterLink v-if="settingStore.isSetting" :class="getIconClass('home')" to="/" i-carbon:home icon-btn />
      <RouterLink v-else :class="getIconClass('setting')" to="/setting" i-carbon:settings icon-btn />
      <div i-carbon:moon dark:i-carbon:light icon-btn @click="(e) => toggleDark(e)" />
    </div>
  </div>
</template>
