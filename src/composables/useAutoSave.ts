import { ref } from 'vue'
import { supabase } from '@/utils/supabaseClient'
import { useSettingStore } from '@/stores/setting'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'

export const restoredContentJson = ref('')
let lastSavedJson = ''

function toggleTheme(theme: string) {
  if (theme === 'dark')
    document.documentElement.classList.add('dark')
  else
    document.documentElement.classList.remove('dark')
}

function safeClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// ✅ 合并 siteList，远程优先，保留本地新增
function mergeSiteList(remoteList: any[] = [], localList: any[] = []) {
  const result = [...remoteList.map(safeClone)]
  const remoteIds = new Set(remoteList.map(site => site.id))
  for (const site of localList) {
    if (!remoteIds.has(site.id))
      result.push(safeClone(site))
  }
  return result
}

// ✅ 合并 groupList，远程优先，保留本地新增，合并 siteList
function mergeGroupList(remoteList: any[] = [], localList: any[] = []) {
  const result: any[] = []

  for (const remoteGroup of remoteList) {
    const localMatch = localList.find(g => g.id === remoteGroup.id)
    const mergedGroup = {
      ...safeClone(remoteGroup),
      siteList: mergeSiteList(remoteGroup.siteList || [], localMatch?.siteList || []),
    }
    result.push(mergedGroup)
  }

  // 加入本地独有的 group
  const remoteIds = new Set(remoteList.map(g => g.id))
  for (const group of localList) {
    if (!remoteIds.has(group.id))
      result.push(safeClone(group))
  }

  return result
}

// ✅ 合并 categoryList，远程优先，保留本地新增，合并 groupList
function mergeDataById(remoteList: any[], localList: any[]) {
  const result: any[] = []

  for (const remoteCategory of remoteList) {
    const localMatch = localList.find(c => c.id === remoteCategory.id)
    const mergedCategory = {
      ...safeClone(remoteCategory),
      groupList: mergeGroupList(remoteCategory.groupList || [], localMatch?.groupList || []),
    }
    result.push(mergedCategory)
  }

  const remoteIds = new Set(remoteList.map(c => c.id))
  for (const category of localList) {
    if (!remoteIds.has(category.id))
      result.push(safeClone(category))
  }

  return result
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

          const localData = siteStore.customData
          const remoteData = parsed.data
          const mergedData = mergeDataById(remoteData, localData)

          siteStore.setData(mergedData)
          toggleTheme(parsed.settings.theme)

          restoredContentJson.value = JSON.stringify({
            data: parsed.data,
            settings: parsed.settings,
          })
          lastSavedJson = restoredContentJson.value

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

  let pending = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const SAVE_DELAY = 4000

  const performAutoSave = async () => {
    if (!pending)
      return
    pending = false

    const contentToSave = {
      data: siteStore.customData,
      settings: settingStore.settings,
    }

    const currentJson = JSON.stringify(contentToSave)
    if (currentJson === lastSavedJson)
      return

    lastSavedJson = currentJson

    const { data: { user } } = await supabase.auth.getUser()
    if (!user)
      return

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      content: currentJson,
      updated_at: new Date().toISOString(),
    })

    if (error)
      console.error('❌ 自动保存失败:', error)
  }

  const triggerAutoSave = () => {
    if (saveTimer)
      clearTimeout(saveTimer)
    pending = true
    saveTimer = setTimeout(() => {
      performAutoSave()
    }, SAVE_DELAY)
  }

  return {
    autoLoadData,
    autoSaveData: triggerAutoSave,
    manualSaveData: performAutoSave,
  }
}

// 👇 ✅ 添加命名导出
export {
  mergeSiteList,
  mergeGroupList,
  mergeDataById,
}
