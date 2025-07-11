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

// 🧠 合并逻辑：合并 siteList 数组（避免重复）
function mergeSiteData(localData: any[], remoteData: any[]): any[] {
  const merged = JSON.parse(JSON.stringify(localData)) // 深拷贝
  const findGroup = (cat: any, groupName: string) => cat.groupList.find((g: any) => g.name === groupName)

  remoteData.forEach((remoteCat: any) => {
    const localCat = merged.find((c: any) => c.name === remoteCat.name)
    if (!localCat) {
      merged.push(remoteCat) // 整类都不存在，直接加
    }
    else {
      remoteCat.groupList.forEach((remoteGroup: any) => {
        const localGroup = findGroup(localCat, remoteGroup.name)
        if (!localGroup) {
          localCat.groupList.push(remoteGroup)
        }
        else {
          remoteGroup.siteList.forEach((site: any) => {
            if (!localGroup.siteList.some((s: any) => s.name === site.name && s.url === site.url))
              localGroup.siteList.push(site)
          })
        }
      })
    }
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
        // console.error('❌ 解析云端数据失败:', e)
        $message.error(t('autoSave.parse_failed'))
      }
    }
    else if (error && error.code !== 'PGRST116') {
      // console.error('❌ 加载数据时出错:', error)
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
      return

    const { data: serverData, error } = await supabase
      .from('profiles')
      .select('content')
      .eq('id', user.id)
      .single()

    if (error && error.code !== 'PGRST116') {
      // console.error('❌ 读取远程数据失败:', error)
      return
    }

    const remoteJson = serverData?.content ?? ''

    if (remoteJson && remoteJson !== lastSavedContent && remoteJson !== newJson) {
      // 🚨 冲突，弹出选择
      dialog.warning({
        title: '同步冲突提示',
        content: '检测到其他设备也修改了数据，你希望怎么处理？',
        positiveText: '合并新增内容',
        negativeText: '仅保存本地',
        onPositiveClick: async () => {
          try {
            const remoteParsed = JSON.parse(remoteJson)
            const mergedSites = mergeSiteData(siteStore.customData, remoteParsed.data)

            // 合并后更新远程
            const mergedJson = JSON.stringify({
              data: mergedSites,
              settings: settingStore.settings,
            })

            const { error: mergeError } = await supabase.from('profiles').upsert({
              id: user.id,
              content: mergedJson,
              updated_at: new Date().toISOString(),
            })

            if (!mergeError) {
              lastSavedContent = mergedJson
              siteStore.setData(mergedSites) // ✅ 更新本地数据
              //  console.log('✅ 合并并保存成功')
            }
            else {
              //  console.error('❌ 合并保存失败:', mergeError)
            }
          }
          catch (e) {
            //  console.error('❌ 合并处理失败:', e)
          }
        },
        onNegativeClick: async () => {
          const { error: overwriteError } = await supabase.from('profiles').upsert({
            id: user.id,
            content: newJson,
            updated_at: new Date().toISOString(),
          })

          if (!overwriteError) {
            lastSavedContent = newJson
            //  console.log('✅ 覆盖保存成功')
          }
          else {
            //  console.error('❌ 覆盖失败:', overwriteError)
          }
        },
      })

      return
    }

    // ✅ 无冲突，直接保存
    const { error: upsertError } = await supabase.from('profiles').upsert({
      id: user.id,
      content: newJson,
      updated_at: new Date().toISOString(),
    })
    if (!upsertError) {
      lastSavedContent = newJson
    }
    else {
      // console.error('❌ 保存失败:', upsertError)
    }
  }, 2000)

  return {
    autoLoadData,
    autoSaveData,
  }
}
