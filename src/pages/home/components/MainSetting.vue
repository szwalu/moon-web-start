<script setup lang="ts">
import type { VNode } from 'vue'
import SettingSelection from './SettingSelection.vue'
import { supabase } from '@/utils/supabaseClient'
import type { Category, SettingItem, Settings, TagMode, Theme, WebsitePreference } from '@/types'
import { WITH_SERVER, getText, loadLanguageAsync, secretIdStorage } from '@/utils'
import * as S from '@/utils/settings'

const settingStore = useSettingStore()
const siteStore = useSiteStore()

function renderThemeLabel(option: SettingItem<Theme>): VNode {
  const currentTheme = S.theme.children.find(item => item.key === option.key)!
  const bgColor = currentTheme.value!.bgC
  return h('div', { class: 'flex items-center gap-x-8' }, [
    h('div', { class: 'w-16 h-16 circle border-1 border-fff', style: { backgroundColor: bgColor } }),
    h('div', getText(option.name)),
  ])
}

function toggleLanguage(language: string) {
  settingStore.setSettings({ language })
  loadLanguageAsync(language)
}

function handleWebsitePreferenceChange(key: WebsitePreference) {
  siteStore.setCateIndex(0)
  settingStore.setSettings({ websitePreference: key })
  settingStore.refreshSiteContainer()
}

export interface CacheData {
  data: Category[]
  settings: Settings
}

function exportData() {
  const data = {
    data: siteStore.data,
    settings: settingStore.settings,
  }
  const jsonStr = JSON.stringify(data)
  const blob = new Blob([jsonStr], { type: 'application/json' })

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.download = `MoonStart_Data_${new Date().toLocaleString()}.json`
  a.href = url
  document.body.appendChild(a)
  a.click()
  URL.revokeObjectURL(url)
  $message.success(t('messages.exported'))
}

function importData() {
  const inputElement = document.createElement('input')
  inputElement.type = 'file'
  inputElement.accept = '.json'
  inputElement.addEventListener('change', async () => {
    const file = inputElement.files?.[0]
    if (file) {
      try {
        const jsonStr = await file.text()
        const data = JSON.parse(jsonStr) as CacheData
        if (!data.data || !data.settings)
          throw new Error('Invalid data')
        loadData(data)
        settingStore.setSettings({ websitePreference: 'Customize' })
        settingStore.refreshSiteContainer()
        $message.success(t('messages.imported'))
      }
      catch (err: any) {
        $message.error(t('messages.warnInvalidImport'))
      }
    }
  })
  inputElement.click()
}

async function resetData() {
  // 1. 首先获取当前用户状态
  const { data: { user } } = await supabase.auth.getUser()

  // 2. 如果用户存在 (已登录)，弹出提示并阻止后续操作
  if (user) {
    $message.warning(t('messages.warn_logout_to_reset'))
    return
  }

  // 3. 如果用户不存在 (未登录)，则执行重置确认流程
  $dialog.warning({
    title: t('messages.tip'),
    content: t('messages.warnResetData'),
    positiveText: t('button.confirm'),
    negativeText: t('button.cancel'),
    onPositiveClick() {
      // 【核心修正】: 不再调用 store 的 action，而是直接操作 localStorage
      localStorage.removeItem('settings')
      localStorage.removeItem('cache')

      // 强制刷新页面来应用重置
      window.location.reload()

      // 刷新后会自动恢复，下面的消息提示可以省略或保留
      // $message.success(t('messages.reset'))
    },
  })
}

function loadData(data: any) {
  siteStore.setData(data.data)
  settingStore.setSettings(data.settings)
  toggleTheme(data.settings.theme)
}

const secretId = ref(settingStore.isSetting ? secretIdStorage.get() : '')
const syncId = ref('')

function validateSyncId() {
  if (/^\w{5,20}$/.test(syncId.value))
    return true
  $message.warning(t('messages.warnValidateId'))
  return false
}

async function handleSaveData() {
  if (!validateSyncId())
    return
  if (settingStore.getSettingValue('websitePreference') !== 'Customize') {
    $message.warning(t('messages.warnCustomize'))
    return
  }
  const loadingRef = $message.loading(t('messages.saving'), { duration: 0 })
  try {
    const { error } = await supabase.from('moon').upsert([
      {
        id: syncId.value,
        content: JSON.stringify({
          data: siteStore.data,
          settings: settingStore.settings,
        }),
        created_at: new Date().toISOString(),
      },
    ])
    if (error)
      throw error
    $message.success(t('messages.saveSuccess'))
    secretIdStorage.set(syncId.value)
    syncId.value = ''
    secretId.value = ''
  }
  catch (e) {
    console.error('❌ 请求异常：', e)
    $message.error(t('messages.Request'))
  }
  finally {
    loadingRef.destroy()
  }
}

async function handleReadData() {
  if (!validateSyncId())
    return
  const loadingRef = $message.loading(t('messages.reading'), { duration: 0 })
  try {
    const { data, error } = await supabase.from('moon').select('content').eq('id', syncId.value).single()
    if (error || !data)
      throw error || new Error('无数据')
    const parsed = JSON.parse(data.content)
    loadData(parsed)
    $message.success(t('messages.readSuccess'))
    secretIdStorage.set(syncId.value)
    syncId.value = ''
    secretId.value = ''
  }
  catch (e: any) {
    console.error('❌ 读取失败：', e)
    $message.error(e.message || t('messages.readFailed'))
  }
  finally {
    loadingRef.destroy()
  }
}

function handleStopSync() {
  secretIdStorage.remove()
  secretId.value = ''
}
</script>

<template>
  <section v-if="settingStore.isSetting" px="md:32 lg:64">
    <div my-16 text="16 $text-c-1" italic>
      {{ $t('settings.title') }}
    </div>
    <div grid grid-cols-2 md="grid-cols-3" lg="grid-cols-4" justify-between gap-12>
      <SettingSelection v-model="settingStore.settings.theme" :title="S.theme.name" :options="S.theme.children" :render-label="renderThemeLabel" label-field="name" value-field="key" :on-update-value="(theme: string) => toggleTheme(theme)" />
      <SettingSelection v-model="settingStore.settings.language" :title="S.language.name" :options="S.language.children" label-field="name" value-field="key" :on-update-value="(key: string) => toggleLanguage(key)" />
      <SettingSelection v-model="settingStore.settings.websitePreference" :title="S.websitePreference.name" :options="S.websitePreference.children" label-field="name" value-field="key" :on-update-value="handleWebsitePreferenceChange" />
      <SettingSelection v-model="settingStore.settings.tagMode" :title="S.tagMode.name" :options="S.tagMode.children" label-field="name" value-field="key" :on-update-value="(key: TagMode) => settingStore.setSettings({ tagMode: key })" />
      <SettingSelection v-model="settingStore.settings.search" :title="S.search.name" :options="S.search.children" label-field="name" value-field="key" :on-update-value="(key: string) => settingStore.setSettings({ search: key })" />
      <SettingSelection v-model="settingStore.settings.iconStyle" :title="S.iconStyle.name" :options="S.iconStyle.children" label-field="name" value-field="key" :on-update-value="(key: string) => settingStore.setSettings({ iconStyle: key })" />
      <SettingSelection v-model="settingStore.settings.linkStrategy" :title="S.linkStrategy.name" :options="S.linkStrategy.children" label-field="name" value-field="key" :on-update-value="(key: string) => settingStore.setSettings({ linkStrategy: key })" />
      <SettingSelection v-model="settingStore.settings.showTime" :title="S.showTime.name" :options="S.showTime.children" label-field="name" value-field="key" :on-update-value="(key: string) => settingStore.setSettings({ showTime: key })" />
      <SettingSelection v-model="settingStore.settings.showDate" :title="S.showDate.name" :options="S.showDate.children" label-field="name" value-field="key" :on-update-value="(key: string) => settingStore.setSettings({ showDate: key })" />
      <SettingSelection v-model="settingStore.settings.showWeather" :title="S.showWeather.name" :options="S.showWeather.children" label-field="name" value-field="key" :on-update-value="(key: string) => settingStore.setSettings({ showWeather: key })" />
      <SettingSelection v-model="settingStore.settings.showSecond" :title="S.showSecond.name" :options="S.showSecond.children" label-field="name" value-field="key" :on-update-value="(key: string) => settingStore.setSettings({ showSecond: key })" />
      <SettingSelection v-model="settingStore.settings.showLunar" :title="S.showLunar.name" :options="S.showLunar.children" label-field="name" value-field="key" :on-update-value="(key: string) => settingStore.setSettings({ showLunar: key })" />
      <SettingSelection v-model="settingStore.settings.showFooter" :title="S.showFooter.name" :options="S.showFooter.children" label-field="name" value-field="key" :on-update-value="(key: string) => settingStore.setSettings({ showFooter: key })" />
    </div>
    <div v-if="WITH_SERVER" mt-16 flex-center py-12>
      <div flex-center gap-12>
        <n-input v-if="!secretId" v-model:value="syncId" :placeholder="$t('inputIdPlaceholder')" />
        <n-button v-else type="success" disabled>{{ $t('button.dataInSync') }}</n-button>
        <div v-if="!secretId" flex gap-12>
          <n-button secondary @click="handleSaveData">{{ $t('button.save') }}</n-button>
          <n-button secondary @click="handleReadData">{{ $t('button.read') }}</n-button>
        </div>
        <n-button v-else secondary @click="handleStopSync">{{ $t('button.stopSync') }}</n-button>
      </div>
    </div>
    <div mt-16 flex flex-wrap justify-center gap-12>
      <n-button type="primary" quaternary @click="resetData">{{ $t('button.resetData') }}</n-button>
      <n-button type="success" tertiary @click="importData">{{ $t('button.importData') }}</n-button>
      <n-button type="success" secondary @click="exportData">{{ $t('button.exportData') }}</n-button>
    </div>
    <div my-16 flex-center>
      <n-button size="large" type="primary" @click="$router.back()">{{ $t('button.complete') }}</n-button>
    </div>
  </section>
</template>
