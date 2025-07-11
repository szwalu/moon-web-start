import { debounce } from 'lodash-es'
import { ref } from 'vue'
import { supabase } from '@/utils/supabaseClient'
import { useSettingStore } from '@/stores/setting'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'

// ✅ 标记是否成功恢复内容（可选）
export const restoredContentJson = ref('')

function toggleTheme(theme: string) {
  if (theme === 'dark')
    document.documentElement.classList.add('dark')
  else
    document.documentElement.classList.remove('dark')
}

// ✅ 合并远程数据到本地数据（以本地为主，但保留远程新增）
function mergeData(remote: any[], local: any[]): any[] {
  const merged = [...local]
  for (const remoteCategory of remote) {
    const localCategory = merged.find(c => c.id === remoteCategory.id)
    if (!localCategory) {
      merged.push(remoteCategory)
    }
    else {
      // 合并 groupList
      localCategory.groupList = localCategory.groupList || []
      for (const remoteGroup of remoteCategory.groupList || []) {
        const localGroup = localCategory.groupList.find(g => g.id === remoteGroup.id)
        if (!localGroup) {
          localCategory.groupList.push(remoteGroup)
        }
        else {
          // 合并 siteList
          localGroup.siteList = localGroup.siteList || []
          for (const remoteSite of remoteGroup.siteList || []) {
            const exists = localGroup.siteList.some(s => s.id === remoteSite.id)
            if (!exists)
              localGroup.siteList.push(remoteSite)
          }
        }
      }
    }
  }
  return merged
}

export function useAutoSave() {
  const settingStore = useSettingStore()
  const siteStore = useSiteStore()
  const authStore = useAuthStore()

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

          restoredContentJson.value = JSON.stringify({
            data: parsed.data,
            settings: parsed.settings,
          })

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

    try {
      const { data: remoteData } = await supabase
        .from('profiles')
        .select('content')
        .eq('id', user.id)
        .single()

      if (remoteData?.content) {
        const parsed = JSON.parse(remoteData.content)
        if (Array.isArray(parsed.data))
          contentToSave.data = mergeData(parsed.data, contentToSave.data)
      }
    }
    catch (e) {
      console.warn('⚠️ 获取远程数据失败，跳过合并：', e)
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
