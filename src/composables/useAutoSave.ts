import { debounce } from 'lodash-es'
import { h, ref } from 'vue'
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
        $message.error(t('autoSave.parse_failed'))
      }
    }
    else if (error && error.code !== 'PGRST116') {
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

    if (error && error.code !== 'PGRST116')
      return

    const remoteJson = serverData?.content ?? ''

    if (remoteJson && remoteJson !== lastSavedContent && remoteJson !== newJson) {
      dialog.create({
        title: t('autoSave.conflict.title'),
        content: t('autoSave.conflict.content'),
        action: () =>
          h(
            'div',
            {
              style: `
        display: flex;
        flex-direction: column;
        gap: 12px;
        align-items: center;
        justify-content: center;
        padding-top: 12px;
        width: 100%;
      `,
            },
            [
              h(
                'button',
                {
                  style: `
            background-color: #fadb14;
            color: #000;
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            width: 160px;
          `,
                  onClick: async () => {
                    try {
                      const remoteParsed = JSON.parse(remoteJson)
                      const mergedSites = mergeSiteData(siteStore.customData, remoteParsed.data)

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
                        siteStore.setData(mergedSites)
                      }
                    }
                    catch (e) {
                      // 合并处理失败
                    }

                    dialog.destroyAll()
                  },
                },
                t('autoSave.conflict.merge'),
              ),
              h(
                'button',
                {
                  style: `
            background-color: #f0f0f0;
            color: #000;
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            width: 160px;
          `,
                  onClick: async () => {
                    const { error: overwriteError } = await supabase.from('profiles').upsert({
                      id: user.id,
                      content: newJson,
                      updated_at: new Date().toISOString(),
                    })

                    if (!overwriteError)
                      lastSavedContent = newJson

                    dialog.destroyAll()
                  },
                },
                t('autoSave.conflict.overwrite'),
              ),
              h(
                'button',
                {
                  style: `
            background-color: #f0f0f0;
            color: #000;
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            width: 160px;
          `,
                  onClick: async () => {
                    try {
                      const remoteParsed = JSON.parse(remoteJson)
                      if (remoteParsed.data && Array.isArray(remoteParsed.data)) {
                        remoteParsed.data.forEach((category: any) => {
                          if (!category.groupList)
                            category.groupList = []
                          category.groupList.forEach((group: any) => {
                            if (!group.siteList)
                              group.siteList = []
                          })
                        })
                      }

                      siteStore.setData(remoteParsed.data)
                      settingStore.setSettings({ ...remoteParsed.settings, websitePreference: 'Customize' })

                      const fullJson = JSON.stringify({
                        data: remoteParsed.data,
                        settings: remoteParsed.settings,
                      })
                      restoredContentJson.value = fullJson
                      lastSavedContent = fullJson
                    }
                    catch (e) {
                      // 解析失败
                    }

                    dialog.destroyAll()
                  },
                },
                t('autoSave.conflict.useRemote'),
              ),
            ],
          ),
      })
      return
    }

    const { error: upsertError } = await supabase.from('profiles').upsert({
      id: user.id,
      content: newJson,
      updated_at: new Date().toISOString(),
    })
    if (!upsertError)
      lastSavedContent = newJson
  }, 2000)

  return {
    autoLoadData,
    autoSaveData,
  }
}
