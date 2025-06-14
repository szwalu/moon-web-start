import { watch } from 'vue'
import { createClient } from '@supabase/supabase-js'
import { debounce } from 'lodash-es'
import { useSettingStore } from '@/stores/setting'
import { useSiteStore } from '@/stores/site'

/**
 * 根据主题名称切换亮色/暗色模式
 * @param theme 'light' 或 'dark'
 */
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

export function useAutoSave($message: any) {
  const settingStore = useSettingStore()
  const siteStore = useSiteStore()

  const autoLoadData = async () => {
    // 【核心修正 1】: 检查会话存储，如果标记已存在，则说明加载过，直接退出函数
    if (sessionStorage.getItem('sessionDataLoaded') === 'true') {
      // console.log('数据已在本次会话中加载过，跳过重复恢复。')
      return
    }

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
        if (parsed.data && parsed.settings) {
          siteStore.setData(parsed.data)
          settingStore.setSettings(parsed.settings)
          toggleTheme(parsed.settings.theme)

          // 【核心修正 2】: 数据成功恢复后，在会话存储中设置一个标记
          sessionStorage.setItem('sessionDataLoaded', 'true')

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
      data: siteStore.customData, // 确保保存的是 customData
      settings: settingStore.settings,
    }

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      content: JSON.stringify(contentToSave),
      updated_at: new Date().toISOString(),
    })

    if (error) {
      console.error('❌ 自动保存失败:', error)
      $message.error('自动保存失败')
    }
    else {
      // console.log('✅ 数据已自动保存到云端')
    }
  }, 2000)

  const startWatching = () => {
    watch(
      () => siteStore.customData,
      () => {
        if (settingStore.settings.websitePreference !== 'Customize')
          settingStore.setSettings({ websitePreference: 'Customize' })
        autoSaveData()
      },
      { deep: true },
    )
    // console.log('🚀 已启动数据变更侦听。')
  }

  return {
    autoLoadData,
    startWatching,
    supabase,
  }
}
