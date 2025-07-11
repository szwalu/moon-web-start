import { debounce } from 'lodash-es'
import { ref } from 'vue'
import { useDialog } from 'naive-ui'
import { supabase } from '@/utils/supabaseClient'
import { useSettingStore } from '@/stores/setting'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'

export const restoredContentJson = ref('')
let lastSavedContent = '' // 🔁 用于防止重复保存

function toggleTheme(theme: string) {
  if (theme === 'dark')
    document.documentElement.classList.add('dark')
  else
    document.documentElement.classList.remove('dark')
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

    const contentToSave = {
      data: siteStore.customData,
      settings: settingStore.settings,
    }
    const newJson = JSON.stringify(contentToSave)

    if (newJson === lastSavedContent)
      return // ⚠️ 无变更不保存

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
      // ⚠️ 远程与本地均已修改，可能冲突
      dialog.warning({
        title: '同步冲突提示',
        content: '检测到其他设备也修改了数据，是否覆盖远程？',
        positiveText: '覆盖保存',
        negativeText: '取消',
        onPositiveClick: async () => {
          const { error: saveError } = await supabase.from('profiles').upsert({
            id: user.id,
            content: newJson,
            updated_at: new Date().toISOString(),
          })
          if (!saveError)
            lastSavedContent = newJson
          else
            console.error('❌ 冲突保存失败:', saveError)
        },
        onNegativeClick: () => {},
      })
      return
    }

    // ✅ 无冲突，直接保存
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
