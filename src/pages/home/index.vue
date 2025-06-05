<script setup lang="ts">
import { onMounted, ref } from 'vue'

// 确保 onMounted, ref 已导入
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

const isMobile = ref(false)
onMounted(() => {
  isMobile.value = window.innerWidth <= 768
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth <= 768
  })
})

const weatherCity = ref('加载中...')
const weatherInfo = ref('...')

// 当“显示天气”设置为“显示”时，才去获取天气数据
watchEffect(() => {
  if (settingStore.getSettingValue('showWeather')) {
    fetchWeather()
  }
  else {
    // 如果设置为隐藏，可以清空天气信息（可选）
    weatherCity.value = ''
    weatherInfo.value = ''
  }
})

async function fetchWeather() {
  // 修改后的判断条件：当天气信息是空的、加载中、或加载失败时，都去获取
  if (weatherCity.value === '' || weatherCity.value === '天气加载失败' || weatherCity.value === '加载中...') {
    try {
      // 在请求前，先将状态设为“加载中...”，避免重复请求
      weatherCity.value = '加载中...'
      weatherInfo.value = '...'

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
}

function showMobileToast() {
  if (isMobile.value && !localStorage.getItem('mobileToastShown')) {
    // ... (showMobileToast 函数内容保持不变)
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

// onMounted 中不再需要直接调用 fetchWeather，由 watchEffect 控制
onMounted(() => {
  // fetchWeather() // 已移至 watchEffect
  showMobileToast()
})
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
