<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDark } from '@vueuse/core'

interface Note {
  id: string
  content: string
  created_at: string
  title?: string | null
}

const props = defineProps<{
  notes: Note[]
}>()

const emit = defineEmits<{
  close: []
}>()

const isDark = useDark()

// 同一时间最多在 DOM 里的卡片数量
const STACK_SIZE = 20

// 当前牌堆（屏幕上那一叠）
const deck = ref<Note[]>([])

// 全局随机队列：从这里依次取下一张补到牌堆尾部
let randomQueue: Note[] = []

// 拖动状态（移动端）
const startX = ref(0)
const deltaX = ref(0)
const isDragging = ref(false)

// 只在第一张卡片时展示提示
const showSwipeHint = ref(true)

// 是否桌面端（用于提示文案 + 点击切卡）
const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768

// === 随机工具：Fisher–Yates 洗牌 ===
function shuffle<T>(arr: T[]): T[] {
  const pool = [...arr]
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool
}

// 重新填充 randomQueue：从所有笔记中选出不在 excludedIds 里的笔记并打乱
function refillRandomQueue(excludedIds: Set<string>) {
  const source = (props.notes || []).filter(note => !excludedIds.has(note.id))
  if (!source.length) {
    randomQueue = []
    return
  }
  randomQueue = shuffle(source)
}

// 初始化牌堆：打开随机漫游时调用
function initDeck() {
  // 当前没有任何排除，先把全集洗一遍
  randomQueue = shuffle(props.notes || [])

  const firstBatch: Note[] = []
  const usedIds = new Set<string>()

  while (firstBatch.length < STACK_SIZE && randomQueue.length) {
    const next = randomQueue.shift()!
    firstBatch.push(next)
    usedIds.add(next.id)
  }

  deck.value = firstBatch
  showSwipeHint.value = true
  deltaX.value = 0
}

// 从队列里取下一张卡片；如队列为空，则重建一轮
function getNextRandomNote(): Note | null {
  if (!randomQueue.length) {
    // 当前屏幕上已经有一叠卡片：重建队列时先排除这些 id，避免同时出现重复
    const excluded = new Set(deck.value.map(n => n.id))
    refillRandomQueue(excluded)
  }
  return randomQueue.shift() ?? null
}

// 计算当前要渲染的卡片（就是整個牌堆）
const visibleCards = computed(() => deck.value)

// 手势：开始拖动
function handleTouchStart(e: TouchEvent) {
  if (!visibleCards.value.length)
    return
  isDragging.value = true
  startX.value = e.touches[0]?.clientX ?? 0
  deltaX.value = 0
}

// 手势：移动
function handleTouchMove(e: TouchEvent) {
  if (!isDragging.value)
    return
  const x = e.touches[0]?.clientX ?? 0
  deltaX.value = x - startX.value
}

// 手势：结束
function handleTouchEnd() {
  if (!isDragging.value)
    return
  isDragging.value = false

  const THRESHOLD = 80
  if (deltaX.value > THRESHOLD)
    goNextCard()

  deltaX.value = 0
}

// 切到下一张卡片（核心逻辑）
function goNextCard() {
  if (!deck.value.length)
    return

  const removed = deck.value.shift() // 移除顶部卡片
  const next = getNextRandomNote()

  if (next) {
    deck.value.push(next)
  }
  else if (removed) {
    // 极端情况：只有一条笔记，就循环自己
    deck.value.push(removed)
  }

  showSwipeHint.value = false
}

// 💻 桌面端：点击顶层卡片切到下一张
function handleCardClick(index: number) {
  if (!isDesktop)
    return
  if (index !== 0)
    return
  goNextCard()
}

onMounted(() => {
  initDeck()
})
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
            <!-- 顶部紫色渐变区域 -->
            <div class="rr-card-img-placeholder">
              <span>📄</span>
            </div>

            <!-- 提示：仅第一张卡、且 showSwipeHint 为 true 时显示 -->
            <div v-if="index === 0 && showSwipeHint" class="rr-swipe-hint">
              👉 {{ isDesktop ? '点击卡片，浏览下一条' : '向右滑动，浏览下一条' }}
            </div>

            <div class="rr-card-body">
              <div class="rr-card-date">
                {{ new Date(note.created_at).toLocaleString('zh-CN') }}
              </div>

              <div v-if="note.title" class="rr-card-title">
                {{ note.title }}
              </div>

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
  max-width: 960px; /* 桌面端宽度显著加大；移动端 100% */
  height: 78vh;
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
  min-height: 0;
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
