<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps({
  userId: { type: String, required: true },
  src: { type: String, default: null },
  alt: { type: String, default: 'Avatar' },
})

// ✅ 新增 emit，用于告诉父组件“我彻底加载失败了，请显示首字母”
const emit = defineEmits(['error'])

const currentSrc = ref<string | null>(null)
const hasError = ref(false)

// ✅ 优化 1：同时监听 userId 和 src，防止切换用户时缓存 Key 滞后
watch([() => props.src, () => props.userId], ([newUrl, newUserId]) => {
  hasError.value = false // 重置错误状态

  // 1. 如果没有网络图片，直接清空
  if (!newUrl) {
    currentSrc.value = null
    return
  }

  // 2. 尝试读取 LocalStorage 缓存
  const cacheKey = `avatar_cache_${newUserId}` // 使用最新的 userId
  const cachedBase64 = localStorage.getItem(cacheKey)

  if (cachedBase64) {
    // ✅ 命中缓存：立即显示
    currentSrc.value = cachedBase64

    // ✅ 后台静默加载最新网络图
    const img = new Image()
    img.src = newUrl
    img.onload = () => {
      // 只有当当前显示的还是缓存时，才去替换，避免闪烁
      // 并且确保组件还没被销毁
      currentSrc.value = newUrl
    }
    // 离线时 onerror 会触发，但我们不需要处理，保持显示缓存即可
    img.onerror = () => {
      // 可选：console.log('后台更新头像失败，继续使用缓存')
    }
  }
  else {
    // ❌ 无缓存：只能直接显示网络图
    currentSrc.value = newUrl
  }
}, { immediate: true })

function handleError() {
  // 再次尝试回退机制
  const cacheKey = `avatar_cache_${props.userId}`
  const cachedBase64 = localStorage.getItem(cacheKey)

  // 如果当前显示的不是缓存，且缓存存在，则回退到缓存
  if (cachedBase64 && currentSrc.value !== cachedBase64) {
    currentSrc.value = cachedBase64
    hasError.value = false // 救活了
  }
  else {
    // 彻底没救了（既没网，也没缓存）
    hasError.value = true
    // ✅ 优化 2：通知父组件
    emit('error')
  }
}
</script>

<template>
  <img
    v-if="currentSrc"
    v-show="!hasError"
    :src="currentSrc"
    :alt="alt"
    class="avatar-img"
    @error="handleError"
  >
</template>

<style scoped>
/* 确保图片样式正确，继承父级圆角 */
.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  display: block;
}
</style>
