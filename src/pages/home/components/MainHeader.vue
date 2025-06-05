<script setup lang="ts">
import { RouterLink } from 'vue-router'
import HamburgerButton from './HamburgerButton.vue'
import { useSettingStore } from '@/stores/setting'

const route = useRoute()
const settingStore = useSettingStore()
// const { toggleDark } = useTheme() // 假设 toggleDark 是这样获取的

function getIconClass(routeName: string) {
  return {
    'text-$primary-c opacity-100': routeName === route.name,
  }
}
</script>

<template>
  <div px="0 md:24 lg:48" class="flex items-center justify-between pt-12">
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
