<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import ins from 'markdown-it-ins'
import mark from 'markdown-it-mark'
import linkAttrs from 'markdown-it-link-attributes'
import { useSettingStore } from '@/stores/setting'

interface Note {
  id: string
  content: string
  created_at: string
  title?: string | null
  weather?: string | null // ✅ 新增这一行
}

const props = defineProps<{
  notes: Note[]
  totalNotes: number
  hasMore: boolean
  isLoading: boolean
  loadMore: () => Promise<void> | void
  loadRandomBatch?: () => Promise<void> | void
}>()

const emit = defineEmits<{
  close: []
}>()

const isDark = useDark()
const { t } = useI18n()
const settingsStore = useSettingStore()
const fontSizeClass = computed(() => `font-size-${settingsStore.noteFontSize}`)

// ========== Markdown 渲染（沿用 NoteItem 的配置） ==========
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
const WEEKDAY_MAP_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function formatDateWithWeekday(iso: string): string {
  if (!iso)
    return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime()))
    return ''
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const w = WEEKDAY_MAP_ZH[d.getDay()] ?? ''
  return `${y}年${m}月${day}日 ${w}`
}

function getNoteWeather(note: Note | any): string {
  const w = String(note?.weather ?? '').trim()
  return w || ''
}

// ========== 随机漫游核心逻辑 ==========

// 同一时间卡堆里的数量
const STACK_SIZE = 20
// 随机队列的“预备库存”最大值：队列不会无限大，这样更容易轮到新加载的旧笔记
const MAX_QUEUE_SIZE = 40

const deck = ref<Note[]>([])
let randomQueue: Note[] = []
// 已看过的卡片历史，用于「向右滑上一条」
let history: Note[] = []

const startX = ref(0)
const deltaX = ref(0)
const isDragging = ref(false)

const showSwipeHint = ref(true)
const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768

const isLoadingMore = ref(false)
const isRefreshingBatch = ref(false)

// 统计滑动次数，用来决定何时后台预取下一页
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

// 从 props.notes 里构建候选池（排除当前卡堆里的 ID，去重）
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

// 确保随机队列有货：只负责“本地 notes → 队列”，不管后台
async function ensureQueueFilled(excludedIds: Set<string>) {
  if (!randomQueue.length) {
    const candidates = buildCandidates(excludedIds)
    if (candidates.length) {
      // 队列也只留一部分，避免一次把所有本地笔记塞完
      randomQueue = shuffle(candidates).slice(0, MAX_QUEUE_SIZE)
    }
  }
}

// 真正取下一条随机笔记（必要时会先补队列）
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

// 上一条逻辑（向右滑）
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

  // 先把 deck 里所有同一个 prev.id 的条目去掉，避免重复
  const withoutPrev = currentDeck.filter(n => n.id !== prev.id)

  // 当前这张放回队列头部，后面还有机会再被抽到
  const existsInQueue = randomQueue.some(n => n.id === currentTop.id)
  if (!existsInQueue) {
    randomQueue.unshift(currentTop)
    if (randomQueue.length > MAX_QUEUE_SIZE)
      randomQueue.pop()
  }

  // 把 prev 放到最上面，后面接原来的其它卡（去掉了 prev 本体）
  deck.value = [prev, ...withoutPrev.slice(1)]

  // 返回上一条就不要动 slideCount / 预取逻辑了
}

function handleTouchEnd() {
  if (!isDragging.value)
    return
  isDragging.value = false

  const THRESHOLD = 80
  // 向左滑（deltaX < 0）→ 下一条
  if (deltaX.value < -THRESHOLD)
    goNextCard()
  // 向右滑（deltaX > 0）→ 上一条
  else if (deltaX.value > THRESHOLD)
    goPrevCard()

  deltaX.value = 0
}

// ===== 每滑一张，顺便“后台默默补货” =====
function maybePreloadMore() {
  const totalLoaded = props.notes?.length ?? 0
  const canLoadMoreFromServer = props.hasMore && totalLoaded < props.totalNotes

  if (!canLoadMoreFromServer)
    return
  if (isLoadingMore.value || props.isLoading)
    return

  // 每滑 N 张预取一次，避免太频繁打 supabase
  const SLIDE_INTERVAL = 40
  if (slideCount.value % SLIDE_INTERVAL !== 0)
    return

  const result = props.loadMore?.()
  if (result && typeof (result as any).then === 'function') {
    isLoadingMore.value = true
    ;(result as Promise<unknown>)
      .catch(() => {
        // 忽略单次预取失败
      })
      .finally(() => {
        isLoadingMore.value = false
      })
  }
}

async function handleRefreshBatch() {
  // 父组件没传这个能力就不做
  if (!props.loadRandomBatch)
    return
  if (isRefreshingBatch.value)
    return

  isRefreshingBatch.value = true
  try {
    // 1）让父组件去 Supabase 随机拉一批（比如 60 条）
    const result = props.loadRandomBatch()
    if (result && typeof (result as any).then === 'function')
      await (result as Promise<unknown>)

    // 2）notes 在父组件里更新完以后，用最新的 notes 重新初始化卡堆
    initDeckFromNotes()
  }
  finally {
    isRefreshingBatch.value = false
  }
}

// 切到下一张卡片（向左滑 / 桌面点击）
async function goNextCard() {
  if (!deck.value.length)
    return

  slideCount.value += 1

  // 记录当前顶层卡片到历史栈（避免连续重复压入）
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

// 桌面端：点最上面一张也能切换（仍然视为“下一条”）
function handleCardClick(index: number) {
  if (!isDesktop)
    return
  if (index !== 0)
    return
  goNextCard()
}

// 初始化牌堆：采用“随机起点”来避免永远从最新的笔记开始
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

// notes 第一次有值时初始化
onMounted(() => {
  if (props.notes?.length)
    initDeckFromNotes()
})

// 如果原来没有 notes，后来父组件加载完了，再初始化一次
watch(
  () => props.notes.length,
  (len, oldLen) => {
    if (!oldLen && len > 0 && deck.value.length === 0)
      initDeckFromNotes()
  },
)
</script>

<template>
  <div class="random-roam-page" :class="{ 'random-roam-page--dark': isDark }">
    <!-- 顶部栏：标题 + 返回按钮 -->
    <header class="random-roam-header">
      <button class="rr-back-btn" type="button" @click="emit('close')">
        ‹ {{ t('notes.random_roam.back') }}
      </button>

      <div class="rr-title">
        {{ t('notes.random_roam.title') }}
      </div>
    </header>

    <!-- 卡片区域 -->
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
            :style="{
              zIndex: visibleCards.length - index,
              transform:
                index === 0
                  ? `translateX(${deltaX}px)`
                  : `translateY(${index * 4}px) scale(${1 - index * 0.02})`,
              opacity: index > 3 ? 0 : 1,
            }"
            @click="handleCardClick(index)"
          >
            <!-- 顶部紫色渐变区域 -->
            <div class="rr-card-img-placeholder">
              <span>📄</span>
            </div>

            <!-- 提示：仅第一张卡、且 showSwipeHint 为 true 时显示 -->
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

              <!-- 正文：Markdown + prose 样式 -->
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

    <!-- 底部：更新一批按钮，靠页面最下方 -->
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

  /* 挡住后台页面 */
  overflow: hidden;

  /* 底部 safe-area 只在最外层加一次 */
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.random-roam-page--dark {
  background: #111827;
  color: #f9fafb;
}

/* 顶部栏：左返回，中间标题 */
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

/* 标题：真正相对整个 header 水平居中 */
.rr-title {
  flex: 1;
  text-align: center;
  font-weight: 600;
  font-size: 17px;

  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none; /* 防止挡住返回按钮的点击区域 */
}

/* 主体区域：填满 header 和 footer 之间 */
.random-roam-main {
  flex: 1;
  overflow: hidden; /* 卡堆内部自己滚 */
  display: flex;
  justify-content: center;
  align-items: stretch;
}

/* 卡堆占满主体区域高度 */
.card-stack {
  position: relative;
  width: 100%;
  max-width: 960px;
  height: 100%;
  margin: 0 auto;
}

/* 卡片：上下只留一点点空隙，让高度更大、靠近底部按钮 */
.rr-card {
  position: absolute;
  left: 0;
  right: 0;
  top: 4px;         /* 卡片顶部距卡堆顶部 4px */
  bottom: 4px;      /* 卡片底部距卡堆底部 4px —— 调这个可以微调卡片高度 */
  margin: 0 auto;
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.15);
  overflow: hidden;
  transition: transform 0.25s ease, opacity 0.25s ease;
  display: flex;
  flex-direction: column;
}

.random-roam-page--dark .rr-card {
  background: #111827;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.6);
  color: #e5e7eb;
}

/* 底部“更新一批”区域：贴近卡片底部 */
.random-roam-footer {
  padding: 2px 16px 6px; /* 不再用 env(safe-area-inset-bottom)，避免重复叠加 */
  display: flex;
  justify-content: center;
}

/* “更新一批”按钮：占满内容宽度 */
.rr-refresh-btn {
  border: none;
  background: #6366f1;
  color: #fff;
  font-size: 13px;
  padding: 10px 18px;
  border-radius: 999px;
  cursor: pointer;

  width: 100%;
  max-width: 960px;     /* 和 card-stack 同宽 */
  text-align: center;
}

.random-roam-page--dark .rr-refresh-btn {
  background: #4f46e5;
}

.rr-refresh-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

/* 顶部紫色块 */
.rr-card-img-placeholder {
  height: 90px;
  background: linear-gradient(135deg, #6366f1, #a78bfa);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  color: rgba(255, 255, 255, 0.85);
}

/* 提示气泡 */
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
  min-height: 0; /* 让内部滚动生效 */
}

.rr-card-date {
  font-size: 12px;
  opacity: 0.7;
}

.rr-card-date-row {
  display: flex;
  align-items: center;
  justify-content: flex-start; /* 原来是 space-between */
  gap: 4px;                    /* 可以比原来的 8px 小一点 */
}

.rr-card-weather {
  font-size: 12px;
  opacity: 0.8;
  white-space: nowrap; /* 避免天气被换行挤下来 */
}

.rr-card-title {
  font-size: 16px;
  font-weight: 600;
}

/* ===== 正文：参考 NoteItem 的排版风格 ===== */

/* 容器自身的滚动 & 基础行距 */
/* 默认：移动端行距 1.8 */
.rr-card-content {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
  word-break: break-word;

  line-height: 1.8;

  --tw-prose-links: #2563eb;
}

/* 桌面端 ≥ 768px 行距 2.2 */
@media (min-width: 768px) {
  .rr-card-content {
    line-height: 2.2;
  }
}

.random-roam-page--dark .rr-card-content {
  /* 暗色模式链接色 */
  --tw-prose-invert-links: #60a5fa;
}

/* 段落 & 列表间距 */
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

/* 第一个/最后一个子元素收紧上下边距 */
.rr-card-content :deep(:first-child) {
  margin-top: 0 !important;
}
.rr-card-content :deep(:last-child) {
  margin-bottom: 0 !important;
}

/* 自定义 tag chip */
.rr-card-content :deep(.custom-tag) {
  background-color: #eef2ff;
  color: #4338ca;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.875em;
  font-weight: 500;
  margin: 0 2px;
}
.random-roam-page--dark .rr-card-content :deep(.custom-tag) {
  background-color: #312e81;
  color: #c7d2fe;
}

/* 链接颜色（与 NoteItem 保持一致） */
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

/* 图片自适应 */
.rr-card-content :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  object-fit: contain;
  border-radius: 6px;
  margin: 6px 0;
}

/* 任务列表细节（防止复选框撑高行距） */
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

/* 字号档位（和 NoteItem 保持同名） */
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
</style>
