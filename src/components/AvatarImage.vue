<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps({
  userId: { type: String, required: true },
  src: { type: String, default: null },
  alt: { type: String, default: 'Avatar' },
})

const currentSrc = ref<string | null>(null)
const hasError = ref(false)

// 核心：缓存策略逻辑
watch(() => props.src, (newUrl) => {
  // 1. 如果没有网络图片，直接清空
  if (!newUrl || newUrl === 'null') {
    currentSrc.value = null
    return
  }

  // 2. 尝试读取 LocalStorage 缓存 (Key 与 AccountModal 保持一致)
  const cacheKey = `avatar_cache_${props.userId}`
  const cachedBase64 = localStorage.getItem(cacheKey)

  if (cachedBase64) {
    // ✅ 命中缓存：立即显示，实现 0ms 秒开
    currentSrc.value = cachedBase64
    hasError.value = false

    // ✅ 后台静默加载最新网络图
    // 只有当网络地址和缓存不一致（或者是首次加载）时才去请求
    // 注意：这里我们不做严格对比，总是尝试加载新图以确保头像是最新的
    const img = new Image()
    img.src = newUrl
    img.onload = () => {
      // 图片加载好了，无缝切换
      currentSrc.value = newUrl
      // (可选) 如果你想在这里也更新缓存，可以解开下面这行
      // 但是通常我们在“上传成功”时更新缓存就够了
    }
  }
  else {
    // ❌ 无缓存：只能直接显示网络图
    currentSrc.value = newUrl
  }
}, { immediate: true })

function handleError() {
  // 如果当前显示的已经是缓存，就不要再处理了
  // 如果当前是网络图加载失败，尝试回退到缓存
  const cacheKey = `avatar_cache_${props.userId}`
  const cachedBase64 = localStorage.getItem(cacheKey)

  if (cachedBase64 && currentSrc.value !== cachedBase64)
    currentSrc.value = cachedBase64
  else
    hasError.value = true
}
</script>

<template>
  <img
    v-if="currentSrc && !hasError"
    :src="currentSrc"
    :alt="alt"
    @error="handleError"
  >
</template>
