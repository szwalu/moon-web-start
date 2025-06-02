<script setup lang="ts">
import { onMounted, ref } from 'vue'

// 1. 引入 ref 和 onMounted
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

// 2. 将天气功能的状态和逻辑直接放在这里
const weatherCity = ref('加载中...')
const weatherInfo = ref('...')

async function fetchWeather() {
  try {
    const response = await fetch('https://weatherapi.yjhy88.workers.dev/?q=auto:ip&lang=zh')
    const data = await response.json()
    const weather = data.current
    const city = data.location.name
    const temp = weather.temp_c
    const text = weather.condition.text
    weatherCity.value = city
    weatherInfo.value = `${temp}°C ${text}`
  }
  catch (error) {
    weatherCity.value = '天气加载失败'
    weatherInfo.value = ''
  }
}

// 3. 在主页组件加载时获取天气
onMounted(() => {
  fetchWeather()
})
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
      <div

        w="full"
        bg="$main-bg-c"
        sticky z-20 left-0 top-0
      >
        <MainHeader />
        <SiteNavBar />
      </div>

      <MainClock
        v-if="!settingStore.isSetting"
        class="mt-4"
      />

      <div v-if="!settingStore.isSetting" class="weather-container">
        <div v-if="weatherCity !== '天气加载失败'" class="weather-content">
          <span><strong>{{ weatherCity }}</strong></span>
          <span class="separator">/</span>
          <span>{{ weatherInfo }}</span>
        </div>
        <div v-else class="weather-content">
          <span>{{ weatherCity }}</span>
        </div>
      </div>

      <MainSearch
        v-if="!settingStore.isSetting"
        my-24
      />

      <SiteContainer :key="settingStore.siteContainerKey" />

      <MainSetting />
      <TheFooter
        v-if="settingStore.getSettingValue('showFooter')"
      />
    </div>
    <Blank />
  </TheDoc>
</template>

<style scoped>
/* 核心修改：调整天气组件的样式 */
.weather-container {
  display: flex;
  justify-content: center;
  align-items: center;
  /* 1. 大幅减小上方的间距，让它更紧凑 */
  padding-top: 4px;
  width: 100%;
  color: var(--text-c-1);
  font-size: 14px;
  line-height: 1.6;
}

.weather-content {
  display: flex;
  align-items: center;
  /* 2. 移除背景、内边距和圆角，实现完全透明和最小化 */
  /* background-color: rgba(128, 128, 128, 0.08); */
  /* padding: 6px 12px; */
  /* border-radius: 8px; */
}

.separator {
  margin: 0 8px;
  opacity: 0.5;
}
</style>

<route lang="yaml">
path: /
children:
  - name: setting
    path: setting
    component: /src/components/Blank.vue
</route>
