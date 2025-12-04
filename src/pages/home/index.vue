<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from 'vue'
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

// ================= [核心修复：PWA 信号全局捕获器] =================
// 放在组件外部，确保 script 一执行就立刻监听，绝不错过任何信号
let globalInstallEvent: any = null

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // 1. 阻止 Chrome 默认的底部横幅（我们需要自定义按钮）
    e.preventDefault()
    // 2. 将这个宝贵的信号存到全局变量里
    globalInstallEvent = e
    // 3. 广播一个自定义事件，通知组件“信号抓到了”
    window.dispatchEvent(new Event('pwa-event-captured'))
  })
}
// ================================================================

usePageResume({ storageKey: 'woabc-home-v1' })

// --- 初始化 & 状态定义 ---
const { t } = useI18n()
const authStore = useAuthStore()
const settingStore = useSettingStore()
const siteStore = useSiteStore()
const { autoSaveData } = useAutoSave()

const fontSizeClass = computed(() => {
  const key = settingStore.settings.fontSize || 'md'
  switch (key) {
    case 'xl': return 'home-font-xl'
    case 'lg': return 'home-font-lg'
    case 'sm': return 'home-font-sm'
    case 'md':
    default:
      return 'home-font-md'
  }
})

const _user = computed(() => authStore.user)

const dailyQuote = ref('')
const hasFetchedWeather = ref(false)
const weatherCity = ref(t('index.weather_loading'))
const weatherInfo = ref('...')
const isWeatherRefreshing = ref(false)
const isMobile = ref(false)
const GEO_CONSENT_KEY = 'geo_consent_for_navigation_v1'

/// ================= [PWA 逻辑变量] =================
const showInstallBtn = ref(false)
const isIOS = ref(false)
const isAndroid = ref(false)

// 稳健的设备检测
function checkPlatform() {
  if (typeof navigator === 'undefined')
    return

  const u = navigator.userAgent
  const p = navigator.platform || ''

  const iosPlatforms = ['iPhone', 'iPad', 'iPod', 'iPhone Simulator', 'iPad Simulator']
  isIOS.value = iosPlatforms.includes(p) || (u.includes('Mac') && 'ontouchend' in document)
  isAndroid.value = u.includes('Android') || u.includes('Adr')
}

// 检测是否已安装 (PWA模式)
function isPWAInstalled() {
  if (typeof window === 'undefined')
    return false
  return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true
}

// 通用引导弹窗
function showManualGuide(isIOSMode: boolean) {
  if (isIOSMode) {
    // iOS 版：样式已优化（图标左置，内容居中）
    Swal.fire({
      title: '',
      icon: undefined,
      html: `
        <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
          <div style="
            width: 22px; 
            height: 22px; 
            border: 2px solid #3fc3ee; 
            border-radius: 50%; 
            color: #3fc3ee; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            font-weight: 800; 
            font-family: sans-serif; 
            margin-right: 12px;
            font-size: 14px;">!</div>
          <span style="font-size: 20px; font-weight: 600; color: #333;">添加笔记到桌面</span>
        </div>
        <div style="text-align: center; font-size: 15px; line-height: 1.8; color: #555;">
          <div>
            点击底部 <img src="${shareIconPath}" style="width:18px; display:inline-block; vertical-align: text-bottom; margin: 0 4px;" /> <strong>分享</strong>图标
          </div>
          <div>
            下滑选择 <strong>"添加到主屏幕"</strong>
          </div>
        </div>
      `,
      confirmButtonText: '我知道了',
      confirmButtonColor: '#3085d6',
      customClass: {
        confirmButton: 'pwa-ios-btn',
        popup: 'pwa-ios-popup',
      },
    })
  }
  else {
    // Android 版手动引导 (仅当原生安装彻底失败时才显示)
    Swal.fire({
      title: '安装到桌面',
      html: `
        <div style="font-size: 15px; line-height: 1.6; text-align: left;">
          <p>自动安装未触发，请尝试手动添加：</p>
          <ol style="padding-left: 20px; margin-top: 10px;">
            <li style="margin-bottom: 8px;">点击浏览器右上角的 <strong>⋮</strong> 菜单</li>
            <li>选择 <strong>"安装应用"</strong> 或 <strong>"添加到主屏幕"</strong></li>
          </ol>
        </div>
      `,
      icon: 'info',
      confirmButtonText: '好的',
      customClass: { title: 'pwa-ios-title', confirmButton: 'pwa-ios-btn', popup: 'pwa-ios-popup' },
    })
  }
}

// 处理点击安装按钮
async function handleInstallApp() {
  // 1. 优先：检查是否捕获到了原生信号
  if (globalInstallEvent) {
    // 触发原生安装弹窗
    globalInstallEvent.prompt()
    // 等待用户选择
    const { outcome } = await globalInstallEvent.userChoice
    if (outcome === 'accepted') {
      // 用户同意了，清空信号，隐藏按钮
      globalInstallEvent = null
      showInstallBtn.value = false
    }
    // 如果用户点了取消，我们保留按钮，允许他再次点击
  }
  // 2. 备选：如果是安卓但没信号，只能弹手动引导
  else if (isAndroid.value) {
    showManualGuide(false)
  }
  // 3. iOS 备选
  else if (isIOS.value) {
    showManualGuide(true)
  }
}
// ================= [PWA 逻辑结束] =================

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

onMounted(async () => {
  await authStore.refreshUser()

  isMobile.value = window.innerWidth <= 768
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth <= 768
  })

  // ================= [PWA 初始化 - 最终稳定版] =================
  checkPlatform()

  if (!isPWAInstalled()) {
    // ---- Android 逻辑 ----
    if (isAndroid.value) {
      // 场景 A：组件加载时，信号已经来了（保存在 globalInstallEvent）
      if (globalInstallEvent) {
        showInstallBtn.value = true
      }
      // 场景 B：组件加载了，信号还没来 -> 监听我们自定义的广播
      else {
        window.addEventListener('pwa-event-captured', () => {
          showInstallBtn.value = true
        })

        // 场景 C：兜底策略
        // 如果 3 秒后还没收到信号，强制显示按钮（哪怕只能走手动引导）
        // 这防止按钮永远不出来
        setTimeout(() => {
          if (!showInstallBtn.value)
            showInstallBtn.value = true
        }, 3000)
      }
    }

    // ---- iOS 逻辑 ----
    if (isIOS.value) {
      showInstallBtn.value = false
      setTimeout(() => {
        showManualGuide(true)
      }, 1500)
    }
  }
  else {
    // 已安装，隐藏按钮
    showInstallBtn.value = false
  }

  // 监听安装成功事件
  window.addEventListener('appinstalled', () => {
    showInstallBtn.value = false
    globalInstallEvent = null
  })
  // ================= [PWA 初始化结束] =================
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

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
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
  const lang = (navigator.language || '').toLowerCase()
  return lang.startsWith('zh')
}

interface ReverseOptions {
  fallbackName?: string
  allowRetry?: boolean
}

async function reverseGeocodeCity(
  lat: number,
  lon: number,
  options: ReverseOptions = {},
): Promise<string | null> {
  const preferZh = isChineseLocale()
  const langHeader = preferZh
    ? 'zh-CN,zh;q=0.9,en;q=0.6'
    : 'en-US,en;q=0.9,zh;q=0.6'

  const key = normalizedCoord(lat, lon)
  const cache = loadCityCache()
  const now = Date.now()

  const cached = cache[key]
  if (cached && (now - cached.ts) < CITY_TTL_MS) {
    const cachedName = preferZh ? cached.zh : cached.en
    if (cachedName)
      return cachedName
  }

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

  if (!city && options.allowRetry !== false) {
    await sleep(300)
    return reverseGeocodeCity(lat, lon, {
      fallbackName: options.fallbackName,
      allowRetry: false,
    })
  }

  if (!city && options.fallbackName)
    city = options.fallbackName

  if (city) {
    cache[key] = {
      zh: preferZh ? city : cache[key]?.zh || null,
      en: preferZh ? cache[key]?.en || null : city,
      ts: now,
    }
    saveCityCache()
  }

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

    let lat: number | null = null
    let lon: number | null = null
    let fallbackCityFromIp: string | null = null

    const geo = await getBrowserLocationWithPromptOnce(8000)
    if (geo) {
      lat = geo.lat
      lon = geo.lon
    }

    if (lat == null || lon == null) {
      let locData: any = null

      try {
        const r = await fetch('https://ipapi.co/json/')
        locData = await r.json()
      }
      catch {
        const r2 = await fetch('http://ip-api.com/json/')
        locData = await r2.json()
        locData.city = locData.city || locData.regionName
        locData.latitude = locData.latitude ?? locData.lat
        locData.longitude = locData.longitude ?? locData.lon
      }

      if (locData) {
        lat = Number(locData.latitude)
        lon = Number(locData.longitude)
        fallbackCityFromIp
          = locData.city
          || locData.region
          || locData.regionName
          || locData.country_name
          || locData.country
          || null
      }
    }

    if (lat == null || lon == null) {
      weatherCity.value = t('index.weather_failed')
      weatherInfo.value = ''
      return
    }

    let city = await reverseGeocodeCity(lat, lon, {
      fallbackName: fallbackCityFromIp || undefined,
      allowRetry: true,
    })

    if (!city)
      city = fallbackCityFromIp || t('index.weather_unknown_city')

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&timezone=auto`,
    )
    const data = await res.json()

    const temp = data.current?.temperature_2m
    const code = data.current?.weathercode
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
      :class="[
        {
          'no_select': settingStore.isSetting,
          'content-shifted': settingStore.isSideNavOpen,
        },
        fontSizeClass,
      ]"
    >
      <div
        class="sticky z-[1010] w-full left-0 top-0"
        bg="$main-bg-c"
      >
        <MainHeader />

        <div v-if="showInstallBtn" class="pwa-install-bar">
          <button class="pwa-install-btn" @click="handleInstallApp">
            <span>📲 安装应用到桌面</span>
          </button>
        </div>
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
/* [新增 PWA] 样式 */
.pwa-install-bar {
  text-align: center;
  padding: 8px 0;
  background-color: var(--main-bg-c); /* 与背景融合 */
}

.pwa-install-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  transition: transform 0.2s, box-shadow 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.pwa-install-btn:active {
  transform: scale(0.96);
}

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

/* ★ 字号设置：只作用于卡片标题（site-card-title），说明文字保持原来的大小 */

/* 特大 */
.main-content-area.home-font-xl :deep(.site-card-title) {
  font-size: 18px;
}

/* 大 */
.main-content-area.home-font-lg :deep(.site-card-title) {
  font-size: 16px;
}

/* 中（默认） */
.main-content-area.home-font-md :deep(.site-card-title) {
  font-size: 14px;
}

/* 小 */
.main-content-area.home-font-sm :deep(.site-card-title) {
  font-size: 12px;
}
</style>

<style>
/* 1. 关键：增加弹窗宽度，防止文字被挤成竖排 */
.pwa-ios-popup {
  width: 90% !important;          /* 宽度设为屏幕的 90%，让文字横向排开 */
  max-width: 380px !important;    /* 限制最大宽度，平板上不至于太宽 */
  padding: 15px !important;       /* 内边距适中 */
  border-radius: 16px !important;
}

/* 2. 标题字号：调回适中大小 */
.pwa-ios-title {
  /* 由于我们已经禁用了默认标题，这个类现在主要影响 Android 弹窗 */
  font-size: 20px !important;
  font-weight: 600 !important;
  padding-top: 1.2em !important;
  line-height: 1.4 !important;
  color: #333 !important;
}

/* 3. 按钮：大小适中，但保证手指容易点 */
.pwa-ios-btn {
  font-size: 15px !important;
  padding: 10px 24px !important;  /* 减小内边距 */
  border-radius: 8px !important;
  margin-bottom: 5px !important;
  min-height: 40px !important;    /* 保持最小触控高度 */
  font-weight: 500 !important;
}
</style>

<route lang="yaml">
path: /
children:
  - name: setting
    path: setting
    component: /src/components/Blank.vue
</route>
