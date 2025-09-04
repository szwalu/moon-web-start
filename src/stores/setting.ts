import { reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useRoute } from 'vue-router'
import * as settingData from '@/utils/settings'
import type { Settings } from '@/types'
import { deepClone } from '@/utils'

export type SettingKey = keyof Settings

// =================================================================
// ===== 新增区域 START =====
// =================================================================

// 1. 为笔记的字号定义一个清晰的类型，方便在整个项目中使用
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

// 将这个辅助函数放在 defineStore 外部或 defineStore 内部的最开始
function checkIsMobileDevice(): boolean {
  return typeof navigator !== 'undefined' && /Mobi|Android|iPhone/i.test(navigator.userAgent)
}

export const useSettingStore = defineStore('setting', () => {
  const route = useRoute()
  const isSetting = ref(false)

  // --- 👇 将 isSideNavOpen 和 isMobile 的定义移到这里，确保在 restoreSettings 之前 👇 ---
  const isMobile = checkIsMobileDevice()
  const isSideNavOpen = ref(!isMobile) // PC端(!isMobile)默认打开(true)，移动端(isMobile)默认关闭(false)
  // --- 👆 上移结束 👆 ---

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
    localStorage.setItem('settings', JSON.stringify(toRaw(settings)))
  }, { deep: true })

  // =================================================================
  // ===== 新增区域 START =====
  // =================================================================

  // 2. 添加独立的 ref 来管理笔记字号状态
  // 从 localStorage 读取已保存的字号，如果没有则默认为 'medium'
  const savedFontSize = localStorage.getItem('note_font_size') as NoteFontSize | null
  const noteFontSize = ref<NoteFontSize>(savedFontSize || 'medium')

  // 3. 添加 watch 来监听字号变化，并将其持久化到 localStorage
  // 这确保了用户的偏好在刷新页面后依然保留
  watch(noteFontSize, (newSize) => {
    localStorage.setItem('note_font_size', newSize)
  })

  // 4. 提供一个 action (函数) 来修改字号
  function setNoteFontSize(newSize: NoteFontSize) {
    if (['small', 'medium', 'large', 'extra-large'].includes(newSize))
      noteFontSize.value = newSize
  }

  // =================================================================
  // ===== 新增区域 END =====
  // =================================================================

  function getSettingItem(key: keyof typeof settingData) {
  // 关键：在这里加上安全检查！
    const settingGroup = settingData[key]
    if (!settingGroup) {
      console.warn(`[setting] getSettingItem: 尝试获取一个未在 settings.ts 中定义的设置项 '${key}'`)
      return undefined // 安全地返回 undefined
    }
    return settingGroup.children.find(item => item.key === settings[key])
  }

  function getSettingValue(key: keyof typeof settingData) {
    const item = getSettingItem(key)
    // 如果 item 不存在，返回 null 或其他默认值，而不是尝试访问 .value
    return item ? item.value : null
  }

  function setSettings(newSettings: Partial<Settings>) {
    Object.assign(settings, newSettings)
  }

  // restoreSettings 函数现在可以安全地访问 isSideNavOpen 和 isMobile
  function restoreSettings() {
    Object.assign(settings, defaultSetting)
    isSideNavOpen.value = !isMobile // 使用已定义的 isMobile
    // --- 👇 修改区域 👇 ---
    // 5. 在重置所有设置时，也将笔记字号恢复为默认值 'medium'
    noteFontSize.value = 'medium'
    // --- 👆 修改结束 👆 ---
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

  // toggleSideNav 函数也移到 isSideNavOpen 定义之后
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

    // =================================================================
    // ===== 新增区域 START =====
    // =================================================================
    // 6. 将新的状态和方法暴露出去，以便其他组件可以使用
    noteFontSize,
    setNoteFontSize,
    // =================================================================
    // ===== 新增区域 END =====
    // =================================================================
  }
})
