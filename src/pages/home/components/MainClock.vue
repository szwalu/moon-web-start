<script setup lang="ts">
import solarLunar from 'solarlunar-es'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const settingStore = useSettingStore()

// 核心修正：使用 try...catch 来安全地获取设置，如果设置不存在，则默认显示
function getSettingWithDefault(key: string, defaultValue: boolean) {
  return computed(() => {
    try {
      // 尝试获取设置值
      const value = settingStore.getSettingValue(key as any)
      // 如果值是 undefined (说明可能设置存在但没有 value)，也使用默认值
      return value === undefined ? defaultValue : value
    }
    catch (error) {
      // 如果获取过程中发生错误（例如设置项根本不存在），则返回默认值
      // console.error(`Failed to get setting for "${key}", using default.`, error)
      return defaultValue
    }
  })
}

const showTime = getSettingWithDefault('showTime', true)
const showDate = getSettingWithDefault('showDate', true)
const showLunar = getSettingWithDefault('showLunar', true)
const showSecond = getSettingWithDefault('showSecond', true)

// --- 以下代码与之前版本相同 ---
const date = ref('')
const time = ref('')
const lunarDate = ref('')
const week = ref('')

let timeInterval: NodeJS.Timer

function refreshTime() {
  const now = new Date()
  const lang = settingStore.settings.language === 'System' ? navigator.language : settingStore.settings.language
  date.value = now.toLocaleString(lang, { month: 'long', day: 'numeric' })
  week.value = now.toLocaleString(lang, { weekday: 'long' })

  if (showSecond.value)
    time.value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
  else
    time.value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

  if (!lunarDate.value || time.value === '00:00' || time.value === '00:00:00')
    getDate()
  return refreshTime
}

function getDate() {
  const now = new Date().toISOString().split('T')[0]
  const dateArr = now.split('-').map(val => Number(val))
  const lunar = solarLunar.solar2lunar(dateArr[0], dateArr[1], dateArr[2])
  if (typeof lunar !== 'number')
    lunarDate.value = `${lunar.gzYear}${lunar.animal}年${lunar.monthCn}${lunar.dayCn}`
}

function timing() {
  refreshTime()
  const nowMinute = time.value
  timeInterval = setInterval(() => {
    refreshTime()
    if (!showSecond.value && nowMinute !== time.value) {
      clearInterval(timeInterval)
      timeInterval = setInterval(refreshTime, 60000)
    }
  }, 1000)
}
onMounted(() => {
  timing()
})
onBeforeUnmount(() => {
  clearInterval(timeInterval)
})
</script>

<template>
  <div text-center>
    <div v-if="showTime" text-48 tracking-wide>
      {{ time }}
    </div>
    <p v-if="showDate || showLunar" text="14 $text-c-1">
      <span v-if="showDate">{{ date }}<span ml-8>{{ week }}</span></span>
      <span v-if="showLunar" ml-8>{{ lunarDate }}</span>
    </p>
  </div>
</template>
