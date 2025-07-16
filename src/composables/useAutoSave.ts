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

  // ✅ 加载远程数据逻辑
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
          lastSavedJson = restoredContentJson.value // ✅ 加上这行，防止刷新后误保存

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

  // ✅ 批处理合并保存逻辑
  let pending = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const SAVE_DELAY = 4000 // 保存延迟时间（单位：毫秒）

  const performAutoSave = async () => {
    if (!pending)
      return
    pending = false

    const contentToSave = {
      data: siteStore.customData,
      settings: settingStore.settings,
    }

    const currentJson = JSON.stringify(contentToSave)
    let lastSavedJson = ''
    // ✅ 如果和上次保存的内容一样，就跳过
    if (currentJson === lastSavedJson)
      return

    lastSavedJson = currentJson // ✅ 更新快照

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
    autoLoadData, // 初始化加载远程数据
    autoSaveData: triggerAutoSave, // 防抖自动保存（用户操作后 4 秒触发）
    manualSaveData: performAutoSave, // 手动立即保存（用于关键跳转前强制保存）
  }
}
