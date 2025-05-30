<script setup lang="ts">
import type { PropType } from 'vue'
import type { Site } from '@/types'
import { FAVICON_MAP_SYMBOL } from '@/utils'

const props = defineProps({
  site: {
    type: Object as PropType<Site>,
    required: true,
  },
  size: {
    type: Number,
    default: 24,
  },
  round: {
    type: Boolean,
    default: false,
  },
})

const { iconStyle } = useIconStyle()

const faviconMap = inject<Ref<Map<number, HTMLImageElement | HTMLDivElement>>>(FAVICON_MAP_SYMBOL)!

const $faviconBox = ref<HTMLDivElement>()

// 封装创建首字母图标的函数
function createLetterFallback() {
  const fallbackDiv = document.createElement('div')
  fallbackDiv.innerText = props.site.name.toLocaleUpperCase().charAt(0)
  faviconMap.value.set(props.site.id, fallbackDiv)
  if ($faviconBox.value) {
    $faviconBox.value.innerHTML = ''
    $faviconBox.value.appendChild(fallbackDiv)
  }
}

onMounted(() => {
  const id = props.site.id
  const cachedElement = faviconMap.value.get(id)

  if (cachedElement) {
    $faviconBox.value?.appendChild(cachedElement)
    return
  }

  // 如果用户在数据中自定义了 favicon，逻辑保持不变
  if (props.site.favicon) {
    const img = new Image()
    img.src = props.site.favicon
    img.onload = () => {
      faviconMap.value.set(id, img)
      $faviconBox.value?.appendChild(img)
    }
    img.onerror = createLetterFallback
    return
  }

  // --- 使用 fetch API 的全新图标获取逻辑 ---
  let domain = ''
  try {
    domain = new URL(props.site.url).hostname
  }
  catch (e) {
    createLetterFallback()
    return
  }

  const highResSize = 128
  const googleUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=${highResSize}`

  fetch(googleUrl)
    .then((response) => {
      // 检查网络请求是否成功
      if (!response.ok)
        throw new Error('Network response was not ok.')

      // 获取文件大小。Content-Length 可能不存在，所以要做兼容处理
      const contentLength = response.headers.get('Content-Length')
      // 检查文件大小。如果文件非常小（比如小于500字节），我们有理由怀疑它是一个通用的占位图标
      if (contentLength && Number(contentLength) < 500)
        throw new Error('Favicon size is too small, likely a default icon.')

      return response.blob()
    })
    .then((blob) => {
      // 检查返回的文件类型，如果不是图片，也认为是失败
      if (!blob.type.startsWith('image/'))
        throw new Error('Response was not an image.')

      const img = new Image()
      const objectURL = URL.createObjectURL(blob)
      img.src = objectURL
      img.onload = () => {
        // 图片加载成功，显示并缓存
        faviconMap.value.set(id, img)
        if ($faviconBox.value) {
          $faviconBox.value.innerHTML = ''
          $faviconBox.value.appendChild(img)
        }
        // 释放内存
        URL.revokeObjectURL(objectURL)
      }
      img.onerror = () => {
        // 即使 blob 是图片，也可能因为某些原因无法在 img 标签中加载
        createLetterFallback()
        URL.revokeObjectURL(objectURL)
      }
    })
    .catch(() => {
      // 任何在 fetch 链中发生的错误，最终都会导向这里
      createLetterFallback()
    })
})
</script>

<template>
  <div ref="$faviconBox" class="favicon" :style="[iconStyle, { width: `${size}px`, height: `${size}px`, fontSize: `${size / 2}px` }]" />
</template>

<style lang="scss">
.favicon {
  img, div {
    width: 100%;
    height: 100%;
  }
  img {
    object-fit: contain;
    object-position: center;
  }
  div {
    display: flex;
    justify-content: center;
    align-items: center;
    color: #fff;
    background-color: var(--primary-c);
    transform: scale(1.12);
    border-radius: 50%;
  }
}
</style>
