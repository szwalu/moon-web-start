import { reactive, ref, toRaw, watch } from 'vue'

// ✅ 修改：补上了 toRaw
import { defineStore } from 'pinia'
import { useRoute } from 'vue-router'
import * as settingData from '@/utils/settings'
import type { Settings } from '@/types'
import { deepClone } from '@/utils'

// 定义位置数据的接口
export interface UserLocation {
  name: string
  lat: number
  lon: number
}

export type SettingKey = keyof Settings

// =================================================================
// ===== 新增区域 1：类型定义 =====
// =================================================================

// 1. 为笔记的字号定义一个清晰的类型
export type NoteFontSize = 'small' | 'medium' | 'large' | 'extra-large'

// =================================================================
// ===== 新增区域 END =====
// =================================================================

export function loadSettings(): Settings | undefined {
  const settings = localStorage.getItem('settings')
  return settings ? JSON.parse(settings) : undefined
}

const defaultSetting: Settings = Object.fromEntries(
  Object.keys(settingData).map(key => [key, settingData[key as SettingKey].defaultKey]),
) as Settings

// 辅助函数
function checkIsMobileDevice(): boolean {
  return typeof navigator !== 'undefined' && /Mobi|Android|iPhone/i.test(navigator.userAgent)
}

export const useSettingStore = defineStore('setting', () => {
  const route = useRoute()
  const isSetting = ref(false)

  // --- isSideNavOpen 和 isMobile 定义 ---
  const isMobile = checkIsMobileDevice()
  const isSideNavOpen = ref(!isMobile)

  watch(route, () => {
    if (route.name === 'setting')
      isSetting.value = true
    else
      isSetting.value = false
  }, { immediate: true })

  const settingCache = loadSettings()

  const settings = reactive<Settings>((() => {
    const _defaultSetting = deepClone(defaultSetting)
    let settings: Settings
    if (settingCache)
      settings = Object.assign(_defaultSetting, settingCache)
    else
      settings = _defaultSetting

    // 排除非法值
    Object.keys(settings).forEach((key) => {
      if (!defaultSetting[key as SettingKey])
        return
      if (!settingData[key as SettingKey]?.children.find(item => item.key === settings[key as SettingKey]))
        settings[key as SettingKey] = settingData[key as SettingKey].defaultKey
    })
    return settings
  })())

  watch(settings, () => {
    // ✅ 这里用到了 toRaw，所以在顶部必须 import { toRaw } from 'vue'
    localStorage.setItem('settings', JSON.stringify(toRaw(settings)))
  }, { deep: true })

  // =================================================================
  // ===== 新增区域 2：笔记字号逻辑 =====
  // =================================================================

  const savedFontSize = localStorage.getItem('note_font_size') as NoteFontSize | null
  const noteFontSize = ref<NoteFontSize>(savedFontSize || 'medium')

  watch(noteFontSize, (newSize) => {
    localStorage.setItem('note_font_size', newSize)
  })

  function setNoteFontSize(newSize: NoteFontSize) {
    if (['small', 'medium', 'large', 'extra-large'].includes(newSize))
      noteFontSize.value = newSize
  }

  // =================================================================
  // ===== 新增区域 3：手动城市定位逻辑 (🔥 本次新增) =====
  // =================================================================

  // 1. 定义状态：优先从 localStorage 读取手动保存的城市
  const savedLocStr = localStorage.getItem('manual_location_v1')
  const manualLocation = ref<UserLocation | null>(savedLocStr ? JSON.parse(savedLocStr) : null)

  // 2. 定义 Action：设置或清除手动城市
  function setManualLocation(loc: UserLocation | null) {
    manualLocation.value = loc
    if (loc)
      localStorage.setItem('manual_location_v1', JSON.stringify(loc))
    else
      localStorage.removeItem('manual_location_v1')
  }

  // =================================================================
  // ===== 新增区域 END =====
  // =================================================================

  function getSettingItem(key: keyof typeof settingData) {
    const settingGroup = settingData[key]
    if (!settingGroup) {
      console.warn(`[setting] getSettingItem: 尝试获取一个未在 settings.ts 中定义的设置项 '${key}'`)
      return undefined
    }
    return settingGroup.children.find(item => item.key === settings[key])
  }

  function getSettingValue(key: keyof typeof settingData) {
    const item = getSettingItem(key)
    return item ? item.value : null
  }

  function setSettings(newSettings: Partial<Settings>) {
    Object.assign(settings, newSettings)
  }

  // 重置设置
  function restoreSettings() {
    Object.assign(settings, defaultSetting)
    isSideNavOpen.value = !isMobile

    // 恢复字号
    noteFontSize.value = 'medium'

    // ✅ 恢复定位：重置为自动定位 (即清除手动设置)
    setManualLocation(null)
  }

  // ----------------- 拖拽 -----------------
  const isDragging = ref(false)

  function setIsDragging(status: boolean) {
    isDragging.value = status
  }

  // ----------------- 其他 -----------------
  const siteContainerKey = ref(0)

  function refreshSiteContainer() {
    siteContainerKey.value++
  }

  function toggleSideNav() {
    isSideNavOpen.value = !isSideNavOpen.value
  }

  return {
    isSetting,
    settings,
    isDragging,
    siteContainerKey,
    setSettings,
    setIsDragging,
    getSettingItem,
    getSettingValue,
    restoreSettings,
    refreshSiteContainer,
    isSideNavOpen,
    toggleSideNav,

    // 字号相关
    noteFontSize,
    setNoteFontSize,

    // ✅ 手动定位相关 (暴露给组件使用)
    manualLocation,
    setManualLocation,
  }
})
