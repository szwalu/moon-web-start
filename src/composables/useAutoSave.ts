import { debounce } from 'lodash-es'
import { ref } from 'vue'
import { supabase } from '@/utils/supabaseClient'
import { useSettingStore } from '@/stores/setting'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'

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
          // 远程数据已获取，准备与本地合并
          const localData = siteStore.customData

          const mergedData = parsed.data.map((remoteCategory: any) => {
            const localCategory = localData.find((c: any) => c.id === remoteCategory.id)

            // 本地没有该分类，保留远程
            if (!localCategory)
              return remoteCategory

            const mergedGroups = remoteCategory.groupList.map((remoteGroup: any) => {
              const localGroup = localCategory.groupList.find((g: any) => g.id === remoteGroup.id)
              if (!localGroup)
                return remoteGroup

              const localUrls = new Set(localGroup.siteList.map((s: any) => s.url))
              const localIds = new Set(localGroup.siteList.map((s: any) => s.id))

              const newSites = remoteGroup.siteList.filter((site: any) =>
                !localUrls.has(site.url) && !localIds.has(site.id),
              )

              mergedGroup.siteList = [...localGroup.siteList, ...newSites]

              return {
                ...remoteGroup,
                siteList: [...localGroup.siteList, ...newSites],
              }
            })

            return {
              ...remoteCategory,
              groupList: mergedGroups,
            }
          })

          // 设置最终合并的数据
          siteStore.setData(mergedData)

          // 设置其它设置
          if (parsed.settings) {
            settingStore.setSettings({ ...parsed.settings, websitePreference: 'Customize' })
            toggleTheme(parsed.settings.theme)
          }

          restoredContentJson.value = JSON.stringify({
            data: mergedData,
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
