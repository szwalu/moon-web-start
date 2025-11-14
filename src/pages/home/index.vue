<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from 'vue'

// 删除了 onUnmounted，因为不再需要
import Swal from 'sweetalert2'
import { useI18n } from 'vue-i18n'
import MainHeader from './components/MainHeader.vue'
import MainClock from './components/MainClock.vue'
import MainSearch from './components/MainSearch.vue'
import SiteContainer from './components/SiteContainer.vue'
import MainSetting from './components/MainSetting.vue'
import SiteNavBar from './components/SiteNavBar.vue'
import shareIconPath from './1122.jpg'
import { usePageResume } from '@/composables/usePageResume'

// 删除了 supabase 的直接引入，因为 store 已经处理了相关逻辑
import 'sweetalert2/dist/sweetalert2.min.css'
import { weatherMap } from '@/utils/weatherMap'
import { useAutoSave } from '@/composables/useAutoSave'
import { useSettingStore } from '@/stores/setting'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'
import quotes from '@/utils/daily_quotes_zh.json'

defineOptions({
  name: 'HomePage',
})

usePageResume({ storageKey: 'woabc-home-v1' /* , scrollSelector: '.main-content-area' */ })

// --- 初始化 & 状态定义 ---
const { t, locale } = useI18n()
// const messageHook = useMessage() // messageHook 变量被保留，因为它可能在 fetchWeather 中使用
const authStore = useAuthStore()
const settingStore = useSettingStore()
const siteStore = useSiteStore()
const { autoSaveData } = useAutoSave()

// 【核心修改】 1. 移除所有本地认证相关的 ref
// const user = ref<any>(null) -> 已移除
// const sessionExpired = ref(false) -> 已移除

// 【核心修改】 2. 使用 computed 从 Pinia store 中获取用户状态
// 这确保了 user 变量永远和全局状态保持同步
const _user = computed(() => authStore.user)

// 其他非认证相关的本地状态保持不变
const dailyQuote = ref('')
const hasFetchedWeather = ref(false)
const weatherCity = ref(t('index.weather_loading'))
const weatherInfo = ref('...')
const isWeatherRefreshing = ref(false)
const isMobile = ref(false)
const GEO_CONSENT_KEY = 'geo_consent_for_navigation_v1'

async function getBrowserLocationWithPromptOnce(timeoutMs = 10000): Promise<{ lat: number; lon: number } | null> {
  if (!navigator?.geolocation)
    return null

  const stored = localStorage.getItem(GEO_CONSENT_KEY)
  if (stored === 'denied')
    return null

  return new Promise((resolve) => {
    let done = false

    const finish = (val: any) => {
      if (done)
        return
      done = true
      resolve(val)
    }

    const timer = setTimeout(() => finish(null), timeoutMs)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer)
        localStorage.setItem(GEO_CONSENT_KEY, 'granted')
        finish({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        })
      },
      (err) => {
        clearTimeout(timer)
        if (err.code === 1)
          localStorage.setItem(GEO_CONSENT_KEY, 'denied')
        finish(null)
      },
      { enableHighAccuracy: true, maximumAge: 300000, timeout: timeoutMs },
    )
  })
}
let lastJson = ''
let lastSettingJson = ''

// 【核心修改】 3. 移除本地的 onAuthStateChange 监听器和 onUnmounted 清理逻辑
// 这一部分逻辑已经由全局的 useSupabaseTokenRefresh.ts 统一处理

// 监听 Pinia store 的变化以自动保存
watch(
  () => JSON.stringify(siteStore.customData),
  (newJson) => {
    if (newJson === lastJson)
      return
    lastJson = newJson
    autoSaveData()
  },
)

watch(
  () => JSON.stringify(settingStore.settings),
  (newJson) => {
    if (newJson === lastSettingJson)
      return
    lastSettingJson = newJson
    autoSaveData()
  },
)

// onMounted 钩子现在只负责页面自身的初始化逻辑
onMounted(async () => {
  // a. 主动刷新一次 authStore，确保获取到最新的用户状态
  await authStore.refreshUser()

  // b. 初始化移动端检测
  isMobile.value = window.innerWidth <= 768
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth <= 768
  })
  showMobileToast()
})

// 天气功能
watchEffect(() => {
  if (settingStore.getSettingValue('showWeather')) {
    if (!hasFetchedWeather.value)
      fetchWeather()
  }
  else {
    weatherCity.value = ''
    weatherInfo.value = ''
    hasFetchedWeather.value = false
  }
})

// 每日引言
watchEffect(() => {
  if (settingStore.getSettingValue('showDailyQuote'))
    showQuote()
  else
    dailyQuote.value = ''
})

function getCachedWeather() {
  const cached = localStorage.getItem('weatherData')
  if (!cached)
    return null

  const { data, timestamp } = JSON.parse(cached)
  const isExpired = Date.now() - timestamp > 6 * 60 * 60 * 1000 // 6小时过期
  return isExpired ? null : data
}

function setCachedWeather(data) {
  const cache = {
    data,
    timestamp: Date.now(),
  }
  localStorage.setItem('weatherData', JSON.stringify(cache))
}

// ===== 城市名缓存 =====
const CITY_CACHE_KEY = 'nominatim_city_cache_v1'
const CITY_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 天

let cityCache: Record<string, any> | null = null

function loadCityCache() {
  if (cityCache)
    return cityCache
  try {
    cityCache = JSON.parse(localStorage.getItem(CITY_CACHE_KEY) || '{}')
  }
  catch {
    cityCache = {}
  }
  return cityCache
}
function saveCityCache() {
  if (!cityCache)
    return
  try {
    localStorage.setItem(CITY_CACHE_KEY, JSON.stringify(cityCache))
  }
  catch {}
}

function normalizedCoord(lat: number, lon: number) {
  const nLat = (Math.round(lat * 1000) / 1000).toFixed(3)
  const nLon = (Math.round(lon * 1000) / 1000).toFixed(3)
  return `${nLat},${nLon}`
}

function isChineseLocale() {
  // 1) 优先用当前站点的 i18n 语言
  const current = (locale?.value || '').toLowerCase()
  if (current)
    return current.startsWith('zh')

  // 2) 兜底：用浏览器 / 页面语言
  const nav = (navigator.language || '').toLowerCase()
  const docLang = (document.documentElement.lang || '').toLowerCase()
  const lang = nav || docLang

  return lang.startsWith('zh')
}

async function reverseGeocodeCity(lat: number, lon: number): Promise<string | null> {
  const preferZh = isChineseLocale()
  const langHeader = preferZh
    ? 'zh-CN,zh;q=0.9,en;q=0.6'
    : 'en-US,en;q=0.9,zh;q=0.6'

  const key = normalizedCoord(lat, lon)
  const cache = loadCityCache()
  const now = Date.now()

  const cached = cache[key]
  if (cached && (now - cached.ts) < CITY_TTL_MS)
    return preferZh ? cached.zh : cached.en

  let city: string | null = null

  try {
    const params = new URLSearchParams({
      format: 'json',
      lat: String(lat),
      lon: String(lon),
      zoom: '10',
      addressdetails: '1',
    })

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
      {
        headers: {
          'Accept': 'application/json',
          'Accept-Language': langHeader,
          'User-Agent': 'woabc-navigation-weather/1.0 (support@woabc.com)',
          'Referer': 'https://www.woabc.com/',
        },
      },
    )

    const data = await res.json()
    const addr = data.address || {}

    city
      = addr.city
      || addr.town
      || addr.village
      || addr.hamlet
      || addr.county
      || addr.state
      || null

    if (city && city.includes(';'))
      city = city.split(';')[0].trim()
  }
  catch {
    city = null
  }

  // 写入缓存
  cache[key] = {
    zh: preferZh ? city : null,
    en: preferZh ? null : city,
    ts: now,
  }
  saveCityCache()

  return city
}

async function fetchWeather(bypassCache = false) {
  const cached = getCachedWeather()
  if (cached && !bypassCache) {
    weatherCity.value = cached.city
    weatherInfo.value = cached.info
    return
  }

  isWeatherRefreshing.value = true
  hasFetchedWeather.value = true

  try {
    weatherCity.value = t('index.weather_loading')
    weatherInfo.value = '...'

    // ===== 1. 精确定位（主动弹窗） =====
    let lat = null
    let lon = null

    const geo = await getBrowserLocationWithPromptOnce(8000)
    if (geo) {
      lat = geo.lat
      lon = geo.lon
    }

    // ===== 2. 若用户拒绝 / 失败 → 使用 IP 定位兜底 =====
    if (!lat || !lon) {
      let locData: any
      try {
        const r = await fetch('https://ipapi.co/json/')
        locData = await r.json()
      }
      catch {
        const r2 = await fetch('http://ip-api.com/json/')
        locData = await r2.json()
        locData.city = locData.city || locData.regionName
        locData.latitude = locData.lat
        locData.longitude = locData.lon
      }

      lat = locData.latitude
      lon = locData.longitude
    }

    // ===== 3. 坐标 → 城市（官方 Nominatim） =====
    let city = await reverseGeocodeCity(lat!, lon!)
    if (!city)
      city = t('index.weather_unknown_city')

    // ===== 4. open-meteo 天气数据 =====
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&timezone=auto`,
    )
    const data = await res.json()

    const temp = data.current.temperature_2m
    const code = data.current.weathercode
    const { text, icon } = getWeatherText(code)

    const weatherText = `${temp}°C ${text} ${icon}`

    weatherCity.value = city
    weatherInfo.value = weatherText

    setCachedWeather({ city, info: weatherText })
  }
  catch {
    weatherCity.value = t('index.weather_failed')
    weatherInfo.value = ''
  }
  finally {
    isWeatherRefreshing.value = false
  }
}

function refreshWeather() {
  fetchWeather(true)
}

function showQuote() {
  const totalQuotes = quotes.length
  const randomIndex = Math.floor(Math.random() * totalQuotes)
  dailyQuote.value = quotes[randomIndex]?.zh || ''
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
      class="main-content-area min-h-screen bg-$main-bg-c"
      px="6 sm:12" pb="12 sm:24"
      sm:auto my-0 w-full pt-0 sm:pt-0
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
          <button
            class="refresh-btn ml-2"
            :disabled="isWeatherRefreshing"
            :title="t('index.refresh_weather')"
            @click="refreshWeather"
          >
            <span v-if="isWeatherRefreshing" class="refresh-icon animate-spin">↻</span>
            <span v-else>↻</span>
          </button>
        </div>
        <div v-else class="weather-content">
          <span>{{ weatherCity }}</span>
          <button
            class="refresh-btn ml-2"
            :disabled="isWeatherRefreshing"
            :title="t('index.refresh_weather')"
            @click="refreshWeather"
          >
            <span v-if="isWeatherRefreshing" class="refresh-icon animate-spin">↻</span>
            <span v-else>↻</span>
          </button>
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

.session-expired-notice {
  text-align: center;
  padding: 10px;
  background-color: #fff1f1;
  border: 1px solid #ff4d4f;
  border-radius: 6px;
  margin-bottom: 10px;
}
.dark .session-expired-notice {
  background-color: #4b1c1c;
  border-color: #ff7875;
}

:deep(.mobile-guide-toast) {
  padding: 0 !important;
  overflow: visible !important;
}

:deep(.swal2-popup.swal2-toast) {
  background: transparent !important;
  box-shadow: none !important;
}

/* 新增刷新按钮样式 */
.refresh-btn {
  font-size: 0.85em;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.05);
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease;
}
.refresh-btn:hover {
  background: rgba(0, 0, 0, 0.1);
}
.refresh-btn:disabled {
  cursor: wait;
  opacity: 0.5;
}
.refresh-icon {
  display: inline-block;
  font-size: 1em;
}
</style>

<route lang="yaml">
path: /
children:
  - name: setting
    path: setting
    component: /src/components/Blank.vue
</route>
