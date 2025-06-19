<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import Swal from 'sweetalert2'

// 【修正1】：调整了 import 顺序以符合规范

import MainHeader from './components/MainHeader.vue'
import MainClock from './components/MainClock.vue'
import MainSearch from './components/MainSearch.vue'
import SiteContainer from './components/SiteContainer.vue'
import MainSetting from './components/MainSetting.vue'
import SiteNavBar from './components/SiteNavBar.vue'

import 'sweetalert2/dist/sweetalert2.min.css'
import shareIconPath from './1122.jpg'
import { useAutoSave } from '@/composables/useAutoSave'
import { useSettingStore } from '@/stores/setting'
import { useSiteStore } from '@/stores/site'

defineOptions({
  name: 'HomePage',
})

const settingStore = useSettingStore()

const { autoSaveData } = useAutoSave()
const siteStore = useSiteStore()

watch(
  () => siteStore.customData,
  () => {
    if (settingStore.settings.websitePreference !== 'Customize')
      settingStore.setSettings({ websitePreference: 'Customize' })

    // 【修正2】：移除了不符合规范的 console.log
    // console.log('在主页侦听到数据变化，准备自动保存...')
    autoSaveData()
  },
  { deep: true },
)

const isMobile = ref(false)
onMounted(() => {
  isMobile.value = window.innerWidth <= 768
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth <= 768
  })
  showMobileToast()
})

const weatherCity = ref('加载中...')
const weatherInfo = ref('...')

watchEffect(() => {
  if (settingStore.getSettingValue('showWeather')) {
    fetchWeather()
  }
  else {
    weatherCity.value = ''
    weatherInfo.value = ''
  }
})

async function fetchWeather() {
  try {
    // 1. 获取用户的 IP 定位
    const ipRes = await fetch('https://ip-api.com/json/')
    const ipData = await ipRes.json()
    const lat = ipData.lat
    const lon = ipData.lon
    const city = ipData.city
    const country = ipData.country

    // 2. 请求彩云天气（不再跨域）
    const caiyunToken = 'FR4EYi0tJHtGlrL1'
    const apiUrl = `https://api.caiyunapp.com/v2/${caiyunToken}/${lon},${lat}/realtime.json`

    const weatherRes = await fetch(apiUrl)
    const weatherData = await weatherRes.json()

    if (weatherData.status !== 'ok')
      throw new Error('天气数据错误')

    const temp = weatherData.result.temperature
    const condition = weatherData.result.skycon

    const skyconTextMap = {
      CLEAR_DAY: '晴',
      CLEAR_NIGHT: '晴夜',
      PARTLY_CLOUDY_DAY: '多云',
      PARTLY_CLOUDY_NIGHT: '多云夜',
      CLOUDY: '阴',
      RAIN: '雨',
      SNOW: '雪',
      WIND: '风',
      FOG: '雾',
      HAZE: '霾',
    }

    const text = skyconTextMap[condition] || condition

    weatherCity.value = `${city}, ${country}`
    weatherInfo.value = `${temp.toFixed(1)}°C ${text}`
  }
  catch (err) {
    weatherCity.value = '天气加载失败'
    weatherInfo.value = ''
    console.error('天气错误:', err)
  }
}

function showMobileToast() {
  if (isMobile.value && !localStorage.getItem('mobileToastShown')) {
    const Toast = Swal.mixin({
      toast: true,
      position: 'bottom',
      showConfirmButton: false,
      timer: 10000,
      timerProgressBar: true,
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
</script>

<template>
  <TheDoc>
    <SiteNavBar />

    <div
      v-if="settingStore.isSideNavOpen && isMobile"
      class="mobile-overlay"
      @click="settingStore.toggleSideNav()"
    />

    <div
      class="main-content-area"

      px="6 sm:12" pb="12 sm:24"

      sm:auto my-0 w-full pt-0 bg-transparent sm:pt-0
      :class="{
        'no_select': settingStore.isSetting,
        'content-shifted': settingStore.isSideNavOpen,
      }"
    >
      <div
        class="sticky z-[1010] w-full left-0 top-0"
        bg="$main-bg-c"
      >
        <MainHeader />
      </div>

      <MainClock
        v-if="!settingStore.isSetting"
        class="mt-4"
      />

      <div v-if="!settingStore.isSetting && settingStore.getSettingValue('showWeather')" class="weather-container">
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
/* CSS部分与上一版完全一致，此处省略以保持简洁 */
.main-content-area {
  transition: margin-left 0.3s ease-in-out, width 0.3s ease-in-out, padding-left 0.3s ease-in-out;
  position: relative;
  box-sizing: border-box;
}

.content-shifted {
  margin-left: 130px;
  width: calc(100% - 130px);
  padding-left: 0 !important;
}

.mobile-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.4);
  z-index: 999;
}

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
