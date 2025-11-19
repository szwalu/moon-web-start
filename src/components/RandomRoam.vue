<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDark } from '@vueuse/core'

interface Note {
  id: string
  content: string
  created_at: string
  title?: string | null
}

const props = defineProps<{
  /** 当前主页内存中的所有笔记（可能是多页合并后的） */
  notes: Note[]
  /** 主页是否还有更多页（auth.vue 的 hasMoreNotes） */
  hasMore: boolean
  /** 主页是否正在加载下一页（auth.vue 的 isLoadingNotes） */
  isLoading: boolean
}>()

const emit = defineEmits<{
  close: []
  /** 当随机池快不够用且还有更多页时，通知父组件去拉下一页 */
  needMore: []
}>()

const isDark = useDark()

// 一直维持一个“随机队列”，不再只看 20 条
const batchNotes = ref<Note[]>([])
const currentIndex = ref(0)

// 记录哪些 id 已经加入过随机队列，避免重复插入
const seenIds = ref<Set<string>>(new Set())
const initialized = ref(false)

// 拖动状态（移动端）
const startX = ref(0)
const deltaX = ref(0)
const isDragging = ref(false)

// 只在第一张卡片时展示“向右滑动”的提示
const showSwipeHint = ref(true)

// 预取阈值：剩余不足多少条时，会请求父组件拉更多
const PREFETCH_THRESHOLD = 10
const isRequestingMore = ref(false)

// ============ 随机池构建 & 补货 ============

function shuffleInPlace(arr: Note[]) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
}

function hydrateFromNotes(newNotes: Note[]) {
  if (!newNotes || newNotes.length === 0)
    return

  // 第一次：用全部 notes 做一次完整洗牌，作为初始随机队列
  if (!initialized.value) {
    const pool = [...newNotes]
    shuffleInPlace(pool)
    batchNotes.value = pool
    pool.forEach((n) => {
      seenIds.value.add(n.id)
    })
    initialized.value = true
    currentIndex.value = 0
    deltaX.value = 0
    showSwipeHint.value = true
    return
  }

  // 后续：只把“新出现”的笔记随机插入队列（插到当前 index 之后，避免插到已经看完的前面）
  const unseen = newNotes.filter(n => !seenIds.value.has(n.id))
  if (!unseen.length)
    return

  unseen.forEach((note) => {
    seenIds.value.add(note.id)

    const tailLength = Math.max(batchNotes.value.length - currentIndex.value, 0)
    const insertOffset = tailLength > 0 ? Math.floor(Math.random() * (tailLength + 1)) : 0
    const insertPos = currentIndex.value + insertOffset

    batchNotes.value.splice(insertPos, 0, note)
  })
}

// 监听父组件传进来的 notes：初始化 + 后续补货
watch(
  () => props.notes,
  (newVal) => {
    hydrateFromNotes(newVal || [])
    // 一旦有新数据进来，就说明一次补货完成，可以允许下一次请求
    isRequestingMore.value = false
  },
  { immediate: true, deep: true },
)

const visibleCards = computed(() => batchNotes.value.slice(currentIndex.value))

const hasMoreCards = computed(
  () => currentIndex.value < batchNotes.value.length - 1,
)

// 判断是否需要让父组件去拉下一页
function maybeRequestMore() {
  const remaining = batchNotes.value.length - currentIndex.value - 1
  if (remaining >= PREFETCH_THRESHOLD)
    return

  if (!props.hasMore)
    return
  if (props.isLoading)
    return
  if (isRequestingMore.value)
    return

  isRequestingMore.value = true
  emit('needMore')
}

// ============ 交互：滑动 / 点击切换 ============

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

function handleTouchEnd() {
  if (!isDragging.value)
    return
  isDragging.value = false

  const THRESHOLD = 80
  if (deltaX.value > THRESHOLD)
    goNextCard()

  deltaX.value = 0
}

function goNextCard() {
  if (hasMoreCards.value) {
    currentIndex.value += 1
    showSwipeHint.value = false // 一旦成功切到下一张，就不再显示提示
    maybeRequestMore()
  }
}

// 💻 桌面端：点击卡片切到下一张（仅当 index === 0）
function handleCardClick(index: number) {
  if (index !== 0)
    return

  const isDesktop = typeof window !== 'undefined' ? window.innerWidth >= 768 : false
  if (!isDesktop)
    return

  goNextCard()
}
</script>

<template>
  <div class="random-roam-page" :class="{ 'random-roam-page--dark': isDark }">
    <!-- 顶部栏：标题 + 返回按钮 -->
    <header class="random-roam-header">
      <button class="rr-back-btn" type="button" @click="emit('close')">
        ‹ 返回
      </button>
      <div class="rr-title">
        随机漫游
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
            <!-- 顶部紫色渐变区域（高度缩小） -->
            <div class="rr-card-img-placeholder">
              <span>📄</span>
            </div>

            <!-- 向右滑动 / 点击 提示：仅第一张卡、且 showSwipeHint 为 true 时显示 -->
            <div v-if="index === 0 && showSwipeHint" class="rr-swipe-hint">
              👉 {{
                (typeof window !== 'undefined' && window.innerWidth >= 768)
                  ? '点击卡片，浏览下一条'
                  : '向右滑动，浏览下一条'
              }}
            </div>

            <div class="rr-card-body">
              <div class="rr-card-date">
                {{ new Date(note.created_at).toLocaleString('zh-CN') }}
              </div>

              <!-- 有标题才显示；大部分没标题则整行不渲染 -->
              <div v-if="note.title" class="rr-card-title">
                {{ note.title }}
              </div>

              <!-- 正文区：字体稍大 & 内部可滚动 -->
              <div class="rr-card-content">
                {{ note.content }}
              </div>
            </div>
          </div>
        </template>

        <p v-else class="rr-empty">
          没有可用的笔记～
        </p>
      </div>
    </main>
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
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.random-roam-page--dark {
  background: #111827;
  color: #f9fafb;
}

/* 顶部更贴近屏幕边缘一点 */
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
  margin-right: 32px; /* 留出“返回”按钮占的空间 */
}

/* 主体：高度再拉长一点 */
.random-roam-main {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 4px 16px 0;
}

.card-stack {
  position: relative;
  width: 100%;
  max-width: 960px; /* 🧱 桌面端宽度显著加大；移动端自动变为 100% 宽 */
  height: 78vh;     /* 高一点，正文区域更大 */
  margin: 0 auto;
}

.rr-card {
  position: absolute;
  inset: 0;
  margin: auto;
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

/* 向右滑动 / 点击 提示 */
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

.rr-card-title {
  font-size: 16px;
  font-weight: 600;
}

/* 正文：略大字号 + 可滚动 */
.rr-card-content {
  flex: 1;
  font-size: 16px;
  line-height: 1.7;
  overflow-y: auto;
  padding-right: 4px;
  word-break: break-word;
}

.rr-empty {
  text-align: center;
  opacity: 0.6;
  margin-top: 40px;
}
</style>
