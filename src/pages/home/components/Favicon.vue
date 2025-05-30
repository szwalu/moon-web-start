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
  faviconMap.value.set(props.site.id, fallbackDiv) // 仍然缓存结果，即使是首字母
  if ($faviconBox.value) {
    $faviconBox.value.innerHTML = ''
    $faviconBox.value.appendChild(fallbackDiv)
  }
}

function displayImage(imgElement: HTMLImageElement, source: string) {
  console.log(`[FaviconDebug] Site: "${props.site.name}", Source: "${source}", Displaying image (${imgElement.naturalWidth}x${imgElement.naturalHeight}).`);
  faviconMap.value.set(props.site.id, imgElement) // 缓存成功加载的图片
  if ($faviconBox.value) {
    $faviconBox.value.innerHTML = ''
    $faviconBox.value.appendChild(imgElement)
  }
}

onMounted(() => {
  console.log(`[FaviconDebug] STEP 1: Component is mounting for site: "${props.site.name}"`);
  const id = props.site.id
  
  // --- 临时修改：为了测试，我们暂时不从缓存读取 ---
  const cachedElement = null; // 将此行取消注释，并注释掉下面一行，来强制重新获取
  // const cachedElement = faviconMap.value.get(id); 
  console.log(`[FaviconDebug] Site: "${props.site.name}", Cache check bypassed for this test.`);
  // --- 临时修改结束 ---

  if (cachedElement) {
    // 这部分逻辑在本次测试中理论上不会被执行
    console.log(`[FaviconDebug] Site: "${props.site.name}", Found in cache (this log should not appear in test).`);
    $faviconBox.value?.appendChild(cachedElement)
    return
  }

  // 如果用户在数据中自定义了 favicon
  if (props.site.favicon) {
    console.log(`[FaviconDebug] Site: "${props.site.name}", Using custom favicon prop: ${props.site.favicon}`);
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

  const googleApiUrl = getFaviconUrl(props.site.url) 
  const duckDuckGoApiUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`

  if (!googleApiUrl) {
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
    const GOOGLE_MIN_ACCEPTABLE_WIDTH = 32 
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