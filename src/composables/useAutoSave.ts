import { createClient } from '@supabase/supabase-js'
import { debounce } from 'lodash-es'
import { useSettingStore } from '@/stores/setting'
import { useSiteStore } from '@/stores/site'

function toggleTheme(theme: string) {
  if (theme === 'dark')
    document.documentElement.classList.add('dark')
  else
    document.documentElement.classList.remove('dark')
}

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

export function useAutoSave() {
  const settingStore = useSettingStore()
  const siteStore = useSiteStore()

  const autoLoadData = async ($message: any) => {
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
          $message.success('用户数据已从云端恢复 ✨')
        }
      }
      catch (e) {
        console.error('❌ 解析云端数据失败:', e)
        $message.error('解析云端数据失败')
      }
    }
    else if (error && error.code !== 'PGRST116') {
      console.error('❌ 加载数据时出错:', error)
      $message.error('加载用户数据失败')
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

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      content: JSON.stringify(contentToSave),
      updated_at: new Date().toISOString(),
    })

    if (error)
      console.error('❌ 自动保存失败:', error)
  }, 2000)

  // 【核心修正】：删除了不再需要的 startWatching 函数

  return {
    autoLoadData,
    autoSaveData,
  }
}
