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

// 封装创建首字母图标的函数，方便复用
function createLetterFallback() {
  console.log(`[Favicon Debug] STEP 5: Creating letter fallback for: ${props.site.name}`)
  const fallbackDiv = document.createElement('div')
  fallbackDiv.innerText = props.site.name.toLocaleUpperCase().charAt(0)
  faviconMap.value.set(props.site.id, fallbackDiv)
  $faviconBox.value?.appendChild(fallbackDiv)
}

onMounted(() => {
  console.log(`[Favicon Debug] STEP 1: Component is mounting for site: "${props.site.name}"`)
  const id = props.site.id
  const cachedElement = faviconMap.value.get(id)

  if (cachedElement) {
    console.log(`[Favicon Debug] Found in cache. Exiting.`)
    $faviconBox.value?.appendChild(cachedElement)
    return
  }

  if (props.site.favicon) {
    console.log(`[Favicon Debug] Site has a custom favicon defined. Not fetching.`)
    // 此处可以添加对自定义 favicon 的加载逻辑，但暂时简化
    createLetterFallback()
    return
  }

  let domain = ''
  try {
    domain = new URL(props.site.url).hostname
  }
  catch (e) {
    console.error(`[Favicon Debug] Invalid URL, creating letter fallback.`)
    createLetterFallback()
    return
  }

  const highResSize = 128
  const googleUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=${highResSize}`
  const fallbackUrl = `https://0x3.com/icon?host=${domain}`

  const img = new Image()
  console.log(`[Favicon Debug] STEP 2: Attempting to load Google URL: ${googleUrl}`)

  img.onload = () => {
    console.log(`[Favicon Debug] STEP 3 (SUCCESS): 'onload' event triggered for: ${img.src}`)
    console.log(`[Favicon Debug] Image dimensions are: ${img.naturalWidth} x ${img.naturalHeight}`)
    if (img.naturalWidth < 2) {
      console.log(`[Favicon Debug] Image is too small. Treating as an error.`)
      img.onerror?.(new Event('error')) // 手动触发 onerror
    }
    else {
      console.log(`[Favicon Debug] Image is valid. Displaying icon.`)
      faviconMap.value.set(id, img)
      $faviconBox.value?.appendChild(img)
    }
  }

  img.onerror = () => {
    console.log(`[Favicon Debug] STEP 3 (FAILURE): 'onerror' event triggered for: ${img.src}`)
    if (img.src === googleUrl) {
      console.log(`[Favicon Debug] STEP 4: Google failed. Trying fallback URL: ${fallbackUrl}`)
      img.src = fallbackUrl
    }
    else {
      createLetterFallback()
    }
  }

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