<script setup lang="ts">
import MainHeader from './components/MainHeader.vue'
import MainClock from './components/MainClock.vue'
import MainSearch from './components/MainSearch.vue'
import SiteContainer from './components/SiteContainer.vue'
import MainSetting from './components/MainSetting.vue'
import SiteNavBar from './components/SiteNavBar.vue'

defineOptions({
  name: 'HomePage',
})

const settingStore = useSettingStore()
</script>

<template>
  <TheDoc>
    <div
      my="0 sm:6vh"
      p="12 sm:24"
      bg="$main-bg-c"
      w="full sm:auto"
      :class="{ no_select: settingStore.isSetting }"
    >
      <!-- ===== 固定页眉区域：包含 MainHeader + SiteNavBar ===== -->
      <div

        w="full"
        bg="$main-bg-c"
        sticky z-20 left-0 top-0
      >
        <MainHeader />
        <SiteNavBar />
      </div>

      <!-- ===== 以下为正文区，自动被固定头部推下 ===== -->
      <MainClock
        v-if="!settingStore.isSetting"
        class="mt-4"
      />
      <MainSearch
        v-if="!settingStore.isSetting"
        my-24
      />

      <!-- 原本 SiteContainer 中的 SiteNavBar 已移出，这里仅渲染列表和弹窗 -->
      <SiteContainer :key="settingStore.siteContainerKey" />

      <MainSetting />
      <TheFooter
        v-if="settingStore.getSettingValue('showFooter')"
      />
    </div>
    <Blank />
  </TheDoc>
</template>

<route lang="yaml">
path: /
children:
  - name: setting
    path: setting
    component: /src/components/Blank.vue
</route>
