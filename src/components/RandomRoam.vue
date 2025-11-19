<!-- src/components/RandomRoam.vue -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDark } from '@vueuse/core'

interface Note {
  id: string
  content: string
  created_at: string
  // 你有标题就加上：
  title?: string
}

const props = defineProps<{
  notes: Note[]
}>()

const emit = defineEmits<{
  close: []
}>()

const isDark = useDark()

const BATCH_SIZE = 20

const batchNotes = ref<Note[]>([])
const currentIndex = ref(0)

// 拖动状态
const startX = ref(0)
const deltaX = ref(0)
const isDragging = ref(false)

function pickRandomBatch() {
  const pool = [...props.notes]
  // 简单打乱
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  batchNotes.value = pool.slice(0, BATCH_SIZE)
  currentIndex.value = 0
}

const visibleCards = computed(() =>
  batchNotes.value.slice(currentIndex.value),
)

const hasMoreCards = computed(
  () => currentIndex.value < batchNotes.value.length - 1,
)

// 触摸开始
function handleTouchStart(e: TouchEvent) {
  if (!visibleCards.value.length)
    return
  isDragging.value = true
  startX.value = e.touches[0]?.clientX ?? 0
  deltaX.value = 0
}

// 触摸移动
function handleTouchMove(e: TouchEvent) {
  if (!isDragging.value)
    return
  const x = e.touches[0]?.clientX ?? 0
  deltaX.value = x - startX.value
}

// 触摸结束
function handleTouchEnd() {
  if (!isDragging.value)
    return
  isDragging.value = false

  const THRESHOLD = 80
  if (deltaX.value > THRESHOLD) {
    // 右滑成功，切下一张
    goNextCard()
  }
  // 不管成功与否，重置位移，触发回弹动画
  deltaX.value = 0
}

function goNextCard() {
  if (hasMoreCards.value)
    currentIndex.value += 1
}

function handleRefreshBatch() {
  pickRandomBatch()
}

onMounted(() => {
  pickRandomBatch()
})
</script>

<template>
  <div class="random-roam-page" :class="{ 'random-roam-page--dark': isDark }">
    <!-- 顶部栏 -->
    <header class="random-roam-header">
      <button class="rr-back-btn" type="button" @click="emit('close')">
        ‹
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
        <!-- 从上到下叠放 -->
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
              opacity: index > 3 ? 0 : 1, // 最多展示 4 张的层叠效果
            }"
          >
            <!-- 这里嵌你的 NoteItem 也行：<NoteItem :note="note" /> -->
            <div class="rr-card-img-placeholder">
              <!-- 以后可以放封面图，这里先占位 -->
              <span>📄</span>
            </div>
            <div class="rr-card-body">
              <div class="rr-card-date">
                {{ new Date(note.created_at).toLocaleString() }}
              </div>
              <div class="rr-card-title">
                {{ note.title || '无标题笔记' }}
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

    <!-- 底部按钮 -->
    <footer class="random-roam-footer">
      <button
        class="rr-refresh-btn"
        type="button"
        @click="handleRefreshBatch"
      >
        更新一批
      </button>
    </footer>
  </div>
</template>

<style scoped>
.random-roam-page {
  position: fixed;
  inset: 0;
  background: #f5f5f5;
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top, 0px);
}
.random-roam-page--dark {
  background: #111827;
  color: #f9fafb;
}

.random-roam-header {
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  position: relative;
}

.rr-back-btn {
  border: none;
  background: transparent;
  font-size: 24px;
  padding: 4px 8px;
}

.rr-title {
  flex: 1;
  text-align: center;
  font-weight: 600;
  font-size: 17px;
}

.random-roam-main {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px 16px 0;
}

.card-stack {
  position: relative;
  width: 100%;
  max-width: 360px;
  height: 70vh;
}

.rr-card {
  position: absolute;
  inset: 0;
  margin: auto;
  background: #fff;
  border-radius: 16px;
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

.rr-card-img-placeholder {
  height: 220px;
  background: linear-gradient(135deg, #6366f1, #a78bfa);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 42px;
  color: rgba(255, 255, 255, 0.85);
}

.rr-card-body {
  padding: 16px 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rr-card-date {
  font-size: 12px;
  opacity: 0.7;
}

.rr-card-title {
  font-size: 16px;
  font-weight: 600;
}

.rr-card-content {
  font-size: 14px;
  line-height: 1.5;
  max-height: 140px;
  overflow: hidden;
}

.rr-empty {
  text-align: center;
  opacity: 0.6;
  margin-top: 40px;
}

.random-roam-footer {
  padding: 8px 16px 16px;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}

.rr-refresh-btn {
  width: 100%;
  height: 44px;
  border-radius: 999px;
  border: none;
  font-size: 15px;
  font-weight: 500;
  background: #6366f1;
  color: #fff;
}
.random-roam-page--dark .rr-refresh-btn {
  background: #4f46e5;
}
</style>
