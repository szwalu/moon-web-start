import { debounce } from 'lodash-es'
import { ref } from 'vue'
import { supabase } from '@/utils/supabaseClient'
import { useSettingStore } from '@/stores/setting'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'

export const restoredContentJson = ref('')
const lastSavedContent = ref('')
const lastSavedTime = ref(0) // 本地最后保存的时间戳（毫秒）

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
      .select('content, updated_at')
      .eq('id', user.id)
      .single()

    if (data?.content) {
      try {
        const parsed = JSON.parse(data.content)

        parsed.data?.forEach((category: any) => {
          if (!category.groupList)
            category.groupList = []
          category.groupList.forEach((group: any) => {
            if (!group.siteList)
              group.siteList = []
          })
        })

        if (parsed.data && parsed.settings) {
          settingStore.setSettings({ ...parsed.settings, websitePreference: 'Customize' })
          siteStore.setData(parsed.data)
          toggleTheme(parsed.settings.theme)

          const json = JSON.stringify({ data: parsed.data, settings: parsed.settings })
          restoredContentJson.value = json
          lastSavedContent.value = json

          // 记录云端的更新时间
          lastSavedTime.value = new Date(`${data.updated_at}Z`).getTime()

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

    const newContent = {
      data: siteStore.customData,
      settings: settingStore.settings,
    }
    const newContentJson = JSON.stringify(newContent)

    if (newContentJson === lastSavedContent.value)
      return

    // 读取最新的远程更新时间戳
    const { data: remote, error } = await supabase
      .from('profiles')
      .select('updated_at')
      .eq('id', user.id)
      .single()

    if (error) {
      // console.error('❌ 获取远程更新时间失败:', error)
      return
    }

    const remoteUpdatedTime = new Date(`${remote.updated_at}Z`).getTime()

    // 🔍 核心判断：本地时间是否更晚
    if (lastSavedTime.value && remoteUpdatedTime > lastSavedTime.value) {
      // console.warn('⚠️ 云端数据比本地新，取消保存以避免覆盖')
      return
    }

    // 保存数据到 Supabase
    const now = new Date()
    const { error: saveError } = await supabase.from('profiles').upsert({
      id: user.id,
      content: newContentJson,
      updated_at: now.toISOString(),
    })

    if (!saveError) {
      lastSavedContent.value = newContentJson
      lastSavedTime.value = now.getTime()
      // console.log('✅ 自动保存成功')
    }
    else {
      // console.error('❌ 自动保存失败:', saveError)
    }
  }, 2000)

  return {
    autoLoadData,
    autoSaveData,
  }
}
