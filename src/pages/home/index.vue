<script setup lang="ts">
import { onMounted, ref, watch, watchEffect } from 'vue'
import Swal from 'sweetalert2'

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

// ========== 以下是天气功能 ==========
const weatherCity = ref('加载中...')
const weatherInfo = ref('...')

// 天气加载控制
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
  if (
    weatherCity.value === ''
    || weatherCity.value === '天气加载失败'
    || weatherCity.value === '加载中...'
  ) {
    try {
      weatherCity.value = '加载中...'
      weatherInfo.value = '...'

      // 获取 IP 定位
      const locRes = await fetch('https://ipapi.co/json/')
      const locData = await locRes.json()
      const lat = locData.latitude
      const lon = locData.longitude
      const enCity = locData.city
      const city = getChineseCityName(enCity)

      // 获取 Open-Meteo 天气数据
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&timezone=auto`,
      )
      const data = await res.json()
      const temp = data.current.temperature_2m
      const code = data.current.weathercode
      const { text, icon } = getWeatherText(code)

      weatherCity.value = city
      weatherInfo.value = `${temp}°C ${text} ${icon}`
    }
    catch (e) {
      weatherCity.value = '天气加载失败'
      weatherInfo.value = ''
    }
  }
}

function getWeatherText(code: number): { text: string; icon: string } {
  const weatherMap: Record<number, { text: string; icon: string }> = {
    0: { text: '晴朗', icon: '☀️' },
    1: { text: '主要晴天', icon: '🌤️' },
    2: { text: '部分多云', icon: '⛅' },
    3: { text: '多云', icon: '☁️' },
    45: { text: '雾', icon: '🌫️' },
    48: { text: '霜雾', icon: '🌁' },
    51: { text: '毛毛雨', icon: '🌦️' },
    53: { text: '中等毛毛雨', icon: '🌧️' },
    55: { text: '浓密毛毛雨', icon: '🌧️' },
    61: { text: '小雨', icon: '🌧️' },
    63: { text: '中雨', icon: '🌧️' },
    65: { text: '大雨', icon: '🌧️' },
    71: { text: '小雪', icon: '🌨️' },
    73: { text: '中雪', icon: '🌨️' },
    75: { text: '大雪', icon: '❄️' },
    80: { text: '阵雨', icon: '🌦️' },
    81: { text: '中等阵雨', icon: '🌧️' },
    82: { text: '强阵雨', icon: '🌧️' },
    95: { text: '雷雨', icon: '⛈️' },
    96: { text: '雷雨伴小冰雹', icon: '⛈️' },
    99: { text: '雷雨伴大冰雹', icon: '⛈️' },
  }

  return weatherMap[code] || { text: '未知天气', icon: '❓' }
}

function getChineseCityName(enCity: string): string {
  const cityMap: Record<string, string> = {
    'Beijing': '北京',
    'Shanghai': '上海',
    'Guangzhou': '广州',
    'Shenzhen': '深圳',
    'Hangzhou': '杭州',
    'Chengdu': '成都',
    'Wuhan': '武汉',
    'Nanjing': '南京',
    'Tianjin': '天津',
    'Chongqing': '重庆',
    'Xi\'an': '西安',
    'Changsha': '长沙',
    'Zhengzhou': '郑州',
    'Fuzhou': '福州',
    'Xiamen': '厦门',
    'Ningbo': '宁波',
    'Suzhou': '苏州',
    'Qingdao': '青岛',
    'Jinan': '济南',
    'Shenyang': '沈阳',
    'Dalian': '大连',
    'Harbin': '哈尔滨',
    'Kunming': '昆明',
    'Hefei': '合肥',
    'Nanchang': '南昌',
    'Urumqi': '乌鲁木齐',
    'Heyuan': '河源',
    'Hong Kong': '香港',
    'Macau': '澳门',
    'Taipei': '台北',
    'Kaohsiung': '高雄',
    'Taichung': '台中',
    'Tainan': '台南',
    'New York': '纽约',
    'Los Angeles': '洛杉矶',
    'San Francisco': '旧金山',
    'London': '伦敦',
    'Paris': '巴黎',
    'Tokyo': '东京',
    'Seoul': '首尔',
    'Bangkok': '曼谷',
    'Singapore': '新加坡',
    'Berlin': '柏林',
    'Sydney': '悉尼',
    'Moscow': '莫斯科',
    'Toronto': '多伦多',
    'Vancouver': '温哥华',
  }

  for (const [key, value] of Object.entries(cityMap)) {
    if (enCity.toLowerCase().includes(key.toLowerCase()))
      return value
  }
  return enCity
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
