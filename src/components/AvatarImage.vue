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
// src/components/AvatarImage.vue
watch([() => props.src, () => props.userId], ([newUrl, newUserId]) => {
  hasError.value = false

  // 1. 尝试读取 LocalStorage 缓存
  // 注意：如果 newUserId 是 undefined (极少数情况), cacheKey 会变成 avatar_cache_undefined，没关系，读不到就是 null
  const cacheKey = `avatar_cache_${newUserId}`
  const cachedBase64 = localStorage.getItem(cacheKey)

  if (cachedBase64) {
    // ✅ 命中缓存：无论 newUrl 是否存在，先显示缓存
    currentSrc.value = cachedBase64

    // 如果有网络地址，尝试后台更新；如果没有网络地址(离线启动中)，就保持显示缓存
    if (newUrl) {
      const img = new Image()
      img.src = newUrl
      img.onload = () => {
        currentSrc.value = newUrl
      }
    }
  }
  else {
    // ❌ 无缓存
    if (newUrl) {
      // 有网络地址，尝试显示
      currentSrc.value = newUrl
    }
    else {
      // 既无缓存，也无网络地址，这才清空
      currentSrc.value = null
      // 此时可以抛出 error 让父组件切到首字母
      if (newUserId) { // 只有 ID 存在时才报 error，防止初始化时的误报
        emit('error')
      }
    }
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
