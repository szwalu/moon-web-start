<script setup lang="ts">
import { computed, defineExpose, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { throttle } from 'lodash-es'
import { useI18n } from 'vue-i18n'
import NoteItem from '@/components/NoteItem.vue'
import NoteEditor from '@/components/NoteEditor.vue'

const props = defineProps({
  notes: { type: Array as () => any[], required: true },
  isLoading: { type: Boolean, default: false },
  hasMore: { type: Boolean, default: true },
  isSelectionModeActive: { type: Boolean, default: false },
  selectedNoteIds: { type: Array as () => string[], default: () => [] },
  allTags: { type: Array as () => string[], default: () => [] },
  maxNoteLength: { type: Number, default: 5000 },
  searchQuery: { type: String, default: '' },
})

const emit = defineEmits([
  'loadMore',
  'updateNote',
  'deleteNote',
  'pinNote',
  'copyNote',
  'taskToggle',
  'toggleSelect',
  'dateUpdated',
])

const { t } = useI18n()

// ====== DOM refs ======
const wrapperRef = ref<HTMLElement | null>(null)
const scrollerRef = ref<HTMLElement | null>(null)
const composerSlotRef = ref<HTMLElement | null>(null)

// ====== UI state ======
const expandedNote = ref<string | null>(null)
const editingNoteId = ref<string | null>(null)
const editingNoteContent = ref('')
const isUpdating = ref(false)

// 记录“展开瞬间”的锚点，用于收起时恢复
const expandAnchor = ref<{ noteId: string | null; topOffset: number; scrollTop: number }>({
  noteId: null,
  topOffset: 0,
  scrollTop: 0,
})

// 记录每个 Note 的容器元素
const noteContainers = ref<Record<string, HTMLElement>>({})
function setNoteContainer(el: Element | null, id: string) {
  if (!el)
    return
  const $el = el as HTMLElement
  $el.setAttribute('data-note-id', id)
  noteContainers.value[id] = $el
}

// ============== 月份头 + 悬浮月份条 ==============
interface MonthHeaderItem {
  type: 'month-header'
  id: string
  monthKey: string // "YYYY-MM"
  label: string // "YYYY年M月"
}
type MixedNoteItem = any & { type: 'note' }
type MixedItem = MonthHeaderItem | MixedNoteItem

function _isPinned(n: any) {
  return !!(n?.pinned || n?.is_pinned || n?.pinned_at)
}
function getMonthKeyAndLabel(note: any): { key: string; label: string } {
  const raw = note?.date || note?.created_at || note?.updated_at
  const d = raw ? new Date(raw) : new Date()
  const yyyy = d.getFullYear()
  const mm = d.getMonth() + 1
  const key = `${yyyy}-${String(mm).padStart(2, '0')}`
  const label = `${yyyy}年${mm}月`
  return { key, label }
}

// 生成混合列表：跳过置顶段，从第一条非置顶开始插入月份头
const mixedItems = computed<MixedItem[]>(() => {
  const out: MixedItem[] = []
  let lastKey = ''
  let inPinned = true
  for (const n of props.notes) {
    if (inPinned && !_isPinned(n)) {
      inPinned = false
      const { key, label } = getMonthKeyAndLabel(n)
      out.push({ type: 'month-header', id: `hdr-${key}`, monthKey: key, label })
      lastKey = key
      out.push({ ...n, type: 'note' })
      continue
    }
    if (inPinned) {
      out.push({ ...n, type: 'note' })
      continue
    }
    const { key, label } = getMonthKeyAndLabel(n)
    if (key !== lastKey) {
      out.push({ type: 'month-header', id: `hdr-${key}`, monthKey: key, label })
      lastKey = key
    }
    out.push({ ...n, type: 'note' })
  }
  return out
})

/** noteId -> 混合列表 index（滚动定位用） */
const noteIdToMixedIndex = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {}
  mixedItems.value.forEach((it, idx) => {
    if (it.type === 'note' && it.id)
      map[it.id] = idx
  })
  return map
})

/** id -> 原始笔记（向上滚兜底需要） */
const noteById = computed<Record<string, any>>(() => {
  const m: Record<string, any> = {}
  for (const n of props.notes) m[n.id] = n
  return m
})

// ——— 悬浮条当前月份 —— //
const HEADER_HEIGHT = 32
const headerEls = ref<Record<string, HTMLElement>>({})
let headersIO: IntersectionObserver | null = null

function setHeaderEl(el: Element | null, monthKey: string) {
  if (!el) {
    if (headerEls.value[monthKey])
      delete headerEls.value[monthKey]
    return
  }
  headerEls.value[monthKey] = el as HTMLElement
  if (headersIO)
    headersIO.observe(el)
}

const currentMonthKey = ref<string>('')
const currentMonthLabel = computed(() => {
  if (!currentMonthKey.value)
    return ''
  const [y, m] = currentMonthKey.value.split('-')
  return `${Number(y)}年${Number(m)}月`
})
const pushOffset = ref(0)

// 向上滚兜底：用视口内最靠上的“非置顶笔记”的月份纠正 currentMonthKey
function setCurrentByTopVisibleNote(rootEl: HTMLElement) {
  const scRect = rootEl.getBoundingClientRect()
  let topId: string | null = null
  let topY = Number.POSITIVE_INFINITY
  for (const [id, el] of Object.entries(noteContainers.value)) {
    if (!el || !el.isConnected)
      continue
    if (el.getAttribute('data-note-id') !== id)
      continue
    const n = noteById.value[id]
    if (!n || _isPinned(n))
      continue
    const r = el.getBoundingClientRect()
    const visible = !(r.bottom <= scRect.top || r.top >= scRect.bottom)
    if (!visible)
      continue
    if (r.top < topY) {
      topY = r.top
      topId = id
    }
  }
  if (topId) {
    const n = noteById.value[topId]
    const { key } = getMonthKeyAndLabel(n)
    if (key && currentMonthKey.value !== key)
      currentMonthKey.value = key
  }
}

// 让 .sticky-month 和 .month-header 宽度对齐（不遮住滚动条）
function syncStickyGutters() {
  const sc = scrollerRef.value
  const wrap = wrapperRef.value
  if (!sc || !wrap)
    return
  const cs = getComputedStyle(sc)
  const pl = Number.parseFloat(cs.paddingLeft) || 0
  const pr = Number.parseFloat(cs.paddingRight) || 0
  const scrollbarW = sc.offsetWidth - sc.clientWidth
  wrap.style.setProperty('--sticky-left', `${pl + 4}px`)
  wrap.style.setProperty('--sticky-right', `${pr + scrollbarW + 4}px`)
}

// 滚动方向，仅在向上滚时做兜底修正
let lastScrollTop = 0
const scrollDir = ref<'up' | 'down' | 'none'>('none')

function recomputeStickyState() {
  const root = scrollerRef.value as HTMLElement | null
  if (!root) {
    pushOffset.value = 0
    return
  }
  const rootTop = root.getBoundingClientRect().top
  const EPS = 1

  const entries = Object.entries(headerEls.value)
    .map(([k, el]) => (el && el.isConnected) ? { key: k, top: el.getBoundingClientRect().top } : null)
    .filter(Boolean)
    .sort((a: any, b: any) => a.top - b.top) as Array<{ key: string; top: number }>

  if (entries.length === 0) {
    if (scrollDir.value === 'up')
      setCurrentByTopVisibleNote(root)
    pushOffset.value = 0
    return
  }

  let idxPrev = -1
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].top <= rootTop + EPS)
      idxPrev = i
    else break
  }

  if (idxPrev >= 0) {
    if (currentMonthKey.value !== entries[idxPrev].key)
      currentMonthKey.value = entries[idxPrev].key
    const next = entries[idxPrev + 1]
    if (next) {
      const dist = next.top - rootTop
      const overlap = Math.max(0, HEADER_HEIGHT - dist)
      pushOffset.value = Math.min(HEADER_HEIGHT, overlap)
    }
    else {
      pushOffset.value = 0
    }
  }
  else {
    if (!currentMonthKey.value)
      currentMonthKey.value = entries[0].key
    const first = entries[0]
    const dist = first.top - rootTop
    const overlap = Math.max(0, HEADER_HEIGHT - dist)
    pushOffset.value = Math.min(HEADER_HEIGHT, overlap)
  }

  if (scrollDir.value === 'up')
    setCurrentByTopVisibleNote(root)
}

// ====== 滚动、加载更多 ======
const onPlainScroll = throttle(() => {
  const el = scrollerRef.value
  if (!el)
    return

  const curTop = el.scrollTop
  if (curTop > lastScrollTop)
    scrollDir.value = 'down'
  else if (curTop < lastScrollTop)
    scrollDir.value = 'up'
  lastScrollTop = curTop

  // 触底加载
  if (!props.isLoading && props.hasMore) {
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 300
    if (nearBottom)
      emit('loadMore')
  }

  // 同步悬浮月份条与布局
  recomputeStickyState()
  syncStickyGutters()
}, 16)

// ====== 观察底部哨兵自动加载 ======
const loadMoreSentinel = ref<HTMLElement | null>(null)
let loadIO: IntersectionObserver | null = null

onMounted(() => {
  // 窗口尺寸变更时校准
  window.addEventListener('resize', handleWindowResize, { passive: true })
  syncStickyGutters()

  const root = scrollerRef.value
  if (root) {
    headersIO = new IntersectionObserver(() => {
      recomputeStickyState()
    }, { root })
  }

  if (loadMoreSentinel.value) {
    loadIO = new IntersectionObserver((entries) => {
      const entry = entries[0]
      const rootEl = scrollerRef.value
      if (!rootEl)
        return
      if (entry && entry.isIntersecting && !props.isLoading && props.hasMore)
        emit('loadMore')
    }, { root, rootMargin: '400px 0px', threshold: 0 })
    loadIO.observe(loadMoreSentinel.value)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleWindowResize)
  onPlainScroll.cancel()
  if (headersIO) {
    headersIO.disconnect()
    headersIO = null
  }
  if (loadIO) {
    loadIO.disconnect()
    loadIO = null
  }
})

function handleWindowResize() {
  syncStickyGutters()
}

// ====== 编辑/保存 ======
function startEdit(note: any) {
  if (editingNoteId.value)
    cancelEdit()
  editingNoteId.value = note.id
  editingNoteContent.value = note.content
}

function cancelEdit() {
  editingNoteId.value = null
  editingNoteContent.value = ''
}

async function handleUpdateNote() {
  if (!editingNoteId.value)
    return
  isUpdating.value = true
  emit('updateNote', { id: editingNoteId.value, content: editingNoteContent.value }, (success: boolean) => {
    isUpdating.value = false
    if (success)
      cancelEdit()
  })
}

// ====== 展开/收起（仍保留展开逻辑） ======
async function toggleExpand(noteId: string) {
  if (editingNoteId.value === noteId)
    return

  const scroller = scrollerRef.value
  const isCurrentlyExpanded = expandedNote.value === noteId
  const isSwitching = expandedNote.value !== null && !isCurrentlyExpanded
  if (!scroller)
    return

  if (isSwitching) {
    expandedNote.value = null
    await nextTick()
    await new Promise(r => requestAnimationFrame(r as any))
  }

  if (!isCurrentlyExpanded) {
    const card = noteContainers.value[noteId]
    if (card) {
      const scRect = scroller.getBoundingClientRect()
      const cardRect = card.getBoundingClientRect()
      expandAnchor.value = { noteId, topOffset: cardRect.top - scRect.top, scrollTop: scroller.scrollTop }
    }
    else {
      expandAnchor.value = { noteId, topOffset: 0, scrollTop: scroller.scrollTop }
    }

    expandedNote.value = noteId
    await nextTick()
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(r)))

    const cardAfter = noteContainers.value[noteId]
    if (cardAfter) {
      scroller.style.overflowAnchor = 'none'
      const scRectAfter = scroller.getBoundingClientRect()
      const cardRectAfter = cardAfter.getBoundingClientRect()
      const topPadding = 0
      const deltaAlign = (cardRectAfter.top - scRectAfter.top) - topPadding
      const target = scroller.scrollTop + deltaAlign
      await stableSetScrollTop(scroller, target, 6, 0.5)
    }
  }
  else {
    expandedNote.value = null
    scroller.style.overflowAnchor = 'none'

    await nextTick()
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(r)))

    const cardAfter = noteContainers.value[noteId]
    if (cardAfter) {
      const scRectAfter = scroller.getBoundingClientRect()
      const cardRectAfter = cardAfter.getBoundingClientRect()
      const anchor = expandAnchor.value
      const wantTopOffset = anchor.noteId === noteId ? anchor.topOffset : 0
      const currentTopOffset = cardRectAfter.top - scRectAfter.top
      const delta = currentTopOffset - wantTopOffset

      let target = scroller.scrollTop + delta
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      if (target < 0)
        target = 0
      if (target > maxScrollTop)
        target = maxScrollTop

      await stableSetScrollTop(scroller, target, 6, 0.5)
    }
    expandAnchor.value = { noteId: null, topOffset: 0, scrollTop: scroller.scrollTop }
  }
}

async function stableSetScrollTop(el: HTMLElement, target: number, tries = 5, epsilon = 0.5) {
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
  if (target < 0)
    target = 0
  if (target > maxScroll)
    target = maxScroll
  return new Promise<void>((resolve) => {
    let count = 0
    const tick = () => {
      const diff = Math.abs(el.scrollTop - target)
      if (diff > epsilon)
        el.scrollTop = target
      count += 1
      const reached = Math.abs(el.scrollTop - target) <= epsilon
      if (count >= tries || reached) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    el.scrollTop = target
    requestAnimationFrame(tick)
  })
}

/** 将顶部 composer 区域滚到可视区顶部（考虑 sticky 顶部偏移与额外留白） */
async function scrollComposerIntoView(offset = 0) {
  const root = scrollerRef.value
  const el = composerSlotRef.value
  if (!root || !el)
    return
  // 目标位置 = 插槽相对滚动容器的 offsetTop - 需要空出来的顶部偏移
  const target = Math.max(0, el.offsetTop - offset)
  await stableSetScrollTop(root, target, 6, 0.5)
}

/** 对外暴露：回到顶部、滚到并编辑某条 */
async function focusAndEditNote(noteId: string) {
  const idx = noteIdToMixedIndex.value[noteId]
  if (idx === undefined)
    return
  const original = props.notes.find(n => n.id === noteId)
  if (!original)
    return
  editingNoteId.value = noteId
  editingNoteContent.value = original.content
  await nextTick()
  const root = scrollerRef.value
  const el = noteContainers.value[noteId]
  if (root && el) {
    const rootRect = root.getBoundingClientRect()
    const cardRect = el.getBoundingClientRect()
    const target = root.scrollTop + (cardRect.top - rootRect.top) - 40
    await stableSetScrollTop(root, target, 6, 0.5)
  }
}
function scrollToTop() {
  const root = scrollerRef.value
  if (root)
    root.scrollTop = 0
}
defineExpose({ scrollToTop, focusAndEditNote, scrollComposerIntoView })

// ====== 响应 notes 变化：校准悬浮条 ======
watch(() => props.notes, () => {
  nextTick(() => {
    syncStickyGutters()
    requestAnimationFrame(() => {
      recomputeStickyState()
    })
  })
}, { deep: false })
</script>

<template>
  <div ref="wrapperRef" class="notes-list-wrapper">
    <!-- 悬浮月份条 -->
    <div
      v-if="currentMonthLabel"
      class="sticky-month"
      :style="{ transform: `translateY(${-pushOffset}px)` }"
    >
      {{ currentMonthLabel }}
    </div>

    <div v-if="isLoading && notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.loading') }}
    </div>
    <div v-else-if="notes.length === 0 && false" class="py-4 text-center text-gray-500">
      {{ t('notes.no_notes') }}
    </div>

    <!-- 直滚容器（包含：外部传入的旧输入框 + 月份头 + 笔记项） -->
    <div
      v-else
      ref="scrollerRef"
      class="scroller"
      @scroll.passive="onPlainScroll"
    >
      <!-- 🔌 插槽：让父组件把“旧的输入框”插入到滚动容器顶部 -->
      <!-- 顶部输入框插槽：加一层容器以便滚动对齐 -->
      <div ref="composerSlotRef">
        <slot name="composer" />
      </div>

      <template v-for="item in mixedItems" :key="item.id">
        <!-- 月份头部条幅 -->
        <div
          v-if="item.type === 'month-header'"
          :ref="(el) => setHeaderEl(el, item.monthKey)"
          class="month-header"
          :data-month="item.monthKey"
        >
          {{ item.label }}
        </div>

        <!-- 笔记项 -->
        <div
          v-else
          :ref="(el) => setNoteContainer(el, item.id)"
          class="note-item-container"
        >
          <div
            class="note-selection-wrapper"
            :class="{ 'selection-mode': isSelectionModeActive }"
            @click.stop="isSelectionModeActive && emit('toggleSelect', item.id)"
          >
            <div v-if="isSelectionModeActive" class="selection-indicator">
              <div
                class="selection-circle"
                :class="{ selected: selectedNoteIds.includes(item.id) }"
              />
            </div>
            <div class="note-content-wrapper">
              <NoteItem
                v-if="editingNoteId !== item.id"
                :note="item"
                :is-expanded="expandedNote === item.id"
                :is-selection-mode-active="isSelectionModeActive"
                :search-query="searchQuery"
                @toggle-expand="toggleExpand"
                @edit="startEdit"
                @copy="(content) => emit('copyNote', content)"
                @pin="(note) => emit('pinNote', note)"
                @delete="(id) => emit('deleteNote', id)"
                @task-toggle="(payload) => emit('taskToggle', payload)"
                @date-updated="() => emit('dateUpdated')"
              />
              <template v-else>
                <NoteEditor
                  v-model="editingNoteContent"
                  :is-editing="true"
                  :is-loading="isUpdating"
                  :max-note-length="maxNoteLength"
                  :all-tags="allTags"
                  :placeholder="$t('notes.content_placeholder')"
                  @save="() => handleUpdateNote()"
                  @cancel="cancelEdit"
                  @focus.stop
                  @blur.stop
                />
              </template>
            </div>
          </div>
        </div>
      </template>

      <!-- 底部加载提示 -->
      <div v-if="isLoading && notes.length > 0" class="py-4 text-center text-gray-500">
        {{ t('notes.loading') }}
      </div>

      <!-- 加载更多哨兵（可选） -->
      <div ref="loadMoreSentinel" style="height: 1px" />
    </div>
  </div>
</template>

<style scoped>
.notes-list-wrapper { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }

/* 直滚容器：给顶部留出空间，不被 sticky bar 遮住 */
.scroller {
  height: 100%;
  overflow-y: auto;
  overflow-anchor: none;
  scroll-behavior: auto;
  background-color: #f9fafb;
  padding: 0.5rem;
  padding-top: 40px; /* 32 高度 + 一点间距，避免第一条被遮住 */
}
.dark .scroller { background-color: #111827; }

/* 卡片 */
.note-content-wrapper {
  background-color: #ffffff;
  border-radius: 12px;
  padding: 1rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.2s ease-in-out;
}
.note-content-wrapper:hover { box-shadow: 0 2px 4px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.07); }
.dark .note-content-wrapper {
  background-color: #1f2937;
  border: 1px solid #374151;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.1);
}
.dark .note-content-wrapper:hover { box-shadow: 0 2px 4px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.15); }

/* 间距与选择 */
.note-item-container { padding-bottom: 1.5rem; }
.note-item-container:last-child { padding-bottom: 0; }
.note-selection-wrapper { display: flex; gap: 0.75rem; transition: background-color 0.2s; }
.note-selection-wrapper.selection-mode {
  cursor: pointer;
  padding: 0.5rem;
  margin: -0.5rem -0.5rem calc(-0.5rem + 1.5rem) -0.5rem;
  border-radius: 8px;
}
.note-selection-wrapper.selection-mode:hover { background-color: rgba(0, 0, 0, 0.03); }
.dark .note-selection-wrapper.selection-mode:hover { background-color: rgba(255, 255, 255, 0.05); }
.note-content-wrapper { flex: 1; min-width: 0; }

/* 选择态圆点 */
.selection-indicator { padding-top: 0.75rem; }
.selection-circle {
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid #ccc; transition: all 0.2s ease;
}
.dark .selection-circle { border-color: #555; }
.selection-circle.selected { background-color: #00b386; border-color: #00b386; position: relative; }
.selection-circle.selected::after {
  content: '';
  position: absolute; left: 6px; top: 2px; width: 5px; height: 10px;
  border: solid white; border-width: 0 2px 2px 0; transform: rotate(45deg);
}

/* 文案颜色 */
.text-gray-500 { color: #6b7280; }
.dark .text-gray-500 { color: #9ca3af; }

/* ===== 月份头部项（直滚：所有 header 都在 DOM） ===== */
.month-header {
  height: 32px;
  padding: 0 8px;
  margin: 8px 4px 6px 4px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  color: #374151;
  background: #eef2ff;
  border: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
}
.dark .month-header {
  color: #e5e7eb;
  background: #1f2937;
  border: 1px solid #374151;
}

/* ===== 悬浮月份条（不参与虚拟化） ===== */
.sticky-month {
  position: absolute;
  top: 0;
  left: var(--sticky-left, 4px);
  right: var(--sticky-right, 4px);
  z-index: 9;
  height: 32px;
  padding: 0 8px;
  pointer-events: none;
  background: rgba(249, 250, 251, 0.9);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  border-bottom: 1px solid #e5e7eb;
  font-weight: 700;
  color: #111827;
  display: flex;
  align-items: center;
}
.dark .sticky-month {
  background: rgba(17, 24, 39, 0.9);
  border-bottom: 1px solid #374151;
  color: #f9fafb;
}
</style>
