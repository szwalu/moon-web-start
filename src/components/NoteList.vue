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

// ✨✨✨ 核心改动 1: 增加一个变量来存储“展开”前的稳定滚动位置 ✨✨✨
let stableScrollTop = 0

const handleScroll = throttle(() => {
  const el = scrollerRef.value?.$el as HTMLElement | undefined
  if (!el) {
    updateCollapsePos()
    return
  }

  if (!props.isLoading && props.hasMore) {
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 300
    if (nearBottom)
      emit('loadMore')
  }

  updateCollapsePos()
}, 30)

function rebindScrollListener() {
  const scrollerElement = scrollerRef.value?.$el as HTMLElement | undefined
  if (!scrollerElement)
    return
  scrollerElement.removeEventListener('scroll', handleScroll)
  scrollerElement.addEventListener('scroll', handleScroll, { passive: true } as any)
}

watch(() => props.notes, () => {
  nextTick(() => {
    rebindScrollListener()
    updateCollapsePos()
  })
}, { deep: false })

watch(scrollerRef, (newScroller, oldScroller) => {
  if (oldScroller?.$el)
    oldScroller.$el.removeEventListener('scroll', handleScroll)
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
  emit(
    'updateNote',
    { id: editingNoteId.value, content: editingNoteContent.value },
    (success: boolean) => {
      if (success)
        cancelEdit()
      isUpdating.value = false
    },
  )
}

function ensureCardVisible(noteId: string) {
  const scroller = scrollerRef.value?.$el as HTMLElement | undefined
  const card = noteContainers.value[noteId] as HTMLElement | undefined
  if (!scroller || !card)
    return

  const scrollerRect = scroller.getBoundingClientRect()
  const cardRect = card.getBoundingClientRect()
  const padding = 12

  if (cardRect.top < scrollerRect.top + padding)
    card.scrollIntoView({ behavior: 'smooth', block: 'start' })
  else if (cardRect.bottom > scrollerRect.bottom)
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

// ✨✨✨ 核心改动 2: 重构 toggleExpand 函数以解决竞态问题 ✨✨✨
async function toggleExpand(noteId: string) {
  if (editingNoteId.value === noteId)
    return

  const scroller = scrollerRef.value?.$el as HTMLElement | undefined
  if (!scroller)
    return // 安全检查

  const isExpanding = expandedNote.value !== noteId

  if (isExpanding) {
    // --- 展开逻辑 ---
    // 1. 在执行任何操作前，先记录下当前稳定的滚动位置
    stableScrollTop = scroller.scrollTop
    // 2. 更新状态以展开笔记
    expandedNote.value = noteId
    // 3. 异步执行滚动动画
    setTimeout(() => {
      updateCollapsePos()
      ensureCardVisible(noteId)
    }, 50)
  }
  else {
    // --- 收起逻辑 ---
    // 1. 更新状态以收起笔记
    expandedNote.value = null
    // 2. 在 DOM 更新后，恢复到我们之前保存的稳定位置
    nextTick(() => {
      scroller.scrollTop = stableScrollTop
      updateCollapsePos()
    })
  }
}

function handleEditorFocus(containerEl: HTMLElement) {
  setTimeout(() => {
    if (containerEl && typeof containerEl.scrollIntoView === 'function')
      containerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, 300)
}

watch(expandedNote, () => {
  nextTick(() => {
    updateCollapsePos()
  })
})

function updateCollapsePos() {
  if (!expandedNote.value) {
    collapseVisible.value = false
    return
  }
  const scrollerEl = scrollerRef.value?.$el as HTMLElement | undefined
  const wrapperEl = wrapperRef.value as HTMLElement | null
  const cardEl = noteContainers.value[expandedNote.value]
  if (!scrollerEl || !wrapperEl || !cardEl) {
    collapseVisible.value = false
    return
  }
  const scrollerRect = scrollerEl.getBoundingClientRect()
  const wrapperRect = wrapperEl.getBoundingClientRect()
  const cardRect = (cardEl as HTMLElement).getBoundingClientRect()
  const outOfView = cardRect.bottom <= scrollerRect.top || cardRect.top >= scrollerRect.bottom
  if (outOfView) {
    collapseVisible.value = false
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
      :min-item-size="120"
      class="scroller"
      key-field="id"
    >
      <template #default="{ item, index, active }">
        <DynamicScrollerItem
          :item="item"
          :active="active"
          :data-index="index"
          :size-dependencies="[
            item.content,
            expandedNote === item.id,
            editingNoteId === item.id,
          ]"
          class="note-item-container"
          @resize="updateCollapsePos"
        >
          <div
            :ref="(el) => { if (el) noteContainers[item.id] = el as HTMLElement }"
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
        @click="toggleExpand(expandedNote!)"
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
.scroller {
  height: 100%;
  overflow-y: auto;
}
/* --- 全新的卡片化样式 --- */

/* 1. 给列表的背景一个非常浅的灰色，以衬托卡片 */
.scroller {
  height: 100%;
  overflow-y: auto;
  /* 新增：为滚动区域设置背景色 */
  background-color: #f9fafb;
  padding: 0.5rem; /* 给卡片和列表边缘留出一些空间 */
}
.dark .scroller {
  background-color: #111827; /* 深色模式下的深灰色背景 */
}

/* 2. 定义每个笔记卡片的基础样式 */
.note-content-wrapper {
  background-color: #ffffff; /* 卡片使用纯白色背景 */
  border-radius: 12px; /* 更圆润的卡片圆角 */
  padding: 1rem; /* 卡片内部的文字留白 */
  /* 关键：添加漂亮的阴影 */
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.2s ease-in-out;
}
.note-content-wrapper:hover {
  box-shadow: 0 2px 4px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.07);
}

/* 3. 为深色模式定义卡片样式 */
.dark .note-content-wrapper {
  background-color: #1f2937; /* 深色卡片背景 */
  border: 1px solid #374151; /* 在深色模式下加一个细边框，轮廓更清晰 */
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.1);
}
.dark .note-content-wrapper:hover {
   box-shadow: 0 2px 4px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.15);
}

/* 4. 调整外部容器的间距 */
.note-item-container {
  padding-bottom: 1rem; /* 设置卡片之间的垂直间距 */
}
.note-item-container:last-child {
  padding-bottom: 0.5rem; /* 最后一个卡片的间距可以小一点 */
}
.note-item-container {
  padding-bottom: 1.5rem;
}
.note-item-container:last-child {
  padding-bottom: 0;
}
.note-selection-wrapper {
  display: flex;
  gap: 0.75rem;
  transition: background-color 0.2s;
}
.note-selection-wrapper.selection-mode {
  cursor: pointer;
  padding: 0.5rem;
  margin: -0.5rem -0.5rem calc(-0.5rem + 1.5rem) -0.5rem;
  border-radius: 8px;
}
.note-selection-wrapper.selection-mode:hover {
  background-color: rgba(0, 0, 0, 0.03);
}
.dark .note-selection-wrapper.selection-mode:hover {
  background-color: rgba(255, 255, 255, 0.05);
}
.note-content-wrapper {
  flex: 1;
  min-width: 0;
}
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
.text-gray-500 {
  color: #6b7280;
}
.dark .text-gray-500 {
  color: #9ca3af;
}
.collapse-button {
  position: absolute;
  z-index: 10;
  background-color: #ffffff; /* 改为白色 */
  color: #007bff;            /* 改为一个漂亮的蓝色，您也可以直接用 'blue' */
  border: 1px solid #e0e0e0;  /* (推荐) 增加一个浅灰色边框，使其更清晰 */
  border-radius: 15px;
  padding: 3px 8px;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); /* 阴影可以调浅一些 */
  transition: opacity 0.2s, transform 0.2s;
  opacity: 0.9; /* 可以让它稍微不那么透明 */
  font-weight: normal;
  font-family: 'KaiTi', 'BiauKai', '楷体', 'Apple LiSung', serif, sans-serif;
}
.collapse-button:hover {
  opacity: 1;
  transform: scale(1.05);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
