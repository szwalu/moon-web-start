import { computed, ref } from 'vue'
import { useSettingStore } from '@/stores/setting'

import { useSiteStore } from '@/stores/site'

// ✅ 加上这个

export function useDrag() {
  const settingStore = useSettingStore()
  const siteStore = useSiteStore() // ✅ 在函数作用域内定义 siteStore

  const disabled = ref(false)
  const draggableOptions = computed(() => ({
    animation: 200,
    disabled: !settingStore.isSetting || disabled.value,
    ghostClass: 'ghost',
    forceFallback: true,
    delay: isSmScreen.value ? 0 : 100,
    fallbackTolerance: 3,
  }))

  function handleStart() {
    if (!handleCustomize()) {
      disabled.value = true
      return
    }

    document.body.style.cursor = 'pointer'
    settingStore.setIsDragging(true)
  }

  function handleEnd() {
    if (disabled.value)
      disabled.value = false
    document.body.style.cursor = ''
    settingStore.setIsDragging(false)

    // ✅ 添加这行：排序后标记内容已修改，触发保存逻辑
    siteStore.setModified(true)
  }

  return {
    draggableOptions,
    handleStart,
    handleEnd,
  }
}
