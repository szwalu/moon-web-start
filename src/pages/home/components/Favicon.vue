<script setup lang="ts">
import type { PropType } from 'vue'
import { nextTick, onMounted, ref } from 'vue'
import type { Site } from '@/types'
import { getHostname } from '@/utils'
import { faviconCache } from '@/utils/faviconCache'

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
  timeout: {
    type: Number,
    default: 1800, // 超时可以根据实际情况调整
  },
})

const { iconStyle } = useIconStyle()

const domainForAlt = ref('')
const imgSrcToAttempt = ref('') // 当前隐藏<img>尝试加载的URL
const finalDisplaySrc = ref('') // 最终确认可以显示的图片URL
const isLoading = ref(true) // 控制占位符，true直到第一次加载决策完成
const showLetterFallback = ref(false)
// visibleImageLoadError 不再需要，因为可见img的error会直接导致字母

let allFallbackSources: string[] = []
let currentAttemptIndex = 0
let imageLoadTimeoutId: number | null = null
let hasFinalDecision = false // 新增：标记是否已做出最终显示决定（成功图片或字母）

// console.count(`[Favicon ${props.site.id}] Instance`);
// watchEffect(() => { /* 日志 */ });

function generateCombinedFallbackSources(siteDomain: string, siteHostname: string) {
  const sizeParam = props.size > 32 ? 64 : 32
  const sources = [ // 确保这个列表是您期望的顺序和内容
    `/images/${siteDomain}.png`, // 本地优先
    props.site.favicon,
    `https://favicon.im/${siteHostname}`,
    `https://${siteDomain}/logo.svg`,
    `https://${siteDomain}/logo.png`,
    `https://${siteDomain}/apple-touch-icon.png`,
    `https://${siteDomain}/apple-touch-icon-precomposed.png`,
    `https://www.google.com/s2/favicons?domain=${siteDomain}&sz=${sizeParam}`,
    `https://0x3.com/icon?host=${siteDomain}`,
    `https://icons.duckduckgo.com/ip3/${siteDomain}.ico`,
    `https://${siteDomain}/favicon.ico`,
  ]
  // 过滤掉 props.site.favicon 可能产生的 null/undefined/空字符串
  return sources.filter(src => typeof src === 'string' && src.trim() !== '') as string[]
}

function clearCurrentTimeout() {
  if (imageLoadTimeoutId) {
    clearTimeout(imageLoadTimeoutId)
    imageLoadTimeoutId = null
  }
}

function setDisplayToLetter(isFinal: boolean = true) {
  if (hasFinalDecision && isFinal)
    return // 如果已做最终决定，不再更改为字母（除非是可见图片加载失败）
  // console.log(`[Favicon ACTION ${props.site.id}] Setting to LETTER for ${domainForAlt.value}`);

  clearCurrentTimeout() // 清除任何可能还在运行的超时
  isLoading.value = false
  finalDisplaySrc.value = ''
  imgSrcToAttempt.value = ''
  showLetterFallback.value = true
  if (isFinal)
    hasFinalDecision = true
  if (props.site?.id)
    faviconCache.set(props.site.id, 'LETTER')
}

function setDisplayToSuccess(successfulSrc: string) {
  if (hasFinalDecision)
    return // 如果已做最终决定，不再更改
  // console.log(`[Favicon ACTION ${props.site.id}] Setting to SUCCESS with src: ${successfulSrc}`);

  clearCurrentTimeout()
  isLoading.value = false
  finalDisplaySrc.value = successfulSrc
  imgSrcToAttempt.value = ''
  showLetterFallback.value = false
  hasFinalDecision = true // 作出最终决定
  if (props.site?.id)
    faviconCache.set(props.site.id, successfulSrc)
}

function handleHiddenImageLoad() {
  if (hasFinalDecision)
    return // 如果已做最终决定，忽略后续的load事件

  const currentSrcAttempt = imgSrcToAttempt.value
  // console.log(`[Favicon EVENT ${props.site.id}] Hidden img preliminary load for: ${currentSrcAttempt}`);
  clearCurrentTimeout()

  const imgChecker = new Image()
  imgChecker.onload = () => {
    if (hasFinalDecision && finalDisplaySrc.value === currentSrcAttempt)
      return // 防止成功后，imgChecker的onload再次触发
    const minValidDimension = 10
    if (imgChecker.naturalWidth >= minValidDimension && imgChecker.naturalHeight >= minValidDimension)
      setDisplayToSuccess(currentSrcAttempt)
    else
      handleHiddenImageError('invalid_dimensions_after_load')
  }
  imgChecker.onerror = () => {
    handleHiddenImageError('img_checker_error')
  }
  imgChecker.src = currentSrcAttempt
}

function handleHiddenImageError(_reason: string = 'network_error') {
  if (hasFinalDecision)
    return // 如果已做最终决定，忽略后续的error事件

  // console.warn(`[Favicon EVENT ${props.site.id}] Hidden img error ('${_reason}') for: ${imgSrcToAttempt.value} (index ${currentAttemptIndex})`);
  clearCurrentTimeout()
  currentAttemptIndex++
  imgSrcToAttempt.value = ''
  nextTick(() => {
    tryNextSourceInChain()
  })
}

function tryNextSourceInChain() {
  if (hasFinalDecision)
    return // 如果已做最终决定，停止尝试

  clearCurrentTimeout()
  finalDisplaySrc.value = ''
  showLetterFallback.value = false

  if (currentAttemptIndex < allFallbackSources.length) {
    isLoading.value = true
    const attemptUrl = allFallbackSources[currentAttemptIndex]

    imgSrcToAttempt.value = ''
    nextTick(() => {
      imgSrcToAttempt.value = attemptUrl
      // console.log(`[Favicon ACTION ${props.site.id}] Hidden img attempting: ${imgSrcToAttempt.value} (Index: ${currentAttemptIndex})`);
    })

    imageLoadTimeoutId = window.setTimeout(() => {
      if (imgSrcToAttempt.value === attemptUrl && !hasFinalDecision) { // 确保超时对应当前尝试且未做最终决定
        // console.warn(`[Favicon EVENT ${props.site.id}] Timeout for hidden img: ${imgSrcToAttempt.value}`);
        handleHiddenImageError('timeout')
      }
    }, props.timeout)
  }
  else {
    // console.error(`[Favicon ACTION ${props.site.id}] All fallbacks in chain FAILED for ${domainForAlt.value}.`);
    setDisplayToLetter() // 这是最终的失败决定
  }
}

// 由可见的 <img> 的 @error 事件触发
function handleVisibleImageError() {
  // console.warn(`[Favicon VISIBLE IMG ERROR ${props.site.id}] for: ${finalDisplaySrc.value}. Forcing letter.`);
  // 如果可见图片加载失败（即使隐藏的加载器认为它是好的），立即显示字母，这是最终决定
  setDisplayToLetter(true) // isFinal = true
}

function initializeFavicon() {
  // console.count(`[Favicon INIT ${props.site.id}]`);
  hasFinalDecision = false // 重置最终决定标记
  currentAttemptIndex = 0
  allFallbackSources = []
  imgSrcToAttempt.value = ''
  finalDisplaySrc.value = ''
  isLoading.value = true
  showLetterFallback.value = false
  clearCurrentTimeout()

  if (props.site?.url)
    domainForAlt.value = getHostname(props.site.url) || props.site.name || ''
  else
    domainForAlt.value = props.site?.name || ''

  if (!props.site?.id) {
    setDisplayToLetter()
    return
  }

  const cachedStatus = faviconCache.get(props.site.id)
  if (cachedStatus) {
    isLoading.value = false // 有缓存，不需要初始占位符
    if (cachedStatus === 'LETTER') {
      setDisplayToLetter(false) // isFinal=false,因为这只是从缓存恢复，可能之后会变
    }
    else {
      finalDisplaySrc.value = cachedStatus
      showLetterFallback.value = false // 确保字母不高亮
      hasFinalDecision = true // 从缓存中成功恢复图片，视为最终决定
    }
    return
  }

  const siteDomain = getHostname(props.site.url || '')
  const siteHostname = getHostname(props.site.url || '')

  allFallbackSources = generateCombinedFallbackSources(siteDomain, siteHostname)

  if (allFallbackSources.length === 0) {
    setDisplayToLetter()
    return
  }

  tryNextSourceInChain()
}

onMounted(() => {
  initializeFavicon()
})

// 暂时注释掉 watch，以确保单次加载的稳定性
// watch(() => props.site?.id, (newId, oldId) => {
//   if (newId !== oldId && newId !== undefined) {
//     initializeFavicon();
//   }
// }, { immediate: false });
</script>

<template>
  <div
    class="favicon-wrapper"
    :style="[
      iconStyle,
      {
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: round ? '50%' : '4px',
      },
    ]"
  >
    <div v-if="isLoading && !finalDisplaySrc && !showLetterFallback" class="favicon-placeholder animate-pulse">
      <div class="placeholder-inner" />
    </div>
    <img
      v-else-if="finalDisplaySrc"
      :key="finalDisplaySrc"
      :src="finalDisplaySrc"
      :alt="`${domainForAlt || site.name} logo`"
      class="favicon-img"
      loading="lazy"
      @error="handleVisibleImageError"
    >
    <div
      v-else-if="showLetterFallback"
      class="favicon-letter-fallback"
      :style="{ fontSize: `${size * 0.6}px` }"
    >
      {{ site.name ? site.name.toLocaleUpperCase().charAt(0) : '?' }}
    </div>
    <div v-else class="favicon-empty-state" />
  </div>

  <img
    v-if="imgSrcToAttempt && isLoading && !hasFinalDecision"
    :key="imgSrcToAttempt"
    :src="imgSrcToAttempt"
    style="display: none !important;"
    alt="loader"
    @load="handleHiddenImageLoad"
    @error="handleHiddenImageError('network_error')"
  >
</template>

<style lang="scss" scoped>
/* 样式与上一版保持一致 */
.favicon-wrapper {
  position: relative; display: inline-block; overflow: hidden;
  vertical-align: middle; box-sizing: border-box;
  background-color: transparent;
}
.favicon-placeholder {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  border-radius: inherit;
  .placeholder-inner {
    width: 100%; height: 100%; border-radius: inherit; background-color: rgba(209, 213, 219, 0.6);
  }
}
.favicon-img {
  width: 100%; height: 100%; object-fit: contain; object-position: center; display: block;
  background-color: transparent;
  border-radius: inherit;
}
.favicon-letter-fallback {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  color: #fff;
  background-color: var(--primary-c);
  font-weight: bold;
  border-radius: inherit;
}
.favicon-empty-state {
  width: 100%; height: 100%;
  border-radius: inherit;
}
</style>
