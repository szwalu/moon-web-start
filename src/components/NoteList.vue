<script setup lang="ts">
import { defineExpose, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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

const noteContainers = ref<Record<string, HTMLElement>>({})

// 供 :ref 使用的辅助函数（处理挂载与卸载）
function setNoteContainer(el: Element | null, id: string) {
  if (!el) {
    // 关键：卸载时清理映射，避免命中被复用的旧 DOM
    delete noteContainers.value[id]
    return
  }
  const $el = el as HTMLElement
  $el.setAttribute('data-note-id', id)
  noteContainers.value[id] = $el
}

// 滚动状态（快速滚动时先隐藏按钮，停止后再恢复）
const isUserScrolling = ref(false)
let scrollHideTimer: number | null = null

// 位置恢复轻量重试（最多 12 帧）
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

const handleScroll = throttle(() => {
  const el = scrollerRef.value?.$el as HTMLElement | undefined
  if (!el) {
    updateCollapsePos()
    return
  }

  // 触底加载
  if (!props.isLoading && props.hasMore) {
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 300
    if (nearBottom)
      emit('loadMore')
  }

  // 滚动中先隐藏按钮，等停止 120ms 再恢复定位
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

  updateCollapsePos()
}, 16)

function rebindScrollListener() {
  const scrollerElement = scrollerRef.value?.$el as HTMLElement | undefined
  if (!scrollerElement)
    return
  scrollerElement.removeEventListener('scroll', handleScroll as any)
  scrollerElement.addEventListener('scroll', handleScroll as any, { passive: true } as any)
}

watch(
  () => props.notes,
  () => {
    nextTick(() => {
      rebindScrollListener()
      updateCollapsePos()
    })
  },
  { deep: false },
)

watch(scrollerRef, (newScroller, oldScroller) => {
  if (oldScroller?.$el)
    oldScroller.$el.removeEventListener('scroll', handleScroll as any)
  if (newScroller?.$el) {
    rebindScrollListener()
    nextTick(() => {
      updateCollapsePos()
    })
  }
})

onMounted(() => {
  window.addEventListener('resize', updateCollapsePos, { passive: true })
})
onUnmounted(() => {
  window.removeEventListener('resize', updateCollapsePos)
  handleScroll.cancel()
  if (collapseRetryId !== null) {
    cancelAnimationFrame(collapseRetryId)
    collapseRetryId = null
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
  })
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
    if (success)
      cancelEdit()
    isUpdating.value = false
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

// 展开/收起逻辑
async function toggleExpand(noteId: string) {
  if (editingNoteId.value === noteId)
    return

  const scroller = scrollerRef.value?.$el as HTMLElement | undefined
  const card = noteContainers.value[noteId] as HTMLElement | undefined
  const isExpanding = expandedNote.value !== noteId

  if (!scroller)
    return

  if (isExpanding) {
    // 展开前记录锚点
    if (card) {
      const scRect = scroller.getBoundingClientRect()
      const cardRect = card.getBoundingClientRect()
      expandAnchor.value = {
        noteId,
        topOffset: cardRect.top - scRect.top,
        scrollTop: scroller.scrollTop,
      }
    }
    else {
      expandAnchor.value = { noteId, topOffset: 0, scrollTop: scroller.scrollTop }
    }

    // 展开
    expandedNote.value = noteId

    // 等虚拟列表完成布局
    await nextTick()
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(r)))

    // 把展开后的卡片顶部对齐到容器顶部
    const cardAfter = noteContainers.value[noteId] as HTMLElement | undefined
    if (cardAfter) {
      scroller.style.overflowAnchor = 'none'
      const scRectAfter = scroller.getBoundingClientRect()
      const cardRectAfter = cardAfter.getBoundingClientRect()
      const topPadding = 0
      const deltaAlign = cardRectAfter.top - scRectAfter.top - topPadding
      const target = scroller.scrollTop + deltaAlign
      await stableSetScrollTop(scroller, target, 6, 0.5)
    }

    updateCollapsePos()
    return
  }

  // 收起：按展开瞬间锚点恢复
  expandedNote.value = null
  scroller.style.overflowAnchor = 'none'

  await nextTick()
  await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(r)))

  const cardAfter = noteContainers.value[noteId] as HTMLElement | undefined
  if (!cardAfter) {
    updateCollapsePos()
    return
  }

  const scRectAfter = scroller.getBoundingClientRect()
  const cardRectAfter = cardAfter.getBoundingClientRect()

  const anchor = expandAnchor.value
  const wantTopOffset = anchor.noteId === noteId ? anchor.topOffset : 0
  const currentTopOffset = cardRectAfter.top - scRectAfter.top
  const delta = currentTopOffset - wantTopOffset

  let target = scroller.scrollTop + delta
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  target = Math.min(Math.max(0, target), maxScrollTop)

  await stableSetScrollTop(scroller, target, 6, 0.5)
  expandAnchor.value = { noteId: null, topOffset: 0, scrollTop: scroller.scrollTop }

  updateCollapsePos()
}

// 在多帧内反复设定 scrollTop，直到稳定（解决虚拟列表/浏览器锚定回拉）
async function stableSetScrollTop(
  el: HTMLElement,
  target: number,
  tries = 5,
  epsilon = 0.5,
) {
  target = Math.max(0, Math.min(target, el.scrollHeight - el.clientHeight))

  return new Promise<void>((resolve) => {
    let count = 0
    const tick = () => {
      const diff = Math.abs(el.scrollTop - target)
      if (diff > epsilon)
        el.scrollTop = target

      if (++count >= tries || Math.abs(el.scrollTop - target) <= epsilon) {
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
  collapseStyle.value = {
    left: `${leftPx}px`,
    top: `${topPx - wrapperRect.top}px`,
  }
  collapseVisible.value = true
}

function scrollToTop() {
  scrollerRef.value?.scrollToItem(0)
}

defineExpose({
  scrollToTop,
})
</script>

<template>
  <div ref="wrapperRef" class="notes-list-wrapper">
    <div v-if="isLoading && notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.loading') }}
    </div>
    <div v-else-if="notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.no_notes') }}
    </div>

    <DynamicScroller
      v-else
      ref="scrollerRef"
      :items="notes"
      :min-item-size="64"
      class="scroller"
      key-field="id"
    >
      <template #default="{ item, index, active }">
        <DynamicScrollerItem
          :key="item.id + (expandedNote === item.id ? '_open' : '_shut') + (editingNoteId === item.id ? '_edit' : '') + (isSelectionModeActive ? '_sel' : '')"
          :item="item"
          :active="active"
          :data-index="index"
          :size-dependencies="[
            item.content,
            item.updated_at ?? '',
            item.pinned ?? false,
            isSelectionModeActive,
            expandedNote === item.id,
            editingNoteId === item.id,
          ]"
          class="note-item-container"
          @resize="updateCollapsePos"
        >
          <div
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
.notes-list-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

/* 统一定义一次 .scroller */
.scroller {
  height: 100%;
  overflow-y: auto;
  overflow-anchor: none; /* 关闭浏览器自身的锚定，避免与手动补偿冲突 */
  scroll-behavior: auto;
  /* 背景与内边距（衬托卡片） */
  background-color: #f9fafb;
  padding: 0.5rem;
}
.dark .scroller {
  background-color: #111827;
}

/* 根项是虚拟列表测量对象：必须稳定、可测 */
.note-item-container {
  box-sizing: border-box;
  display: flow-root;   /* 建立 BFC，避免 margin 折叠 */
  padding: 0.75rem 0;   /* 用 padding 形成卡片间距的外框 */
}

/* 选择模式：不要用负 margin 影响测量 */
.note-selection-wrapper {
  display: flex;
  gap: 0.75rem;
  transition: background-color 0.2s;
}
.note-selection-wrapper.selection-mode {
  cursor: pointer;
  padding: 0.5rem;
  margin: 0;            /* 关键：去掉负 margin/外层 margin */
  border-radius: 8px;
}
.note-selection-wrapper.selection-mode:hover {
  background-color: rgba(0, 0, 0, 0.03);
}
.dark .note-selection-wrapper.selection-mode:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

/* 卡片本体 */
.note-content-wrapper {
  flex: 1;
  min-width: 0;
  margin: 0.25rem 0;         /* 卡片之间竖向间距放在内部容器 */
  background-color: #ffffff; /* 亮色卡片 */
  border-radius: 12px;
  padding: 1rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.2s ease-in-out;
}
.note-content-wrapper:hover {
  box-shadow: 0 2px 4px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.07);
}

/* 深色模式卡片 */
.dark .note-content-wrapper {
  background-color: #1f2937;
  border: 1px solid #374151;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.1);
}
.dark .note-content-wrapper:hover {
  box-shadow: 0 2px 4px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.15);
}

/* 选择指示器 */
.selection-indicator {
  padding-top: 0.75rem;
}
.selection-circle {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid #ccc;
  transition: all 0.2s ease;
}
.dark .selection-circle {
  border-color: #555;
}
.selection-circle.selected {
  background-color: #00b386;
  border-color: #00b386;
  position: relative;
}
.selection-circle.selected::after {
  content: '';
  position: absolute;
  left: 6px;
  top: 2px;
  width: 5px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

/* 辅助文本色 */
.text-gray-500 {
  color: #6b7280;
}
.dark .text-gray-500 {
  color: #9ca3af;
}

/* 收起按钮 */
.collapse-button {
  position: absolute;
  z-index: 10;
  background-color: #ffffff;
  color: #007bff;
  border: 1px solid #e0e0e0;
  border-radius: 15px;
  padding: 3px 8px;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: opacity 0.2s, transform 0.2s;
  opacity: 0.9;
  font-weight: normal;
  font-family: 'KaiTi', 'BiauKai', '楷体', 'Apple LiSung', serif, sans-serif;
}
.collapse-button:hover {
  opacity: 1;
  transform: scale(1.05);
}

/* 渐隐动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
