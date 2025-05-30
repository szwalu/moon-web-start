// src/pages/home/components/Favicon.vue (最终推荐版，带可调阈值)
<script setup lang="ts">
import type { PropType } from 'vue'
import type { Site } from '@/types'

import { FAVICON_MAP_SYMBOL, getFaviconUrl } from '@/utils'

// 确保 getFaviconUrl 是上面推荐的 Google API 版本

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
      if (img.naturalWidth <= 4) { // 对自定义图标用一个较小的阈值
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
    // 核心判断：如果图片宽度小于等于这个阈值，认为是获取失败或质量太差
    const THRESHOLD = 16 // 你可以调整这个数字！
    if (img.naturalWidth <= THRESHOLD) {
      createLetterFallback()
    }
    else {
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
