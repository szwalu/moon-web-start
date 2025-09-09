<script setup lang="ts">
import { defineExpose, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

// --- 核心改动 1: 导入 throttle 而不是 debounce ---
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

// --- 核心改动 2: 使用 throttle (节流) 并设置更快的 30ms 延迟 ---
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
}, 30) // 更新频率改为 30ms，更平滑

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
  handleScroll.cancel() // throttle 也有 cancel 方法
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

// NoteList.vue -> <script setup>

async function toggleExpand(noteId: string) {
  if (editingNoteId.value === noteId)
    return

  const isExpanding = expandedNote.value !== noteId

  expandedNote.value = isExpanding ? noteId : null

  // 核心改动：使用 setTimeout 代替 nextTick
  // 我们给予一个 50 毫秒的延迟，这足以让虚拟列表库完成它自己的所有内部计算和滚动调整。
  // 在它完成之后，我们的滚动指令才会执行，从而确保我们的操作是最终的、有效的。
  setTimeout(() => {
    // 无论展开还是收起，都先更新浮动按钮的位置
    updateCollapsePos()

    // 仅当是“展开”操作时，才执行滚动
    if (isExpanding) {
      const cardEl = noteContainers.value[noteId]
      if (cardEl)
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, 50) // 设置 50 毫秒延迟
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
  padding: 6px 12px;
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
