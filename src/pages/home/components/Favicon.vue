<script setup lang="ts">
import type { PropType } from 'vue'
import type { Site } from '@/types'
import { FAVICON_MAP_SYMBOL, getFaviconCandidates } from '@/utils'

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
  const cached = faviconMap.value.get(id)

  if (cached) {
    $faviconBox.value?.appendChild(cached)
    return
  }

  const sources = getFaviconCandidates(props.site.url)
  tryLoadFavicon(sources, 0, id)
})

function tryLoadFavicon(sources: string[], index: number, id: number) {
  if (index >= sources.length) {
    const fallback = document.createElement('div')
    fallback.innerText = props.site.name?.toLocaleUpperCase()?.charAt(0) || '?'
    faviconMap.value.set(id, fallback)
    $faviconBox.value?.appendChild(fallback)
    return
  }

  const src = `${sources[index]}?_=${Date.now()}`
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.referrerPolicy = 'no-referrer'
  img.src = src

  img.onload = () => {
    $faviconBox.value?.appendChild(img)
    faviconMap.value.set(id, img)
  }

  img.onerror = () => {
    tryLoadFavicon(sources, index + 1, id)
  }
}
</script>

<template>
  <div
    ref="$faviconBox"
    class="favicon"
    :style="[iconStyle, { width: `${size}px`, height: `${size}px`, fontSize: `${size / 2}px` }]"
  />
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
    font-weight: bold;
  }
}
</style>
