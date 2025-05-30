// src/pages/home/components/Favicon.vue (使用原网站版本)
<script setup lang="ts">
import type { PropType } from 'vue'
import type { Site } from '@/types'

import { FAVICON_MAP_SYMBOL, getFaviconUrl } from '@/utils'

// 确保这里的 getFaviconUrl 是我们刚修改的

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
  const imgFromCache = faviconMap.value.get(id) // 修改变量名以示区分

  if (!imgFromCache) {
    const img = new Image()
    img.src = props.site.favicon || getFaviconUrl(props.site.url)
    img.onload = () => {
      if ($faviconBox.value) {
        $faviconBox.value.innerHTML = '' // 清理以防万一
        $faviconBox.value.appendChild(img)
      }
      faviconMap.value.set(id, img)
    }
    img.onerror = () => {
      const fallbackDiv = document.createElement('div')
      fallbackDiv.innerText = props.site.name.toLocaleUpperCase().charAt(0)
      faviconMap.value.set(id, fallbackDiv)
      if ($faviconBox.value) {
        $faviconBox.value.innerHTML = '' // 清理以防万一
        $faviconBox.value.appendChild(fallbackDiv)
      }
    }
  }
  else if (imgFromCache) {
    if ($faviconBox.value) {
      $faviconBox.value.innerHTML = '' // 清理以防万一
      $faviconBox.value.appendChild(imgFromCache)
    }
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
