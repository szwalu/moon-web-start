<script setup lang="ts">
import type { PropType } from 'vue'
import type { Site } from '@/types'
import { FAVICON_MAP_SYMBOL, getFaviconUrl } from '@/utils' // 确保 getFaviconUrl 指向 Google API

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
function createLetterFallback(reason?: string) {
  if (reason)
    console.log(`[Favicon] Site: "${props.site.name}", Reason: "${reason}", Creating letter fallback.`);
  else
    console.log(`[Favicon] Site: "${props.site.name}", Creating letter fallback.`);
    
  const fallbackDiv = document.createElement('div')
  fallbackDiv.innerText = props.site.name.toLocaleUpperCase().charAt(0)
  faviconMap.value.set(props.site.id, fallbackDiv)
  if ($faviconBox.value) {
    $faviconBox.value.innerHTML = ''
    $faviconBox.value.appendChild(fallbackDiv)
  }
}

function displayImage(imgElement: HTMLImageElement, source: string) {
  console.log(`[Favicon] Site: "${props.site.name}", Source: "${source}", Displaying image (${imgElement.naturalWidth}x${imgElement.naturalHeight}).`);
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
    $faviconBox.value?.appendChild(cachedElement)
    return
  }

  if (props.site.favicon) { // 优先使用用户自定义的 favicon
    const customImg = new Image()
    customImg.src = props.site.favicon
    customImg.onload = () => {
      if (customImg.naturalWidth <= 1) { // 对自定义图标也做个基本有效性检查
        createLetterFallback('Custom favicon too small')
      } else {
        displayImage(customImg, 'Custom Prop')
      }
    }
    customImg.onerror = () => createLetterFallback('Custom favicon load error')
    return
  }

  // --- 只使用 Google API 的逻辑 ---
  const googleApiUrl = getFaviconUrl(props.site.url) // getFaviconUrl 应指向 Google API，请求高清图标
  if (!googleApiUrl) {
    createLetterFallback('URL generation failed')
    return
  }

  const img = new Image()

  img.onload = () => {
    // 定义一个阈值，如果 Google 返回的图片宽度小于此值，我们认为是“无效”或“通用占位图”
    // Google 的通用地球图标通常是 16x16。一些低清但真实的图标也可能是 16x16 或稍大。
    // 你可以调整这个 32 来决定接受哪些低清图标。
    // 如果设为 16，那么 16x16 的真实图标和地球都会被拒绝。
    // 如果设为 32，那么 16x16 的真实图标和地球都会被拒绝，只有大于等于32x32的才显示。
    const MIN_ACCEPTABLE_WIDTH = 32; 

    if (img.naturalWidth < MIN_ACCEPTABLE_WIDTH) {
      createLetterFallback(`Google image too small (${img.naturalWidth}px), likely default or low quality`)
    }
    else {
      displayImage(img, 'Google')
    }
  }

  img.onerror = () => {
    createLetterFallback('Google image onerror')
  }

  console.log(`[Favicon] Site: "${props.site.name}", Attempting Google: ${googleApiUrl}`);
  img.src = googleApiUrl
})
</script>

<template>
  <div ref="$faviconBox" class="favicon" :style="[iconStyle, { width: `${size}px`, height: `${size}px`, fontSize: `${size / 2}px` }]" />
</template>

<style lang="scss">
/* Style部分保持不变 */
.favicon { img, div { width: 100%; height: 100%; } img { object-fit: contain; object-position: center; } div { display: flex; justify-content: center; align-items: center; color: #fff; background-color: var(--primary-c); transform: scale(1.12); border-radius: 50%; } }
</style>