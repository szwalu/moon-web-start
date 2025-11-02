<script setup lang="ts">
import { computed } from 'vue'
import type { PropType } from 'vue'
import Favicon from './Favicon.vue'
import type { Site, TagMode } from '@/types'
import { extractDomainFromUrl } from '@/utils'

defineProps({
  site: {
    type: Object as PropType<Site>,
    required: true,
  },
  type: {
    type: String as PropType<TagMode>,
    required: true,
  },
  isSetting: {
    type: Boolean,
    required: false,
  },
  isDragging: {
    type: Boolean,
    default: false,
  },
  target: {
    type: String,
    default: '_blank',
  },
})

// 在 PWA 独立模式下强制外链用 _blank，返回更稳（不触发站内路由或整页刷新）
const isStandalone
  = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  // 兼容旧 iOS
  // @ts-expect-error - iOS Safari 特性
  || (typeof navigator !== 'undefined' && navigator.standalone === true)

const effectiveTarget = computed(() => (isStandalone ? '_blank' : undefined))
</script>

<template>
  <a
    v-if="type === 'Concise'"
    class="site__handle"
    :class="{ 'site--setting': isSetting, 'hover:bg-$site-hover-c': !isDragging }"
    :href="site.url"
    :target="effectiveTarget ?? target"
    rel="noopener external nofollow"
    inline-flex cursor-pointer items-center gap-x-8 px-12 transition-300 h-40 max-w-100p
  >
    <Favicon class="shrink-0" :site="site" />
    <span whitespace-nowrap text-14 overflow-hidden>{{ site.name }}</span>
  </a>
  <a
    v-else
    class="site__handle"
    :class="{ 'site--setting': isSetting, 'hover:bg-$site-hover-c': !isDragging }"
    :href="site.url"
    :target="effectiveTarget ?? target"
    rel="noopener external nofollow"
    bg="white dark:dark-800"
    w-full inline-flex cursor-pointer items-center gap-x-8 transition-300 p-10
  >
    <Favicon class="shrink-0" :site="site" :size="36" round />
    <div>
      <div text-13 font-600 ellipsis-1>{{ site.name }}</div>
      <div text="13 $text-c-1" mt-6 ellipsis-1>{{ site.desc ?? extractDomainFromUrl(site.url) }}</div>
    </div>
  </a>
</template>

<style scoped>
.site__handle {
  /* 确保卡片有一个基础的阴影和圆角，这在'完全模式'下效果更佳 */
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);

  /* 核心：定义一个平滑过渡效果，让 transform 和 box-shadow 的变化在 0.25秒 内完成 */
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.site__handle:hover {
  /* 核心：当鼠标悬浮时，卡片向上移动4px */
  transform: translateY(-4px);

  /* 同时，阴影变得更深更明显，增强“浮起”的立体感 */
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.08);
}
</style>
