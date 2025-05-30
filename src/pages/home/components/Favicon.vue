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
      if (img.naturalWidth < 16) {
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

  // --- 最终简化的逻辑 ---
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

  // 成功加载后，检查图片尺寸是否合格
  img.onload = () => {
    if (img.naturalWidth < 32) {
      // 尺寸不合格，直接显示首字母
      createLetterFallback()
    }
    else {
      // 尺寸合格，显示图标
      faviconMap.value.set(id, img)
      $faviconBox.value?.appendChild(img)
    }
  }

  // 任何网络错误或加载失败，都直接显示首字母
  img.onerror = () => {
    createLetterFallback()
  }

  // 开始加载
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
