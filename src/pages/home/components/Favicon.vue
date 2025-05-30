<script setup lang="ts">
import type { PropType } from 'vue'
import type { Site } from '@/types'
import { FAVICON_MAP_SYMBOL, getFaviconUrl } from '@/utils'

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

function createLetterFallback(reason: string) {
  console.log(`[FaviconDebug] Site: "${props.site.name}", Reason: "${reason}", Creating letter fallback.`);
  const fallbackDiv = document.createElement('div')
  fallbackDiv.innerText = props.site.name.toLocaleUpperCase().charAt(0)
  faviconMap.value.set(props.site.id, fallbackDiv)
  if ($faviconBox.value) {
    $faviconBox.value.innerHTML = ''
    $faviconBox.value.appendChild(fallbackDiv)
  }
}

function displayImage(imgElement: HTMLImageElement, source: string) {
  console.log(`[FaviconDebug] Site: "${props.site.name}", Source: "${source}", Displaying image (${imgElement.naturalWidth}x${imgElement.naturalHeight}).`);
  faviconMap.value.set(props.site.id, imgElement)
  if ($faviconBox.value) {
    $faviconBox.value.innerHTML = ''
    $faviconBox.value.appendChild(imgElement)
  }
}

onMounted(() => {
  const id = props.site.id
  const cachedElement = faviconMap.value.get(id)

  if (cachedElement) {
    console.log(`[FaviconDebug] Site: "${props.site.name}", Found in cache.`);
    $faviconBox.value?.appendChild(cachedElement)
    return
  }

  if (props.site.favicon) {
    const customImg = new Image()
    customImg.src = props.site.favicon
    customImg.onload = () => {
      if (customImg.naturalWidth <= 1) {
        createLetterFallback('Custom favicon too small')
      } else {
        displayImage(customImg, 'Custom Prop')
      }
    }
    customImg.onerror = () => createLetterFallback('Custom favicon load error')
    return
  }

  let domain = ''
  try {
    domain = new URL(props.site.url).hostname
  }
  catch (e) {
    createLetterFallback('Invalid site URL')
    return
  }

  const googleApiUrl = getFaviconUrl(props.site.url) // Uses sz=128 from favicon.ts
  const duckDuckGoApiUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`

  if (!googleApiUrl) { // Should not happen if domain is valid
    createLetterFallback('Google URL generation failed')
    return
  }

  const primaryImg = new Image()

  const attemptDuckDuckGo = () => {
    console.log(`[FaviconDebug] Site: "${props.site.name}", Attempting DuckDuckGo: ${duckDuckGoApiUrl}`);
    fetch(duckDuckGoApiUrl)
      .then((response) => {
        if (!response.ok)
          throw new Error('DuckDuckGo network response not OK')

        const contentType = response.headers.get('Content-Type')
        console.log(`[FaviconDebug] Site: "${props.site.name}", DuckDuckGo Content-Type: "${contentType}"`);

        if (contentType && contentType.includes('image/png')) {
          // 根据你的观察，DDG 返回 PNG 时是它的通用占位符
          throw new Error('DuckDuckGo returned PNG (likely placeholder)')
        }
        return response.blob()
      })
      .then((blob) => {
        if (!blob.type.startsWith('image/'))
          throw new Error('DuckDuckGo blob is not an image')

        const ddgImg = new Image()
        const objectURL = URL.createObjectURL(blob)
        ddgImg.onload = () => {
          URL.revokeObjectURL(objectURL)
          // 只要 DDG 返回的不是 PNG，我们就尝试显示它
          // 不再对DDG返回的ICO做严格的尺寸判断，因为ICO本身可能就包含低清的真实图标
          if (ddgImg.naturalWidth > 1) {
             displayImage(ddgImg, 'DuckDuckGo')
          } else {
            createLetterFallback('DuckDuckGo image too small (after blob load)')
          }
        }
        ddgImg.onerror = () => {
          URL.revokeObjectURL(objectURL)
          createLetterFallback('DuckDuckGo image load error from blob')
        }
        ddgImg.src = objectURL
      })
      .catch((error) => {
        console.error(`[FaviconDebug] Site: "${props.site.name}", DuckDuckGo attempt failed:`, error);
        createLetterFallback('DuckDuckGo fetch/processing error')
      })
  }

  primaryImg.onload = () => {
    const GOOGLE_MIN_ACCEPTABLE_WIDTH = 32 // 如果Google返回的图片宽度小于此值，我们认为它质量不高
    console.log(`[FaviconDebug] Site: "${props.site.name}", Google onload. Dimensions: ${primaryImg.naturalWidth}x${primaryImg.naturalHeight}`);
    if (primaryImg.naturalWidth < GOOGLE_MIN_ACCEPTABLE_WIDTH) {
      attemptDuckDuckGo()
    }
    else {
      displayImage(primaryImg, 'Google')
    }
  }

  primaryImg.onerror = () => {
    console.log(`[FaviconDebug] Site: "${props.site.name}", Google onerror. Attempting DuckDuckGo.`);
    attemptDuckDuckGo()
  }

  console.log(`[FaviconDebug] Site: "${props.site.name}", Attempting Google: ${googleApiUrl}`);
  primaryImg.src = googleApiUrl
})
</script>

<template>
  <div ref="$faviconBox" class="favicon" :style="[iconStyle, { width: `${size}px`, height: `${size}px`, fontSize: `${size / 2}px` }]" />
</template>

<style lang="scss">
/* Style部分保持不变 */
.favicon { img, div { width: 100%; height: 100%; } img { object-fit: contain; object-position: center; } div { display: flex; justify-content: center; align-items: center; color: #fff; background-color: var(--primary-c); transform: scale(1.12); border-radius: 50%; } }
</style>