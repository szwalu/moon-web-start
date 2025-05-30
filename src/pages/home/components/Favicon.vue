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
    // 清空可能存在的失败的 img 元素
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

  // 如果用户在数据中自定义了 favicon，直接使用它
  if (props.site.favicon) {
    const img = new Image()
    img.src = props.site.favicon
    img.onload = () => {
      // 检查自定义图标是否有效
      if (img.naturalWidth < 16) { // 自定义图标尺寸也做个基本检查
        createLetterFallback()
      }
      else {
        faviconMap.value.set(id, img)
        $faviconBox.value?.appendChild(img)
      }
    }
    img.onerror = createLetterFallback // 自定义图标加载失败也显示首字母
    return
  }

  // --- 动态获取图标的核心逻辑 ---
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
  const fallbackUrl = `https://0x3.com/icon?host=${domain}`

  const img = new Image()

  img.onload = () => {
    // --- 最终的、更严格的尺寸检查 ---
    // 如果返回的图片宽度小于 32px，我们就认为它不是一个合格的高清图标
    if (img.naturalWidth < 32) {
      // 手动触发 onerror，启动备用方案
      img.onerror?.(new Event('error'))
    }
    else {
      // 图片有效，显示并缓存
      faviconMap.value.set(id, img)
      $faviconBox.value?.appendChild(img)
    }
  }

  img.onerror = () => {
    // 检查当前失败的是否是 Google API
    if (img.src === googleUrl) {
      // 尝试备用 API
      img.src = fallbackUrl
    }
    else {
      // 备用 API 也失败了，显示首字母
      createLetterFallback()
    }
  }

  // 首先尝试 Google API
  img.src = googleUrl
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
