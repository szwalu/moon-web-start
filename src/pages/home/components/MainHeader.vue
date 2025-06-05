<script setup lang="ts">
import { RouterLink } from 'vue-router'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'

const route = useRoute()
const settingStore = useSettingStore()
// 假设 toggleDark 是全局可用的，或者您有自己的方式来获取它
// const { toggleDark } = useTheme()

function getIconClass(routeName: string) {
  return {
    'text-$primary-c opacity-100': routeName === route.name,
  }
}
</script>

<template>
  <div class="flex items-center justify-between px-4 pt-12 lg:px-8 md:px-6">
    <div class="flex items-center gap-x-4">
      <HamburgerButton class="text-gray-700 dark:text-gray-300" />
      <RouterLink to="/">
        <div text="$primary-c" class="flex items-center justify-center">
          <span i-cus-moonset class="inline-block text-32 transition-300 hover:opacity-80" />
        </div>
      </RouterLink>
    </div>

    <div class="flex items-center gap-x-8">
      <RouterLink v-if="settingStore.isSetting" :class="getIconClass('home')" to="/" i-carbon:home icon-btn />
      <RouterLink v-else :class="getIconClass('setting')" to="/setting" i-carbon:settings icon-btn />
      <div i-carbon:moon dark:i-carbon:light icon-btn @click="(e) => toggleDark(e)" />
    </div>
  </div>
</template>
