<script setup lang="ts">
import { computed, defineExpose, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { throttle } from 'lodash-es'
import { useI18n } from 'vue-i18n'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
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

// 记录“展开瞬间”的锚点，用于收起时恢复
const expandAnchor = ref<{ noteId: string | null; topOffset: number; scrollTop: number }>({
  noteId: null,
  topOffset: 0,
  scrollTop: 0,
})

const { t } = useI18n()

const scrollerRef = ref<any>(null)
const wrapperRef = ref<HTMLElement | null>(null)
const collapseBtnRef = ref<HTMLElement | null>(null)
const collapseVisible = ref(false)
const collapseStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' })

const expandedNote = ref<string | null>(null)
const editingNoteId = ref<string | null>(null)
const editingNoteContent = ref('')
const isUpdating = ref(false)

// 记录每条笔记的容器 DOM，用于定位与可见性判断
const noteContainers = ref<Record<string, HTMLElement>>({})

// ---- :ref 助手（注意：要处理卸载 null，避免“幽灵节点”）----
function setNoteContainer(el: Element | null, id: string) {
  if (!el) {
    delete noteContainers.value[id]
    return
  }
  const $el = el as HTMLElement
  $el.setAttribute('data-note-id', id)
  noteContainers.value[id] = $el
}

// ==============================
// 月份头部（虚拟项）+ 悬浮月份条
// ==============================

interface MonthHeaderItem {
  type: 'month-header'
  id: string
  monthKey: string // "YYYY-MM"
  label: string // "YYYY年M月"
}
type MixedNoteItem = any & { type: 'note' }
type MixedItem = MonthHeaderItem | MixedNoteItem

function getMonthKeyAndLabel(note: any): { key: string; label: string } {
  const raw = note?.date || note?.created_at || note?.updated_at
  const d = raw ? new Date(raw) : new Date()
  const yyyy = d.getFullYear()
  const mm = d.getMonth() + 1
  const key = `${yyyy}-${String(mm).padStart(2, '0')}`
  const label = `${yyyy}年${mm}月`
  return { key, label }
}

/** 置顶判断（自适配常见字段） */
function _isPinned(n: any) {
  return !!(n?.pinned || n?.is_pinned || n?.pinned_at)
}

/** 跳过置顶段，从第一条非置顶开始插入月份头 */
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

const HEADER_HEIGHT = 32 // 与样式一致
const headerEls = ref<Record<string, HTMLElement>>({})
let headersIO: IntersectionObserver | null = null

/** 卸载时清理，避免“幽灵 header” */
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

/** 滚动方向（仅在向上滚时做月份兜底纠正） */
let lastScrollTop = 0
const scrollDir = ref<'up' | 'down' | 'none'>('none')

/** 向下滚逻辑 + 向上滚兜底（用可见 note 修正月份） */
function recomputeStickyState() {
  const root = scrollerRef.value?.$el as HTMLElement | undefined
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
    else
      break
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

// 让 .sticky-month 和 .month-header 宽度对齐（不遮住滚动条）
function syncStickyGutters() {
  const sc = scrollerRef.value?.$el as HTMLElement | undefined
  const wrap = wrapperRef.value as HTMLElement | null
  if (!sc || !wrap)
    return

  const cs = getComputedStyle(sc)
  const pl = Number.parseFloat(cs.paddingLeft) || 0
  const pr = Number.parseFloat(cs.paddingRight) || 0
  const scrollbarW = sc.offsetWidth - sc.clientWidth

  wrap.style.setProperty('--sticky-left', `${pl + 4}px`)
  wrap.style.setProperty('--sticky-right', `${pr + scrollbarW + 4}px`)
}

/** 用“视口内最靠上的非置顶笔记”的月份纠正 currentMonthKey（仅向上滚） */
function setCurrentByTopVisibleNote(rootEl: HTMLElement) {
  const scRect = rootEl.getBoundingClientRect()

  let topId: string | null = null
  let topY = Number.POSITIVE_INFINITY
  for (const [id, el] of Object.entries(noteContainers.value)) {
    if (!el || !el.isConnected)
      continue

    const dataId = el.getAttribute('data-note-id')
    if (dataId !== id)
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

// ---- 滚动状态（快速滚动先隐藏按钮，停止后恢复） ----
const isUserScrolling = ref(false)
let scrollHideTimer: number | null = null

let collapseRetryId: number | null = null
let collapseRetryCount = 0
function scheduleCollapseRetry() {
  if (collapseRetryId !== null)
    return
  collapseRetryCount = 0
  const step = () => {
    collapseRetryId = requestAnimationFrame(() => {
      if (isUserScrolling.value) {
        cancelAnimationFrame(collapseRetryId!)
        collapseRetryId = null
        return
      }
      updateCollapsePos()
      if (collapseVisible.value || ++collapseRetryCount >= 12) {
        cancelAnimationFrame(collapseRetryId!)
        collapseRetryId = null
        return
      }
      step()
    })
  }
  step()
}

// 放在 handleScroll 之前
let rafPending = false
function scheduleScrollWork() {
  if (rafPending)
    return
  rafPending = true
  requestAnimationFrame(() => {
    rafPending = false
    // 这些原来在 handleScroll 里“每次滚动都跑”的重活，改到 rAF 里做
    recomputeStickyState()
    updateCollapsePos()
    syncStickyGutters()
  })
}

const handleScroll = throttle(() => {
  const el = scrollerRef.value?.$el as HTMLElement | undefined
  if (!el) {
    updateCollapsePos()
    return
  }

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

  // 滚动中隐藏按钮，停止 120ms 恢复
  isUserScrolling.value = true
  collapseVisible.value = false
  if (scrollHideTimer !== null) {
    window.clearTimeout(scrollHideTimer)
    scrollHideTimer = null
  }
  scrollHideTimer = window.setTimeout(() => {
    isUserScrolling.value = false
    updateCollapsePos()
    scheduleCollapseRetry()
  }, 120)

  scheduleScrollWork()
}, 16)

function rebindScrollListener() {
  const scrollerElement = scrollerRef.value?.$el as HTMLElement | undefined
  if (!scrollerElement)
    return

  scrollerElement.removeEventListener('scroll', handleScroll)
  scrollerElement.addEventListener('scroll', handleScroll, { passive: true } as any)
}

// ====== 强制刷新虚拟列表高度 ======
function forceVListRemeasure() {
  const sc = scrollerRef.value
  if (!sc)
    return

  try {
    sc.forceUpdate?.()
  }
  catch {
    // no-op
  }
}

watch(() => props.notes, () => {
  nextTick(() => {
    rebindScrollListener()
    updateCollapsePos()
    syncStickyGutters()
    requestAnimationFrame(() => {
      recomputeStickyState()
    })
    forceVListRemeasure()
  })
}, { deep: false })

watch(scrollerRef, (newScroller, oldScroller) => {
  if (oldScroller?.$el)
    oldScroller.$el.removeEventListener('scroll', handleScroll)

  if (newScroller?.$el) {
    rebindScrollListener()
    nextTick(() => {
      updateCollapsePos()
      syncStickyGutters()
      requestAnimationFrame(() => {
        recomputeStickyState()
      })
      forceVListRemeasure()
    })
  }
})

watch([expandedNote, editingNoteId], () => {
  nextTick(() => {
    updateCollapsePos()
    forceVListRemeasure()
  })
})

function handleWindowResize() {
  syncStickyGutters()
  updateCollapsePos()
  forceVListRemeasure()
}

onMounted(() => {
  window.addEventListener('resize', handleWindowResize, { passive: true })
  syncStickyGutters()
  const root = scrollerRef.value?.$el as HTMLElement | undefined
  if (root) {
    headersIO = new IntersectionObserver(() => {
      recomputeStickyState()
    }, { root })
  }
})
onUnmounted(() => {
  window.removeEventListener('resize', handleWindowResize)
  handleScroll.cancel()
  if (collapseRetryId !== null) {
    cancelAnimationFrame(collapseRetryId)
    collapseRetryId = null
  }
  if (headersIO) {
    headersIO.disconnect()
    headersIO = null
  }
})

function startEdit(note: any) {
  if (editingNoteId.value)
    cancelEdit()

  editingNoteId.value = note.id
  editingNoteContent.value = note.content
  expandedNote.value = null
  nextTick(() => {
    updateCollapsePos()
    forceVListRemeasure()
  })
}

function cancelEdit() {
  editingNoteId.value = null
  editingNoteContent.value = ''
  nextTick(forceVListRemeasure)
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

function _ensureCardVisible(noteId: string) {
  const scroller = scrollerRef.value?.$el as HTMLElement | undefined
  const card = noteContainers.value[noteId] as HTMLElement | undefined
  if (!scroller || !card)
    return

  const scrollerRect = scroller.getBoundingClientRect()
  const cardRect = card.getBoundingClientRect()
  const padding = 12

  if (cardRect.top < scrollerRect.top + padding)
    card.scrollIntoView({ behavior: 'auto', block: 'start' })
  else if (cardRect.bottom > scrollerRect.bottom)
    card.scrollIntoView({ behavior: 'auto', block: 'nearest' })
}

async function toggleExpand(noteId: string) {
  if (editingNoteId.value === noteId)
    return

  const scroller = scrollerRef.value?.$el as HTMLElement | undefined
  const isCurrentlyExpanded = expandedNote.value === noteId
  const isSwitching = expandedNote.value !== null && !isCurrentlyExpanded
  if (!scroller)
    return

  if (isSwitching) {
    expandedNote.value = null
    await nextTick()
    await new Promise(r => requestAnimationFrame(r))
  }

  if (!isCurrentlyExpanded) {
    const card = noteContainers.value[noteId] as HTMLElement | undefined
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

    const cardAfter = noteContainers.value[noteId] as HTMLElement | undefined
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

    const cardAfter = noteContainers.value[noteId] as HTMLElement | undefined
    if (cardAfter) {
      const scRectAfter = scroller.getBoundingClientRect()
      const cardRectAfter = cardAfter.getBoundingClientRect()
      const anchor = expandAnchor.value
      const wantTopOffset = (anchor.noteId === noteId) ? anchor.topOffset : 0
      const currentTopOffset = cardRectAfter.top - scRectAfter.top
      const delta = currentTopOffset - wantTopOffset

      let target = scroller.scrollTop + delta
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      target = Math.min(Math.max(0, target), maxScrollTop)

      await stableSetScrollTop(scroller, target, 6, 0.5)
    }
    expandAnchor.value = { noteId: null, topOffset: 0, scrollTop: scroller.scrollTop }
  }

  updateCollapsePos()
  forceVListRemeasure()
}

async function stableSetScrollTop(el: HTMLElement, target: number, tries = 5, epsilon = 0.5) {
  target = Math.max(0, Math.min(target, el.scrollHeight - el.clientHeight))
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

function handleEditorFocus(containerEl: HTMLElement) {
  setTimeout(() => {
    if (containerEl && typeof containerEl.scrollIntoView === 'function')
      containerEl.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }, 300)
}

watch(expandedNote, () => {
  nextTick(() => {
    updateCollapsePos()
    forceVListRemeasure()
  })
})

function updateCollapsePos() {
  if (isUserScrolling.value) {
    collapseVisible.value = false
    return
  }
  if (!expandedNote.value) {
    collapseVisible.value = false
    return
  }

  const scrollerEl = scrollerRef.value?.$el as HTMLElement | undefined
  const wrapperEl = wrapperRef.value as HTMLElement | null
  const cardEl = noteContainers.value[expandedNote.value]
  if (!scrollerEl || !wrapperEl || !cardEl || !cardEl.isConnected) {
    collapseVisible.value = false
    scheduleCollapseRetry()
    return
  }
  const dataId = (cardEl as HTMLElement).getAttribute('data-note-id')
  if (dataId !== expandedNote.value) {
    collapseVisible.value = false
    scheduleCollapseRetry()
    return
  }

  const scrollerRect = scrollerEl.getBoundingClientRect()
  const wrapperRect = wrapperEl.getBoundingClientRect()
  const cardRect = (cardEl as HTMLElement).getBoundingClientRect()
  const outOfView = cardRect.bottom <= scrollerRect.top || cardRect.top >= scrollerRect.bottom
  if (outOfView) {
    collapseVisible.value = false
    scheduleCollapseRetry()
    return
  }
  const btnEl = collapseBtnRef.value
  const btnH = btnEl ? btnEl.offsetHeight : 36
  const margin = 10
  const visibleBottom = Math.min(cardRect.bottom, scrollerRect.bottom - margin)
  const visibleTop = Math.max(cardRect.top, scrollerRect.top + margin)
  let topPx = visibleBottom - btnH
  if (topPx < visibleTop)
    topPx = visibleTop

  const leftPx = cardRect.left - wrapperRect.left + 0
  collapseStyle.value = { left: `${leftPx}px`, top: `${topPx - wrapperRect.top}px` }
  collapseVisible.value = true
}

async function focusAndEditNote(noteId: string) {
  const idx = noteIdToMixedIndex.value[noteId]
  if (idx !== undefined) {
    const original = props.notes.find(n => n.id === noteId)
    if (original) {
      editingNoteId.value = noteId
      editingNoteContent.value = original.content
      await nextTick()
      scrollerRef.value?.scrollToItem(idx, { align: 'center', behavior: 'smooth' })
    }
  }
}

function scrollToTop() {
  scrollerRef.value?.scrollToItem(0)
}

defineExpose({ scrollToTop, focusAndEditNote })
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
    <div v-else-if="notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.no_notes') }}
    </div>

    <DynamicScroller
      v-else
      ref="scrollerRef"
      :items="mixedItems"
      key-field="id"
      :min-item-size="140"
      :buffer="900"
      :prerender="12"
      class="scroller"
    >
      <template #before>
        <div v-if="currentMonthLabel" class="sticky-top-spacer" />
      </template>
      <template #default="{ item, index, active }">
        <DynamicScrollerItem
          :key="item.id"
          :item="item"
          :active="active"
          :data-index="index"
          :size-dependencies="item.type === 'note'
            ? [
              item.id,
              (item.content || '').length,
              expandedNote === item.id,
              editingNoteId === item.id,
            ]
            : [item.id, item.label]"
          class="note-item-container"
          @resize="() => { updateCollapsePos(); forceVListRemeasure() }"
        >
          <!-- 月份头部条幅（虚拟项） -->
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
              <NoteEditor
                v-if="editingNoteId === item.id"
                v-model="editingNoteContent"
                :is-editing="true"
                :is-loading="isUpdating"
                :max-note-length="maxNoteLength"
                :placeholder="$t('notes.update_note')"
                :all-tags="allTags"
                @save="handleUpdateNote"
                @cancel="cancelEdit"
                @focus="handleEditorFocus(noteContainers[item.id])"
              />
              <NoteItem
                v-else
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
            </div>
          </div>
        </DynamicScrollerItem>
      </template>

      <template #after>
        <div v-if="isLoading && notes.length > 0" class="py-4 text-center text-gray-500">
          {{ t('notes.loading') }}
        </div>
      </template>
    </DynamicScroller>

    <Transition name="fade">
      <button
        v-if="collapseVisible"
        ref="collapseBtnRef"
        type="button"
        class="collapse-button"
        :style="collapseStyle"
        @click.stop.prevent="toggleExpand(expandedNote!)"
      >
        收起
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.notes-list-wrapper { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
.scroller { height: 100%; overflow-y: auto; overflow-anchor: none; scroll-behavior: auto; -webkit-overflow-scrolling: touch;
  touch-action: pan-y;}

/* 背景 */
.scroller { background-color: #f9fafb; padding: 0.5rem; }
.dark .scroller { background-color: #111827; }

/* 卡片 */
.note-content-wrapper {
  background-color: #ffffff; border-radius: 12px; padding: 1rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.2s ease-in-out;
}
.note-content-wrapper:hover { box-shadow: 0 2px 4px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.07); }
.dark .note-content-wrapper {
  background-color: #1f2937; border: 1px solid #374151;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.1);
}
.dark .note-content-wrapper:hover { box-shadow: 0 2px 4px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.15); }

/* 间距与选择 */
.note-item-container { padding-bottom: 1.5rem; }
.note-item-container:last-child { padding-bottom: 0; }
.note-selection-wrapper { display: flex; gap: 0.75rem; transition: background-color 0.2s; }
.note-selection-wrapper.selection-mode {
  cursor: pointer; padding: 0.5rem;
  margin: -0.5rem -0.5rem calc(-0.5rem + 1.5rem) -0.5rem; border-radius: 8px;
}
.note-selection-wrapper.selection-mode:hover { background-color: rgba(0, 0, 0, 0.03); }
.dark .note-selection-wrapper.selection-mode:hover { background-color: rgba(255, 255, 255, 0.05); }
.note-content-wrapper { flex: 1; min-width: 0; }

/* 选择态圆点 */
.selection-indicator { padding-top: 0.75rem; }
.selection-circle { width: 20px; height: 20px; border-radius: 50%; border: 2px solid #ccc; transition: all 0.2s ease; }
.dark .selection-circle { border-color: #555; }
.selection-circle.selected { background-color: #00b386; border-color: #00b386; position: relative; }
.selection-circle.selected::after {
  content: ''; position: absolute; left: 6px; top: 2px; width: 5px; height: 10px;
  border: solid white; border-width: 0 2px 2px 0; transform: rotate(45deg);
}

/* 文案颜色 */
.text-gray-500 { color: #6b7280; }
.dark .text-gray-500 { color: #9ca3af; }

/* 收起按钮 */
.collapse-button {
  position: absolute; z-index: 10;
  background-color: #ffffff; color: #007bff; border: 1px solid #e0e0e0;
  border-radius: 15px; padding: 3px 8px; font-size: 14px; cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); transition: opacity 0.2s, transform 0.2s;
  opacity: 0.9; font-weight: normal;
  font-family: 'KaiTi', 'BiauKai', '楷体', 'Apple LiSung', serif, sans-serif;
}
.collapse-button:hover { opacity: 1; transform: scale(1.05); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ===== 月份头部项（虚拟项） ===== */
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

/* 悬浮月份条本身是 32px */
.sticky-top-spacer {
  height: 32px;
}
</style>
