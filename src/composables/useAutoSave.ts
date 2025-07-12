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

    const { data: remoteProfile } = await supabase
      .from('profiles')
      .select('content')
      .eq('id', user.id)
      .single()

    let remoteContent: any = {}
    try {
      remoteContent = remoteProfile?.content ? JSON.parse(remoteProfile.content) : {}
    }
    catch (e) {
      console.warn('解析远程数据失败，将使用本地为主')
    }

    const localData = siteStore.customData
    const remoteData = remoteContent.data || []
    const mergedData = []

    // 用于判断哪些 group/site 已在本地被删除
    const localCategoryIds = new Set(localData.map((c: any) => c.id))
    const localGroupIds = new Set(localData.flatMap((c: any) => c.groupList.map((g: any) => g.id)))
    const localSiteUrls = new Set(
      localData.flatMap((c: any) =>
        c.groupList.flatMap((g: any) => g.siteList.map((s: any) => s.url)),
      ),
    )

    // 遍历本地，优先保留
    for (const localCategory of localData) {
      const remoteCategory = remoteData.find((r: any) => r.id === localCategory.id)
      const mergedCategory = { ...localCategory }

      mergedCategory.groupList = localCategory.groupList.map((localGroup: any) => {
        const remoteGroup = remoteCategory?.groupList?.find((g: any) => g.id === localGroup.id)
        const mergedGroup = { ...localGroup }

        if (remoteGroup) {
          const localUrls = new Set(localGroup.siteList.map((s: any) => s.url))
          const localIds = new Set(localGroup.siteList.map((s: any) => s.id))

          // 合并远程中本地没有但本地也没删除的站点
          const newSites = remoteGroup.siteList.filter(
            (site: any) => !localUrls.has(site.url) && !localIds.has(site.id),
          )

          mergedGroup.siteList = [...localGroup.siteList, ...newSites]
        }

        return mergedGroup
      })

      mergedData.push(mergedCategory)
    }

    // 检查远程是否有本地已经删除的分类（category）
    for (const remoteCategory of remoteData) {
      if (!localCategoryIds.has(remoteCategory.id))
        continue // 本地已删除，不合并

      const localCategory = mergedData.find((c: any) => c.id === remoteCategory.id)
      if (!localCategory)
        continue

      for (const remoteGroup of remoteCategory.groupList || []) {
        if (!localGroupIds.has(remoteGroup.id))
          continue // 本地已删除

        const localGroup = localCategory.groupList.find((g: any) => g.id === remoteGroup.id)
        if (!localGroup)
          continue

        const existingUrls = new Set(localGroup.siteList.map((s: any) => s.url))
        const newSites = remoteGroup.siteList.filter(
          (site: any) => !existingUrls.has(site.url) && localSiteUrls.has(site.url),
        )

        localGroup.siteList.push(...newSites)
      }
    }

    // 保存
    const contentToSave = {
      data: mergedData,
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
