<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Swal from 'sweetalert2'

import { useMessage } from 'naive-ui'
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
import { supabase } from '@/utils/supabaseClient'
import { cityMap, weatherMap } from '@/utils/weatherMap'

defineOptions({ name: 'HomePage' })

const settingStore = useSettingStore()
const siteStore = useSiteStore()
const { autoSaveData } = useAutoSave()
const $message = useMessage()
const router = useRouter()
const route = useRoute()

// 自动保存数据逻辑
watch(
  siteStore.customData,
  () => {
    if (!window.__currentUser)
      $message.warning(t('auth.please_login'))
  },
  { deep: true },
)

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

const isMobile = ref(false)
onMounted(() => {
  isMobile.value = window.innerWidth <= 768
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth <= 768
  })
  showMobileToast()
})

// ========== 浮动按钮逻辑 ==========
const user = ref<any>(null)

supabase.auth.getSession().then(({ data }) => {
  user.value = data?.session?.user ?? null
})

supabase.auth.onAuthStateChange((_event, session) => {
  user.value = session?.user ?? null
})

function handleSettingsClick() {
  if (route.path === '/setting') {
    // 当前在设置页 → 回首页，不提示.
    router.push('/')
  }
  else {
  // 如果用户未登录，弹出提示
    $message.warning(t('auth.please_login')) // ✅ 国际化
    // 等待 0.3秒后跳转到设置页面
    setTimeout(() => {
      router.push('/setting')
    }, 300)
  }
}

declare function toggleDark(event?: MouseEvent): void
function toggleDarkMode(event?: MouseEvent) {
  toggleDark(event!)
}

function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
}

const showFloatingButtons = ref(true)
let scrollTimeout: ReturnType<typeof setTimeout>
function handleScroll() {
  showFloatingButtons.value = false
  clearTimeout(scrollTimeout)
  scrollTimeout = setTimeout(() => {
    showFloatingButtons.value = true
  }, 300)
}
onMounted(() => {
  window.addEventListener('scroll', handleScroll)
})
onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})

// ========== 天气功能 ==========
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

      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&timezone=auto`)
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

function getChineseCityName(enCity: string): string {
  enCity = enCity.trim().toLowerCase()

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
  return enCity // fallback
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
    <div v-if="settingStore.isSideNavOpen && isMobile" class="mobile-overlay" @click="settingStore.toggleSideNav()" />
    <div
      class="main-content-area"
      px="6 sm:12"
      pb="12 sm:24"
      sm:auto my-0 w-full pt-0 bg-transparent sm:pt-0
      :class="{
        'no_select': settingStore.isSetting,
        'content-shifted': settingStore.isSideNavOpen,
      }"
    >
      <div class="sticky z-[1010] w-full left-0 top-0" bg="$main-bg-c">
        <MainHeader />
      </div>

      <MainClock v-if="!settingStore.isSetting" class="mt-4" />

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

      <MainSearch my-24 />
      <SiteContainer :key="settingStore.siteContainerKey" />
      <MainSetting />
      <TheFooter v-if="settingStore.getSettingValue('showFooter')" />
    </div>

    <!-- ✅ 浮动按钮区域 -->
    <div
      v-show="showFloatingButtons"
      class="floating-buttons fixed z-[9999] flex flex-col transition-opacity duration-300 gap-12 bottom-15 right-10"
    >
      <!-- 🔝 返回顶部按钮 -->
      <div
        class="cursor-pointer rounded-full shadow-md bg-white icon-btn dark:bg-gray-800 hover:opacity-80"
        title="返回顶部"
        @click="scrollToTop"
      >
        <div class="i-carbon-arrow-up" />
      </div>

      <!-- ⚙️ 设置 / 首页 切换 -->
      <div
        class="cursor-pointer rounded-full shadow-md bg-white icon-btn dark:bg-gray-800 hover:opacity-80"
        title="设置"
        @click="handleSettingsClick"
      >
        <div :class="route.path === '/setting' ? 'i-carbon-home' : 'i-carbon-settings'" />
      </div>

      <!-- 🌙 日夜间切换 -->
      <div
        class="cursor-pointer rounded-full shadow-md bg-white icon-btn dark:bg-gray-800 hover:opacity-80"
        title="切换日夜间模式"
        @click="toggleDarkMode"
      >
        <div class="i-carbon-moon dark:i-carbon-light" />
      </div>
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
.floating-buttons {
  opacity: 1;
}
.floating-buttons[style*="display: none"] {
  opacity: 0;
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
