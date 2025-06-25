import { debounce } from 'lodash-es'
import { ref } from 'vue'
import { supabase } from '@/utils/supabaseClient'
import { useSettingStore } from '@/stores/setting'
import { useSiteStore } from '@/stores/site'

// ✅ 全局导出用于判断是否是初次加载的数据（可选）
export const restoredContentJson = ref('')

function toggleTheme(theme: string) {
  if (theme === 'dark')
    document.documentElement.classList.add('dark')
  else
    document.documentElement.classList.remove('dark')
}

export function useAutoSave() {
  const settingStore = useSettingStore()
  const siteStore = useSiteStore()

  // ✅ 使用结构参数方式，确保 t() 和 $message 都是调用时传入的
  const autoLoadData = async ({ $message, t }: { $message: any; t: Function }) => {
    const user = window.__currentUser
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

          // ✅ 标记内容（可选用于对比是否改变）
          restoredContentJson.value = JSON.stringify({
            data: parsed.data,
            settings: parsed.settings,
          })

          $message.success(t('autoSave.restored'))
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
    const user = window.__currentUser
    if (!user)
      return

    const contentToSave = {
      data: siteStore.customData,
      settings: settingStore.settings,
    }

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      content: JSON.stringify(contentToSave),
      updated_at: new Date().toISOString(),
    })

    if (error)
      console.error('❌ 自动保存失败:', error)
  }, 2000)

  return {
    autoLoadData,
    autoSaveData,
  }
}
