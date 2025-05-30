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
    $faviconBox.value?.appendChild(cachedElement)
  }
  else {
    const img = new Image()
    let domain = ''

    // 最终的备用方案：创建并显示首字母图标
    const createLetterFallback = () => {
      const fallbackDiv = document.createElement('div')
      fallbackDiv.innerText = props.site.name.toLocaleUpperCase().charAt(0)
      faviconMap.value.set(id, fallbackDiv)
      $faviconBox.value?.appendChild(fallbackDiv)
    }

    try {
      domain = new URL(props.site.url).hostname
    }
    catch (e) {
      console.error('Invalid URL:', props.site.url)
      createLetterFallback() // 如果网站 URL 无效，直接显示备用
      return
    }

    // 请求一个 128px 的高清图标，以确保在所有屏幕上都清晰
    const highResSize = 128
    const googleUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=${highResSize}`
    // 备用 API 不支持尺寸参数，清晰度可能无法保证
    const fallbackUrl = `https://0x3.com/icon?host=${domain}`

    // 定义图片加载失败后的操作
    img.onerror = () => {
      // 检查当前失败的是不是 Google API 地址
      if (img.src === googleUrl) {
        // 如果是，切换到备用 API 地址
        img.src = fallbackUrl
      }
      else {
        // 如果备用 API 地址也失败了，显示首字母
        createLetterFallback()
      }
    }

    // 定义图片加载成功后的操作 (增加尺寸判断)
    img.onload = () => {
      // 检查加载到的图片尺寸是否过小（比如 1x1 的空白图片）
      if (img.naturalWidth <= 1) {
        // 如果尺寸不正常，手动触发 onerror，启动备用方案
        img.onerror()
        return
      }
      // 如果尺寸正常，则显示图片
      faviconMap.value.set(id, img)
      $faviconBox.value?.appendChild(img)
    }

    // 开始加载：优先使用用户自定义的 favicon，如果没有，则尝试 Google API
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
