<script setup lang="ts">
import type { PropType } from 'vue'
import type { Site } from '@/types'

import { FAVICON_MAP_SYMBOL, getFaviconUrl } from '@/utils'

// 确保 getFaviconUrl 是上面那个新版本

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

  if (props.site.favicon) {
    const img = new Image()
    img.src = props.site.favicon
    img.onload = () => {
      // 对自定义图标，我们只做一个非常宽松的检查
      if (img.naturalWidth <= 1) {
        createLetterFallback()
      }
      else {
        faviconMap.value.set(id, img)
        $faviconBox.value?.appendChild(img)
      }
    }
    img.onerror = createLetterFallback
    return
  }

  const iconUrl = getFaviconUrl(props.site.url)
  if (!iconUrl) {
    createLetterFallback()
    return
  }

  const img = new Image()

  img.onload = () => {
    // --- 核心判断：精确排除 16x16 的图标 ---
    if (img.naturalWidth === 16 && img.naturalHeight === 16) {
      // 如果从 Google API 获取到的是 16x16 的图标，我们判定为不想要的通用图标
      createLetterFallback()
    }
    else {
      // 其他所有尺寸（包括 15x16, 32x32, 64x64, 128x128 等）都认为是有效图标
      faviconMap.value.set(id, img)
      if ($faviconBox.value) {
        $faviconBox.value.innerHTML = ''
        $faviconBox.value.appendChild(img)
      }
    }
  }

  img.onerror = () => {
    createLetterFallback()
  }

  img.src = iconUrl
})
</script>

<template>
  <div ref="$faviconBox" class="favicon" :style="[iconStyle, { width: `${size}px`, height: `${size}px`, fontSize: `${size / 2}px` }]" />
</template>

<style lang="scss">
/* Style部分保持不变 */
.favicon { img, div { width: 100%; height: 100%; } img { object-fit: contain; object-position: center; } div { display: flex; justify-content: center; align-items: center; color: #fff; background-color: var(--primary-c); transform: scale(1.12); border-radius: 50%; } }
</style>
