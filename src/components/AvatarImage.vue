<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps({
  userId: { type: String, required: true },
  src: { type: String, default: null },
  alt: { type: String, default: 'Avatar' },
})

const emit = defineEmits(['error'])

const currentSrc = ref<string | null>(null)
const hasError = ref(false)

// ♻️ 辅助：将 Blob 转 Base64
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// 💾 核心：使用 Fetch 下载并缓存图片
async function cacheImageFromUrl(url: string, uid: string) {
  try {
    // 使用 fetch 获取图片数据 (比 Image 对象更可靠)
    const response = await fetch(url, { mode: 'cors' })
    if (!response.ok)
      throw new Error('Network response was not ok')

    const blob = await response.blob()
    const base64 = await blobToBase64(blob)

    // 存入缓存
    const key = `avatar_cache_${uid}`
    try {
      localStorage.setItem(key, base64)
      // 如果当前正在显示旧图或网络图，更新为 Base64 以验证缓存成功
      // (可选: 这样能确保离线时用的就是这份数据)
      // currentSrc.value = base64
    }
    catch (storageErr) {
      console.warn('头像缓存失败(可能是存储空间已满):', storageErr)
    }
  }
  catch (e) {
    console.warn('头像下载/缓存失败(可能是跨域CORS限制):', e)
  }
}

watch([() => props.src, () => props.userId], async ([newUrl, newUserId]) => {
  hasError.value = false

  // 1. 先尝试读取缓存 (实现秒开)
  const cacheKey = `avatar_cache_${newUserId}`
  const cachedBase64 = localStorage.getItem(cacheKey)

  if (cachedBase64) {
    // ✅ 场景 A：有缓存 -> 立即显示缓存
    currentSrc.value = cachedBase64

    // 📡 即使有缓存，如果有新 URL，也在后台默默更新缓存
    if (newUrl && newUrl !== 'null') {
      // 不立即替换显示，防止闪烁，只更新 LocalStorage
      cacheImageFromUrl(newUrl, newUserId)
    }
  }
  else {
    // ❌ 场景 B：无缓存
    if (newUrl && newUrl !== 'null') {
      // 有网络图 -> 显示网络图 -> 并尝试下载缓存
      currentSrc.value = newUrl
      cacheImageFromUrl(newUrl, newUserId)
    }
    else {
      // 既无缓存，也无网络图 (PWA离线启动瞬间)
      // 保持 null，等待父组件数据更新，暂不报错
      currentSrc.value = null
    }
  }
}, { immediate: true })

function handleError() {
  // 图片加载出错 (404 或 断网)
  // 再次尝试回退到缓存 (防止上面的 watch 逻辑漏网)
  const cacheKey = `avatar_cache_${props.userId}`
  const cachedBase64 = localStorage.getItem(cacheKey)

  if (cachedBase64 && currentSrc.value !== cachedBase64) {
    // 救活了：切换到缓存
    currentSrc.value = cachedBase64
    hasError.value = false
  }
  else {
    // 彻底挂了：通知父组件显示首字母
    hasError.value = true
    emit('error')
  }
}
</script>

<template>
  <img
    v-if="currentSrc && !hasError"
    :src="currentSrc"
    :alt="alt"
    class="avatar-img"
    @error="handleError"
  >
</template>

<style scoped>
.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  display: block;
}
</style>
