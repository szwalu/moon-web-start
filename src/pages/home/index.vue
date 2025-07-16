<script setup lang="ts">
import { onMounted, ref, watch, watchEffect } from 'vue'
import Swal from 'sweetalert2'
import { useI18n } from 'vue-i18n'
import MainHeader from './components/MainHeader.vue'
import MainClock from './components/MainClock.vue'
import MainSearch from './components/MainSearch.vue'
import SiteContainer from './components/SiteContainer.vue'
import MainSetting from './components/MainSetting.vue'
import SiteNavBar from './components/SiteNavBar.vue'

import 'sweetalert2/dist/sweetalert2.min.css'
import shareIconPath from './1122.jpg'
import { cityMap, weatherMap } from '@/utils/weatherMap'
import { useAutoSave } from '@/composables/useAutoSave'
import { useSettingStore } from '@/stores/setting'
import { useSiteStore } from '@/stores/site'
import quotes from '@/utils/daily_quotes_zh.json'

// ✅ 新增的用户状态逻辑
import { useAuthStore } from '@/stores/auth'

defineOptions({
  name: 'HomePage',
})
const { t } = useI18n()
const dailyQuote = ref('')

const authStore = useAuthStore()

onMounted(() => {
  authStore.refreshUser()

  // 页面切回来时刷新登录状态（防止假登出）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible')
      authStore.refreshUser()
  })

  // 某些浏览器不触发 visibilitychange，用 focus 兜底
  window.addEventListener('focus', () => {
    authStore.refreshUser()
  })

  // 每 5 分钟刷新一次登录状态（增强防止假登出）
  setInterval(() => {
    authStore.refreshUser()
  }, 300000)
})

const settingStore = useSettingStore()
const { autoSaveData } = useAutoSave()
const siteStore = useSiteStore()

let lastJson = ''

watch(
  () => JSON.stringify(siteStore.customData),
  (newJson) => {
    if (newJson === lastJson)
      return

    lastJson = newJson
    autoSaveData()
  },
)

let lastSettingJson = ''

watch(
  () => JSON.stringify(settingStore.settings),
  (newJson) => {
    if (newJson === lastSettingJson)
      return
    lastSettingJson = newJson
    autoSaveData()
  },
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
const weatherCity = ref(t('index.weather_loading'))
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
  if (
    weatherCity.value === ''
    || weatherCity.value === '天气加载失败'
    || weatherCity.value === '加载中...'
  ) {
    try {
      weatherCity.value = '加载中...'
      weatherInfo.value = '...'

      const locRes = await fetch('https://ipapi.co/json/')
      const locData = await locRes.json()
      const lat = locData.latitude
      const lon = locData.longitude
      const enCity = locData.city
      const city = getChineseCityName(enCity)

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

watchEffect(() => {
  if (settingStore.getSettingValue('showDailyQuote'))
    showQuote()
  else
    dailyQuote.value = ''
})

function showQuote() {
  // 1. 获取引言库中的总数量
  const totalQuotes = quotes.length
  // 2. 生成一个从 0 到 (总数量 - 1) 之间的随机整数作为索引
  const randomIndex = Math.floor(Math.random() * totalQuotes)
  // 3. 根据这个随机索引，从数组中取出一条引言
  dailyQuote.value = quotes[randomIndex]?.zh || ''
}

function getChineseCityName(enCity: string): string {
  enCity = enCity?.trim().toLowerCase()

  for (const [key, value] of Object.entries(cityMap)) {
    const keyLower = key.toLowerCase()
    if (
      enCity === keyLower
      || enCity === `${keyLower} city`
      || enCity === `${keyLower} shi`
      || enCity.includes(keyLower)
    )
      return value
  }

  return enCity
}

function getWeatherText(code: number): { text: string; icon: string } {
  return weatherMap[code] || { text: '未知天气', icon: '❓' }
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
        <div style="margin-bottom: 4px;">${t('index.add_to_home')}</div>
        <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 4px;">
          <span>${t('index.click_below')}</span>
          <img alt="分享图标" src="${shareIconPath}" style="height: 14px; width: 14px; margin: 0 4px;"/>
        </div>
        <div>${t('index.choose_add_to_screen')}</div>
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

      <div v-if="!settingStore.isSetting && settingStore.getSettingValue('showDailyQuote')" class="weather-container mt-9">
        <div class="weather-content">
          <span><strong>{{ t('index.quote_prefix') }}</strong>{{ dailyQuote }}</span>
        </div>
      </div>

      <div class="mb-6 mt-8">
        <MainSearch />
      </div>
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
  padding-top: 0px;
  width: 100%;
  color: var(--text-c-1);
  font-size: 14px;
  line-height: 1.2;
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
