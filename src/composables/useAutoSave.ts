import { debounce } from 'lodash-es'
import { ref } from 'vue'
import { useDialog } from 'naive-ui'
import { supabase } from '@/utils/supabaseClient'
import { useSettingStore } from '@/stores/setting'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'

export const restoredContentJson = ref('')
let lastSavedContent = ''

function toggleTheme(theme: string) {
  if (theme === 'dark')
    document.documentElement.classList.add('dark')
  else
    document.documentElement.classList.remove('dark')
}

function deepMergeSites(localData: any[], remoteData: any[]): any[] {
  const merged = structuredClone(localData)

  remoteData.forEach((remoteCategory: any) => {
    const localCategory = merged.find(c => c.name === remoteCategory.name)
    if (!localCategory) {
      merged.push(remoteCategory)
      return
    }

    remoteCategory.groupList?.forEach((remoteGroup: any) => {
      const localGroup = localCategory.groupList.find((g: any) => g.name === remoteGroup.name)
      if (!localGroup) {
        localCategory.groupList.push(remoteGroup)
        return
      }

      remoteGroup.siteList?.forEach((remoteSite: any) => {
        const exists = localGroup.siteList.some((s: any) => s.name === remoteSite.name)
        if (!exists)
          localGroup.siteList.push(remoteSite)
      })
    })
  })

  return merged
}

export function useAutoSave() {
  const settingStore = useSettingStore()
  const siteStore = useSiteStore()
  const authStore = useAuthStore()
  const dialog = useDialog()

  const autoLoadData = async ({ $message, t }: { $message: any; t: Function }) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user)
      return

    const { data, error } = await supabase
      .from('profiles')
      .select('content')
      .eq('id', user.id)
      .single()

    if (data && data.content) {
      try {
        const parsed = JSON.parse(data.content)

        if (parsed.data && Array.isArray(parsed.data)) {
          parsed.data.forEach((category: any) => {
            if (!category.groupList)
              category.groupList = []
            category.groupList.forEach((group: any) => {
              if (!group.siteList)
                group.siteList = []
            })
          })
        }

        if (parsed.data && parsed.settings) {
          settingStore.setSettings({ ...parsed.settings, websitePreference: 'Customize' })
          siteStore.setData(parsed.data)
          toggleTheme(parsed.settings.theme)

          const fullJson = JSON.stringify({ data: parsed.data, settings: parsed.settings })
          restoredContentJson.value = fullJson
          lastSavedContent = fullJson

          $message.success(t('autoSave.restored', { email: authStore.user?.email ?? '用户' }))
        }
      }
      catch (e) {
        console.error('❌ 解析云端数据失败:', e)
        $message.error(t('autoSave.parse_failed'))
      }
    }
    else if (error && error.code !== 'PGRST116') {
      console.error('❌ 加载数据时出错:', error)
      $message.error(t('autoSave.load_failed'))
    }
  }

  const autoSaveData = debounce(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user)
      return

    const localContent = {
      data: siteStore.customData,
      settings: settingStore.settings,
    }
    const newJson = JSON.stringify(localContent)

    if (newJson === lastSavedContent)
      return

    const { data: serverData, error } = await supabase
      .from('profiles')
      .select('content')
      .eq('id', user.id)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('❌ 读取远程数据失败:', error)
      return
    }

    const remoteJson = serverData?.content ?? ''
    if (remoteJson && remoteJson !== lastSavedContent && remoteJson !== newJson) {
      // ⚠️ 冲突，提示用户选择合并或覆盖
      dialog.warning({
        title: '同步冲突',
        content: '检测到其他设备也修改了内容，你希望如何处理？',
        positiveText: '合并（保留远程新增）',
        negativeText: '覆盖（保存本地为准）',
        onPositiveClick: async () => {
          try {
            const remoteParsed = JSON.parse(remoteJson)
            const mergedData = deepMergeSites(siteStore.customData, remoteParsed.data || [])
            const mergedContent = {
              data: mergedData,
              settings: settingStore.settings,
            }
            const mergedJson = JSON.stringify(mergedContent)

            const { error: mergeError } = await supabase.from('profiles').upsert({
              id: user.id,
              content: mergedJson,
              updated_at: new Date().toISOString(),
            })
            if (!mergeError)
              lastSavedContent = mergedJson
            else
              console.error('❌ 合并保存失败:', mergeError)
          }
          catch (e) {
            console.error('❌ 合并处理异常:', e)
          }
        },
        onNegativeClick: async () => {
          const { error: overwriteError } = await supabase.from('profiles').upsert({
            id: user.id,
            content: newJson,
            updated_at: new Date().toISOString(),
          })
          if (!overwriteError)
            lastSavedContent = newJson
          else
            console.error('❌ 覆盖保存失败:', overwriteError)
        },
      })
      return
    }

    // ✅ 无冲突，正常保存
    const { error: upsertError } = await supabase.from('profiles').upsert({
      id: user.id,
      content: newJson,
      updated_at: new Date().toISOString(),
    })
    if (!upsertError)
      lastSavedContent = newJson
    else
      console.error('❌ 保存失败:', upsertError)
  }, 2000)

  return {
    autoLoadData,
    autoSaveData,
  }
}
