// src/composables/useAutosizeTextarea.ts

import { type Ref, nextTick, onMounted, watch } from 'vue'

/**
 * 一个 Vue Composable，用于让 textarea 元素根据内容自动调整高度。
 * @param modelRef - 绑定到 textarea 的 v-model 的 ref (例如，包含文本内容的 ref)。
 * @param elementRef - 绑定到 textarea 元素本身的 ref。
 */
export function useAutosizeTextarea(
  modelRef: Ref<string>,
  elementRef: Ref<HTMLTextAreaElement | null>,
) {
  const resize = () => {
    const el = elementRef.value
    if (!el)
      return

    // 关键逻辑：
    // 1. 先将高度重置为 auto，这样才能正确计算出内容的实际高度（scrollHeight）。
    el.style.height = 'auto'
    // 2. 然后将高度设置为内容的实际高度。
    el.style.height = `${el.scrollHeight}px`
  }

  // 在组件挂载后，立即调整一次大小，以适应初始内容。
  onMounted(() => {
    nextTick(resize)
  })

  // 监听绑定的文本内容的变化，每次变化时都重新调整大小。
  watch(modelRef, () => {
    // 使用 nextTick 确保在 DOM 更新后再计算高度，防止计算不准确。
    nextTick(resize)
  })
}
