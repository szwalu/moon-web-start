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

onMounted(() => {
  const id = props.site.id
  const cachedElement = faviconMap.value.get(id)

  if (cachedElement) {
    // 1. 如果图标已经存在于缓存中，直接使用
    $faviconBox.value?.appendChild(cachedElement)
  }
  else {
    // 2. 如果没有缓存，则创建新的 Image 元素并开始加载
    const img = new Image()
    let domain = ''

    try {
      domain = new URL(props.site.url).hostname
    }
    catch (e) {
      // 如果网站 URL 无效，直接显示首字母备用图标
      console.error('Invalid URL:', props.site.url)
      const fallbackDiv = document.createElement('div')
      fallbackDiv.innerText = props.site.name.toLocaleUpperCase().charAt(0)
      faviconMap.value.set(id, fallbackDiv)
      $faviconBox.value?.appendChild(fallbackDiv)
      return // 结束执行
    }

    // 准备好主 API (Google) 和备用 API (0x3.com) 的地址
    const googleUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=${props.size}`
    const fallbackUrl = `https://0x3.com/icon?host=${domain}`

    // 3. 定义图片加载成功后的操作
    img.onload = () => {
      faviconMap.value.set(id, img)
      $faviconBox.value?.appendChild(img)
    }

    // 4. 定义图片加载失败后的操作 (核心修改)
    img.onerror = () => {
      // 检查当前失败的是不是 Google API 地址
      if (img.src === googleUrl) {
        // 如果是，说明是第一次加载失败，现在切换到备用 API 地址
        img.src = fallbackUrl
      }
      else {
        // 如果备用 API 地址也失败了，就彻底放弃，显示首字母备用图标
        const fallbackDiv = document.createElement('div')
        fallbackDiv.innerText = props.site.name.toLocaleUpperCase().charAt(0)
        faviconMap.value.set(id, fallbackDiv)
        $faviconBox.value?.appendChild(fallbackDiv)
      }
    }

    // 5. 开始加载：优先使用用户自定义的 favicon，如果没有，则尝试 Google API
    img.src = props.site.favicon || googleUrl
  }
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
