<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Swal from 'sweetalert2'
import MainHeader from './components/MainHeader.vue'
import MainClock from './components/MainClock.vue'
import MainSearch from './components/MainSearch.vue'
import SiteContainer from './components/SiteContainer.vue'
import MainSetting from './components/MainSetting.vue'
import SiteNavBar from './components/SiteNavBar.vue'

import 'sweetalert2/dist/sweetalert2.min.css'
import shareIconPath from './1122.jpg'

defineOptions({
  name: 'HomePage',
})

const settingStore = useSettingStore()

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

function isMobileDevice() {
  return window.innerWidth <= 768
}

function showMobileToast() {
  if (isMobileDevice() && !localStorage.getItem('mobileToastShown')) {
    const Toast = Swal.mixin({
      toast: true,
      position: 'bottom',
      showConfirmButton: false,
      timer: 10000,
      timerProgressBar: true,
      // 1. 宽度完全遵照您的要求，设置为 165px
      width: '165px',
      background: 'transparent',
      customClass: {
        popup: 'mobile-guide-toast',
      },
      didOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer)
        toast.addEventListener('mouseleave', Swal.resumeTimer)
      },
      didClose: () => {
        localStorage.setItem('mobileToastShown', 'true')
      },
    })

    Toast.fire({
      // 2. 减小内边距，并微调字体大小和行高以防止换行
      html: `
        <div style="position: relative; background-color: white; color: black; border-radius: 12px; padding: 8px 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); font-size: 9.5px; line-height: 1.35;">
          <div style="text-align: center;">
            <div style="margin-bottom: 4px;">添加网址导航到桌面</div>
            <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 4px;">
              <span>点击下面的</span>
              <img alt="分享图标" src="${shareIconPath}" style="height: 14px; width: 14px; margin: 0 4px;"/>
            </div>
            <div>然后选择“添加到主屏幕”</div>
          </div>

          <svg width="16" height="8" style="position: absolute; top: 100%; left: 50%; transform: translateX(-50%);">
            <polygon points="0,0 16,0 8,8" style="fill:white;"/>
          </svg>
        </div>
      `,
    })
  }
}

onMounted(() => {
  fetchWeather()
  showMobileToast()
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
.weather-container {
  display: flex;
  justify-content: center;
  align-items: center;
  padding-top: 4px;
  width: 100%;
  color: var(--text-c-1);
  font-size: 14px;
  line-height: 1.6;
}
.weather-content {
  display: flex;
  align-items: center;
}
.separator {
  margin: 0 8px;
  opacity: 0.5;
}

:deep(.mobile-guide-toast) {
  padding: 0 !important;
  overflow: visible !important;
}

:deep(.swal2-popup.swal2-toast) {
    background: transparent !important;
    box-shadow: none !important;
}
</style>

<route lang="yaml">
path: /
children:
  - name: setting
    path: setting
    component: /src/components/Blank.vue
</route>
