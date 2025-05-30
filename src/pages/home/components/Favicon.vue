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
    $faviconBox.value.innerHTML = '' // 清空之前的尝试
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
      // 检查自定义图标是否有效，这里用一个比较小的阈值
      if (img.naturalWidth <= 4) { // 如果宽度小于等于4像素，认为是无效的
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

  const img = new Image()

  img.onload = () => {
    // 核心判断：如果图片宽度小于等于16像素，我们更有可能它是一个通用图标或质量非常低的图标
    // 你可以尝试调整这个 '16' 的值，比如改成 '20' 或 '24'，看看效果
    // 如果改成一个很小的值，比如 '2'，那么谷歌的地球图标就可能会显示出来
    if (img.naturalWidth <= 8) {
      createLetterFallback()
    }
    else {
      faviconMap.value.set(id, img)
      $faviconBox.value?.appendChild(img)
    }
  }

  img.onerror = () => {
    createLetterFallback()
  }

  img.src = googleUrl
})
</script>

<template>
  <div ref="$faviconBox" class="favicon" :style="[iconStyle, { width: `${size}px`, height: `${size}px`, fontSize: `${size / 2}px` }]" />
</template>

<style lang="scss">
/* Style部分保持不变 */
.favicon { img, div { width: 100%; height: 100%; } img { object-fit: contain; object-position: center; } div { display: flex; justify-content: center; align-items: center; color: #fff; background-color: var(--primary-c); transform: scale(1.12); border-radius: 50%; } }
</style>
