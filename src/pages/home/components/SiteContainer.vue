<script setup lang="ts">
import SiteModal from './SiteModal.vue'
import SiteGroupList from './SiteGroupList.vue'
import { FAVICON_MAP_SYMBOL } from '@/utils'

// TODO 重置预设后清除 faviconMap
const faviconMap = ref(new Map())

provide(FAVICON_MAP_SYMBOL, faviconMap)
</script>

<template>
  <div class="site-container-root" px="md:32 lg:64" text="$text-c-1" z-8>
    <!-- 已移除原来在此处渲染的 <SiteNavBar /> -->
    <SiteGroupList />
    <SiteModal />
  </div>
</template>
