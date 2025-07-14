import { ref, watch } from 'vue'
import { supabase } from '@/utils/supabaseClient'
import { useSettingStore } from '@/stores/setting'
import { useSiteStore } from '@/stores/site'

export const restoredContentJson = ref('')
export const remoteSnapshotReady = ref(false)

export const waitForRemoteSnapshot = new Promise<void>((resolve) => {
  const unwatch = watch(remoteSnapshotReady, (val) => {
    if (val) {
      resolve()
      unwatch()
    }
  })
})

function toggleTheme(theme: string) {
  if (theme === 'dark')
    document.documentElement.classList.add('dark')
  else
    document.documentElement.classList.remove('dark')
}

export function useAutoSave() {
  const settingStore = useSettingStore()
  const siteStore = useSiteStore()

  const autoLoadData = async ({ $message, t }: { $message: any; t: Function }) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user)
      return { restored: false }

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

        // 修复数据结构
        parsed.data?.forEach((category: any) => {
          category.groupList ??= []
          category.groupList.forEach((group: any) => {
            group.siteList ??= []
          })
        })

        if (parsed.data && parsed.settings) {
          settingStore.setSettings({ ...parsed.settings, websitePreference: 'Customize' })
          siteStore.setData(parsed.data)
          toggleTheme(parsed.settings.theme)

          const snapshot = JSON.stringify({
            data: parsed.data,
            settings: parsed.settings,
          })
          restoredContentJson.value = snapshot
          remoteSnapshotReady.value = true

          // console.log('✅ 远程快照已准备:', snapshot)

          return { restored: true }
        }
      }
      catch (_e) {
        console.error('❌ 解析云端数据失败:', _e)
        $message.error(t('autoSave.parse_failed'))
      }
    }
    else if (error && error.code !== 'PGRST116') {
      console.error('❌ 加载数据出错:', error)
      $message.error(t('autoSave.load_failed'))
    }
    else {
    // ✅ 没有数据但仍然准备快照，避免阻塞保存逻辑
      restoredContentJson.value = JSON.stringify({ data: [], settings: {} })
      remoteSnapshotReady.value = true
      // console.log('⚠️ 云端没有数据，远程快照设置为空模板')
    }

    return { restored: false }
  }

  const manualSaveData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user)
      return

    if (!remoteSnapshotReady.value) {
      // console.log('⏳ 等待远程快照准备...')
      await Promise.race([
        waitForRemoteSnapshot,
        new Promise((_, reject) => setTimeout(() => reject(new Error('等待远程快照超时')), 5000)),
      ]).catch((_e) => {
        // console.warn(e.message)
      })
    }

    const localContent = {
      data: siteStore.customData,
      settings: settingStore.settings,
    }

    let remoteContent: any
    try {
      remoteContent = JSON.parse(restoredContentJson.value)
    }
    catch (_e) {
      // console.error('❌ 解析远程数据失败:', _e)
    }

    const extractSiteMap = (data: any[]): Map<number, { name: string; url: string; index: number }> => {
      const map = new Map()
      data.forEach((category) => {
        category.groupList?.forEach((group) => {
          group.siteList?.forEach((site, index) => {
            map.set(site.id, { name: site.name, url: site.url, index })
          })
        })
      })
      return map
    }

    const isContentModified = (local: typeof localContent, remote: typeof localContent) => {
      if (!remote || !remote.data || !remote.settings)
        return true

      const remoteMap = extractSiteMap(remote.data)
      const localMap = extractSiteMap(local.data)

      for (const [id, site] of localMap) {
        const remoteSite = remoteMap.get(id)
        if (!remoteSite
      || site.name !== remoteSite.name
      || site.url !== remoteSite.url
      || site.index !== remoteSite.index // ✅ 比较排序顺序
        )
          return true
      }

      for (const id of remoteMap.keys()) {
        if (!localMap.has(id))
          return true
      }

      if (JSON.stringify(local.settings) !== JSON.stringify(remote.settings))
        return true

      return false
    }

    if (remoteContent && !isContentModified(localContent, remoteContent)) {
    //  console.log('✅ 内容未变，跳过保存')
      return
    }

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      content: JSON.stringify(localContent),
      updated_at: new Date().toISOString(),
    })

    if (error)
      console.error('❌ 手动保存失败:', error)
    else
    // console.log('内容已保存到远程') // eslint-disable-line no-console

      restoredContentJson.value = JSON.stringify(localContent)
  }

  return {
    autoLoadData,
    manualSaveData,
  }
}
