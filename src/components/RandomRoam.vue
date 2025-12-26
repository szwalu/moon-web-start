<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import ins from 'markdown-it-ins'
import mark from 'markdown-it-mark'
import linkAttrs from 'markdown-it-link-attributes'
import { cityMap, weatherMap } from '@/utils/weatherMap'
import { useSettingStore } from '@/stores/setting'

interface Note {
  id: string
  content: string
  created_at: string
  title?: string | null
  weather?: string | null
}

const props = defineProps<{
  notes: Note[]
  totalNotes: number
  hasMore: boolean
  isLoading: boolean
  loadMore: () => Promise<void> | void
  loadRandomBatch?: () => Promise<void> | void
  themeColor?: string
}>()
const emit = defineEmits<{
  close: []
}>()
const currentThemeColor = computed(() => props.themeColor || '#6366f1')
const isDark = useDark()
const { t, locale } = useI18n()
const settingsStore = useSettingStore()
const fontSizeClass = computed(() => `font-size-${settingsStore.noteFontSize}`)

// ✅ 计算当前是否为中文环境
const isZh = computed(() => {
  return locale.value.toLowerCase().startsWith('zh')
})

// ========== Markdown 渲染 ==========
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})
  .use(taskLists, { enabled: true, label: true })
  .use(mark)
  .use(ins)
  .use(linkAttrs, {
    attrs: {
      target: '_blank',
      rel: 'noopener noreferrer',
    },
  })

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('loading', 'lazy')
  tokens[idx].attrSet('decoding', 'async')
  const style = tokens[idx].attrGet('style')
  tokens[idx].attrSet('style', `${style ? `${style}; ` : ''}max-width:100%;height:auto;`)

  const imgHtml = self.renderToken(tokens, idx, options)
  const src = tokens[idx].attrGet('src') || ''
  const alt = tokens[idx].content || ''

  const prev = tokens[idx - 1]?.type
  const next = tokens[idx + 1]?.type
  const alreadyLinked = prev === 'link_open' && next === 'link_close'
  if (alreadyLinked)
    return imgHtml

  return `<a href="${src}" download target="_blank" rel="noopener noreferrer" title="${alt}">${imgHtml}</a>`
}

function renderMarkdown(content: string) {
  if (!content)
    return ''

  let html = md.render(content)

  // #标签 → 胶囊
  html = html.replace(
    /(?<!\w)#([^\s#.,?!;:"'()\[\]{}]+)/g,
    '<span class="custom-tag">#$1</span>',
  )

  return html
}

// ===== 日期 + 天气展示 =====

function formatDateWithWeekday(iso: string): string {
  if (!iso)
    return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime()))
    return ''

  return new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(d)
}

function getNoteWeather(note: Note | any): string {
  const raw = String(note?.weather ?? '').trim()
  if (!raw)
    return ''

  // --- 情况 A: 它是天气代码 (数字) ---
  const code = Number(raw)
  if (!Number.isNaN(code) && weatherMap[code]) {
    const info = weatherMap[code]
    if (isZh.value)
      return `${info.icon} ${info.text}`
    else
      return info.icon
  }

  // --- 情况 B: 它是城市名 (字符串) ---
  if (cityMap[raw]) {
    if (isZh.value)
      return cityMap[raw]
    else
      return raw
  }

  // --- 情况 C: 未知字符串 ---
  return isZh.value ? (t(raw) !== raw ? t(raw) : raw) : raw
}

// ========== 随机漫游核心逻辑 ==========

const STACK_SIZE = 20
const MAX_QUEUE_SIZE = 40

const deck = ref<Note[]>([])
let randomQueue: Note[] = []
let history: Note[] = []

const startX = ref(0)
const deltaX = ref(0)
const isDragging = ref(false)

const showSwipeHint = ref(true)
const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768

const isLoadingMore = ref(false)
const isRefreshingBatch = ref(false)
const slideCount = ref(0)

// 洗牌
function shuffle<T>(arr: T[]): T[] {
  const pool = [...arr]
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool
}

function buildCandidates(excludedIds: Set<string>): Note[] {
  const source = props.notes || []
  if (!source.length)
    return []
  const seen = new Set<string>()
  const result: Note[] = []
  for (const n of source) {
    if (!n || !n.id)
      continue
    if (excludedIds.has(n.id))
      continue
    if (seen.has(n.id))
      continue
    seen.add(n.id)
    result.push(n)
  }
  return result
}

async function ensureQueueFilled(excludedIds: Set<string>) {
  if (!randomQueue.length) {
    const candidates = buildCandidates(excludedIds)
    if (candidates.length)
      randomQueue = shuffle(candidates).slice(0, MAX_QUEUE_SIZE)
  }
}

async function getNextRandomNote(): Promise<Note | null> {
  const excluded = new Set(deck.value.map(n => n.id))
  await ensureQueueFilled(excluded)
  return randomQueue.shift() ?? null
}

// ===== 滑动手势 =====
const visibleCards = computed(() => deck.value)

function handleTouchStart(e: TouchEvent) {
  if (!visibleCards.value.length)
    return
  isDragging.value = true
  startX.value = e.touches[0]?.clientX ?? 0
  deltaX.value = 0
}

function handleTouchMove(e: TouchEvent) {
  if (!isDragging.value)
    return
  const x = e.touches[0]?.clientX ?? 0
  deltaX.value = x - startX.value
}

function goPrevCard() {
  if (!history.length)
    return
  const prev = history.pop()
  if (!prev)
    return

  const currentDeck = deck.value
  if (!currentDeck.length) {
    deck.value = [prev]
    return
  }

  const currentTop = currentDeck[0]
  const withoutPrev = currentDeck.filter(n => n.id !== prev.id)

  const existsInQueue = randomQueue.some(n => n.id === currentTop.id)
  if (!existsInQueue) {
    randomQueue.unshift(currentTop)
    if (randomQueue.length > MAX_QUEUE_SIZE)
      randomQueue.pop()
  }

  deck.value = [prev, ...withoutPrev.slice(1)]
}

function handleTouchEnd() {
  if (!isDragging.value)
    return
  isDragging.value = false

  const THRESHOLD = 80
  if (deltaX.value < -THRESHOLD)
    goNextCard()
  else if (deltaX.value > THRESHOLD)
    goPrevCard()

  deltaX.value = 0
}

function maybePreloadMore() {
  const totalLoaded = props.notes?.length ?? 0
  const canLoadMoreFromServer = props.hasMore && totalLoaded < props.totalNotes

  if (!canLoadMoreFromServer)
    return
  if (isLoadingMore.value || props.isLoading)
    return

  const SLIDE_INTERVAL = 40
  if (slideCount.value % SLIDE_INTERVAL !== 0)
    return

  const result = props.loadMore?.()
  if (result && typeof (result as any).then === 'function') {
    isLoadingMore.value = true
    ;(result as Promise<unknown>)
      .catch(() => {})
      .finally(() => {
        isLoadingMore.value = false
      })
  }
}

async function handleRefreshBatch() {
  if (!props.loadRandomBatch)
    return
  if (isRefreshingBatch.value)
    return

  isRefreshingBatch.value = true
  try {
    const result = props.loadRandomBatch()
    if (result && typeof (result as any).then === 'function')
      await (result as Promise<unknown>)

    initDeckFromNotes()
  }
  finally {
    isRefreshingBatch.value = false
  }
}

async function goNextCard() {
  if (!deck.value.length)
    return

  slideCount.value += 1

  const currentTop = deck.value[0]
  if (currentTop) {
    const lastHistory = history[history.length - 1]
    if (!lastHistory || lastHistory.id !== currentTop.id)
      history.push(currentTop)
  }

  const removed = deck.value.shift()!

  const next = await getNextRandomNote()
  if (next)
    deck.value.push(next)
  else
    deck.value.push(removed)

  showSwipeHint.value = false
  maybePreloadMore()
}

function handleCardClick(index: number) {
  if (!isDesktop)
    return
  if (index !== 0)
    return
  goNextCard()
}

function initDeckFromNotes() {
  const source = props.notes || []
  if (!source.length) {
    deck.value = []
    randomQueue = []
    history = []
    return
  }

  const total = source.length
  const maxStart = Math.max(0, total - STACK_SIZE)
  const startIndex = Math.floor(Math.random() * (maxStart + 1))

  const rotated = source.slice(startIndex).concat(source.slice(0, startIndex))
  const shuffled = shuffle(rotated)

  deck.value = shuffled.slice(0, STACK_SIZE)
  randomQueue = shuffled.slice(STACK_SIZE, STACK_SIZE + MAX_QUEUE_SIZE)

  history = []
  showSwipeHint.value = true
  deltaX.value = 0
  slideCount.value = 0
}

onMounted(() => {
  if (props.notes?.length)
    initDeckFromNotes()
})

watch(
  () => props.notes.length,
  (len, oldLen) => {
    if (!oldLen && len > 0 && deck.value.length === 0)
      initDeckFromNotes()
  },
)

// ✅ 计算卡片样式
// ✅ 计算卡片样式（优化版：更慢、更重、更优雅）
function getCardStyle(index: number) {
  // 1. 底部的卡片
  if (index > 0) {
    return {
      zIndex: visibleCards.value.length - index,
      // 底部卡片跟随移动一点点，制造景深联动感
      transform: `
        translate3d(${deltaX.value * 0.05}px, ${index * 4}px, -${index * 20}px) 
        scale(${1 - index * 0.04})
      `,
      opacity: index > 3 ? 0 : 1,
      // 底部卡片的动画也慢一点
      transition: 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.5s ease',
    }
  }

  // 2. 顶部的卡片（当前操作的这张）

  // 旋转系数降低：0.15 -> 0.1，让纸张看起来“硬”一点，不会弯得太夸张
  const rotateFactor = 0.1
  const rotateY = deltaX.value * rotateFactor

  // 位移系数：乘以 0.75，增加“阻尼感”，感觉纸张有分量
  const translateX = deltaX.value * 0.75

  return {
    zIndex: visibleCards.value.length,
    transform: `
      translate3d(${translateX}px, 0, 0) 
      rotateY(${rotateY}deg)
      rotateZ(${translateX * 0.03}deg)
    `,
    // 动态轴心：左滑掀页脚，右滑平推
    transformOrigin: deltaX.value < 0 ? '0% 100%' : '0% 50%',

    // ✋ 关键修改在这里：
    // isDragging 为 true (手指按着) -> 'none' (无延迟，绝对跟手)
    // isDragging 为 false (松手) -> '0.5s ...' (慢动作回弹/飞出，模拟空气阻力)
    transition: isDragging.value
      ? 'none'
      : 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)',

    cursor: isDragging.value ? 'grabbing' : 'grab',
  }
}
</script>

<template>
  <div
    class="random-roam-page"
    :class="{ 'random-roam-page--dark': isDark }"
    :style="{
      '--theme-color': currentThemeColor,
      '--theme-color-light': `color-mix(in srgb, ${currentThemeColor}, white 20%)`, // 浅一点
      '--theme-color-dark': `color-mix(in srgb, ${currentThemeColor}, black 10%)`, // 深一点
      '--theme-bg-gradient-1': currentThemeColor,
      '--theme-bg-gradient-2': `color-mix(in srgb, ${currentThemeColor}, white 40%)`, // 渐变色另一端
    }"
  >
    <header class="random-roam-header">
      <button class="rr-back-btn" type="button" @click="emit('close')">
        ‹ {{ t('notes.random_roam.back') }}
      </button>

      <div class="rr-title">
        {{ t('notes.random_roam.title') }}
      </div>
    </header>

    <main class="random-roam-main">
      <div
        class="card-stack"
        @touchstart.passive="handleTouchStart"
        @touchmove.passive="handleTouchMove"
        @touchend.passive="handleTouchEnd"
      >
        <template v-if="visibleCards.length">
          <div
            v-for="(note, index) in visibleCards"
            :key="note.id"
            class="rr-card"
            :class="{ 'rr-card--top': index === 0 }"
            :style="getCardStyle(index)"
            @click="handleCardClick(index)"
          >
            <div
              v-if="index === 0 && isDragging"
              class="rr-page-shadow"
              :style="{ opacity: Math.abs(deltaX) / 300 }"
            />

            <div class="rr-card-img-placeholder">
              <span>📄</span>
            </div>

            <div v-if="index === 0 && showSwipeHint" class="rr-swipe-hint">
              👉 {{
                isDesktop ? t('notes.random_roam.hint_desktop') : t('notes.random_roam.hint_mobile')
              }}
            </div>

            <div class="rr-card-body">
              <div class="rr-card-date-row">
                <div class="rr-card-date">
                  <span>{{ formatDateWithWeekday(note.created_at) }}</span>
                  <span v-if="getNoteWeather(note)" class="rr-card-weather">
                    · {{ getNoteWeather(note) }}
                  </span>
                </div>
              </div>

              <div v-if="note.title" class="rr-card-title">
                {{ note.title }}
              </div>

              <div
                class="rr-card-content prose dark:prose-invert max-w-none"
                :class="fontSizeClass"
                v-html="renderMarkdown(note.content)"
              />
            </div>
          </div>
        </template>

        <p v-else class="rr-empty">
          {{ t('notes.random_roam.empty') }}
        </p>
      </div>
    </main>

    <footer v-if="props.loadRandomBatch" class="random-roam-footer">
      <button
        class="rr-refresh-btn"
        type="button"
        :disabled="isRefreshingBatch"
        @click="handleRefreshBatch"
      >
        {{ t('notes.random_roam.refresh_batch') || '更新一批' }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.random-roam-page {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: #f5f5f5;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.random-roam-page--dark {
  background: #111827;
  color: #f9fafb;
}

.random-roam-header {
  height: 42px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  position: relative;
}

.rr-back-btn {
  border: none;
  background: none;
  font-size: 15px;
  padding: 2px 4px;
  cursor: pointer;
  color: inherit;
}

.rr-title {
  flex: 1;
  text-align: center;
  font-weight: 600;
  font-size: 17px;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
}

.random-roam-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: stretch;
}

.card-stack {
  position: relative;

  /* ✅ 移动端核心修改： */
  /* 1. 宽度 = 屏幕宽度 - 右边留出的 12px */
  width: calc(100% - 12px);

  /* 2. 强制靠左显示 (不要 auto 居中) */
  margin: 0;

  /* 限制最大宽度，高度占满 */
  max-width: 960px;
  height: 100%;

  /* 开启 3D 透视 */
  perspective: 1200px;
  transform-style: preserve-3d;
}

/* ✅ 桌面端适配 (宽度足够时恢复居中) */
@media (min-width: 768px) {
  .card-stack {
    /* 桌面端宽度占满容器 (受 max-width 限制) */
    width: 100%;
    /* 恢复居中 */
    margin: 0 auto;
  }
}

.rr-card {
  position: absolute;
  left: 0;
  right: 0;
  top: 4px;
  bottom: 4px;
  margin: 0 auto;
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.15);
  overflow: hidden;
  display: flex;
  flex-direction: column;

  transition: opacity 0.5s ease, box-shadow 0.5s ease;
  transform-origin: left center;
  backface-visibility: hidden;
  will-change: transform;
}

.random-roam-page--dark .rr-card {
  background: #111827;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.6);
  color: #e5e7eb;
}

.random-roam-footer {
  padding: 2px 16px 6px;
  display: flex;
  justify-content: center;
}

.rr-refresh-btn {
  border: none;
  background: var(--theme-color);
  color: #fff;
  font-size: 13px;
  padding: 10px 18px;
  border-radius: 999px;
  cursor: pointer;
  width: 100%;
  max-width: 960px;
  text-align: center;
}

.random-roam-page--dark .rr-refresh-btn {
  background: var(--theme-color-dark);
}

.rr-refresh-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.rr-card-img-placeholder {
  height: 90px;
  background: linear-gradient(135deg, var(--theme-bg-gradient-1), var(--theme-bg-gradient-2));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  color: rgba(255, 255, 255, 0.85);
}

.rr-swipe-hint {
  position: absolute;
  right: 12px;
  top: 100px;
  transform: translateY(-50%);
  background: rgba(15, 23, 42, 0.75);
  color: #f9fafb;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 999px;
}
.random-roam-page--dark .rr-swipe-hint {
  background: rgba(249, 250, 251, 0.9);
  color: #111827;
}

.rr-card-body {
  flex: 1;
  padding: 10px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.rr-card-date {
  font-size: 12px;
  opacity: 0.7;
}

.rr-card-date-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
}

.rr-card-weather {
  font-size: 12px;
  opacity: 0.8;
  white-space: nowrap;
}

.rr-card-title {
  font-size: 16px;
  font-weight: 600;
}

.rr-card-content {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
  word-break: break-word;
  line-height: 1.8;
  --tw-prose-links: #2563eb;
}

@media (min-width: 768px) {
  .rr-card-content {
    line-height: 2.2;
  }
}

.random-roam-page--dark .rr-card-content {
  --tw-prose-invert-links: #60a5fa;
}

.rr-card-content :deep(p) {
  margin-top: 0.85em;
  margin-bottom: 0.85em;
}
.rr-card-content :deep(p + p) {
  margin-top: 1.1em;
}
.rr-card-content :deep(ul),
.rr-card-content :deep(ol) {
  margin-top: 0.35em;
  margin-bottom: 0.35em;
  padding-left: 1.2em;
}

.rr-card-content :deep(:first-child) {
  margin-top: 0 !important;
}
.rr-card-content :deep(:last-child) {
  margin-bottom: 0 !important;
}

.rr-card-content :deep(.custom-tag) {
  background-color: color-mix(in srgb, var(--theme-color), white 90%);
  color: var(--theme-color);
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.875em;
  font-weight: 500;
  margin: 0 2px;
}
.random-roam-page--dark .rr-card-content :deep(.custom-tag) {
  background-color: color-mix(in srgb, var(--theme-color), black 80%);
  color: color-mix(in srgb, var(--theme-color), white 80%);
}

.rr-card-content :deep(a),
.rr-card-content :deep(a:visited) {
  color: #2563eb !important;
  text-decoration: underline !important;
}
.rr-card-content :deep(a:hover) {
  color: #1d4ed8 !important;
}
.random-roam-page--dark .rr-card-content :deep(a),
.random-roam-page--dark .rr-card-content :deep(a:visited) {
  color: #60a5fa !important;
}

.rr-card-content :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  object-fit: contain;
  border-radius: 6px;
  margin: 6px 0;
}

.rr-card-content :deep(li.task-list-item) {
  line-height: inherit;
  margin: 0;
  padding: 0;
}
.rr-card-content :deep(li.task-list-item > label) {
  display: inline;
  margin: 0;
  line-height: inherit;
}
.rr-card-content :deep(li.task-list-item input[type="checkbox"]) {
  vertical-align: middle;
  margin: 0 0.45em 0 0;
  line-height: 1;
  transform: translateY(-0.5px);
}
.rr-card-content :deep(li > p) {
  display: inline;
  margin: 0;
  line-height: inherit;
}

:deep(.prose.font-size-small) {
  font-size: 14px !important;
}
:deep(.prose.font-size-medium) {
  font-size: 17px !important;
}
:deep(.prose.font-size-large) {
  font-size: 20px !important;
}
:deep(.prose.font-size-extra-large) {
  font-size: 22px !important;
}

.rr-empty {
  text-align: center;
  opacity: 0.6;
  margin-top: 40px;
}

.rr-page-shadow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  border-radius: 18px;
  background: linear-gradient(to right, rgba(0,0,0,0), rgba(0,0,0,0.1) 80%, rgba(0,0,0,0.3));
  transition: opacity 0.1s linear;
}

.random-roam-page--dark .rr-page-shadow {
  background: linear-gradient(to right, rgba(0,0,0,0), rgba(0,0,0,0.5) 80%, rgba(0,0,0,0.8));
}

/* 第一层纸张边缘 (较浅, 较窄) */
.card-stack::before {
  content: '';
  position: absolute;
  /* 上下各缩进一点，模拟纸张错落感 */
  top: 3px;
  bottom: 3px;
  /* 定位到右侧外部 */
  right: -5px;
  /* 宽度不要太宽 */
  width: 6px;
  /* 颜色比卡片稍深一点的灰色 */
  background: #e5e7eb;
  /* 给个细边框增加层次感 */
  border: 1px solid #d1d5db;
  border-left: none; /* 左侧贴合卡片，不需要边框 */
  /* 右侧圆角，与卡片保持一致 */
  border-radius: 0 12px 12px 0;
  /* 放在卡片后面 */
  z-index: -1;
  /* 稍微增加一点点深度变换 */
  transform: translateZ(-2px);
}

/* 第二层纸张边缘 (更深, 更宽一点) */
.card-stack::after {
  content: '';
  position: absolute;
  /* 上下缩进更多一点 */
  top: 6px;
  bottom: 6px;
  /* 定位到更右侧 */
  right: -9px;
  /* 宽度 */
  width: 6px;
  /* 颜色更深一点 */
  background: #d1d5db;
  /* 边框 */
  border: 1px solid #9ca3af;
  border-left: none;
  /* 圆角 */
  border-radius: 0 12px 12px 0;
  /* 放在更后面 */
  z-index: -2;
  /* 深度变换 */
  transform: translateZ(-4px);
}

/* 暗色模式适配 */
.random-roam-page--dark .card-stack::before {
  background: #374151;
  border-color: #4b5563;
}
.random-roam-page--dark .card-stack::after {
  background: #1f2937;
  border-color: #374151;
}
</style>
