<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { debounce } from 'lodash-es'
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

/** 列表滚动容器（DynamicScroller 的根元素） */
const scrollerRef = ref<any>(null)
/** 整个列表包裹元素，用于定位浮动按钮 */
const wrapperRef = ref<HTMLElement | null>(null)
/** 浮动“收起”按钮自身 */
const collapseBtnRef = ref<HTMLElement | null>(null)
/** 浮动按钮可见性与定位样式 */
const collapseVisible = ref(false)
const collapseStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' })

/** 展开中的笔记 ID */
const expandedNote = ref<string | null>(null)
/** 编辑中的笔记 */
const editingNoteId = ref<string | null>(null)
const editingNoteContent = ref('')
const isUpdating = ref(false)

/** 每个列表项 DOM 容器映射，便于测量位置 */
const noteContainers = ref<Record<string, HTMLElement>>({})

/** 滚动时触底加载 + 更新浮动按钮位置 */
const handleScroll = debounce(() => {
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
}, 50)

/** 监听 scrollerRef 的挂载/卸载，绑定/解绑滚动事件 */
watch(scrollerRef, (newScroller, oldScroller) => {
  if (oldScroller?.$el)
    oldScroller.$el.removeEventListener('scroll', handleScroll)

  if (newScroller?.$el) {
    newScroller.$el.addEventListener('scroll', handleScroll, { passive: true } as any)
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

/** 编辑相关 */
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

/** 展开/收起 */
async function toggleExpand(noteId: string) {
  if (editingNoteId.value === noteId)
    return

  expandedNote.value = expandedNote.value === noteId ? null : noteId
  nextTick(() => {
    updateCollapsePos()
  })
}

/** 编辑器聚焦时把对应容器滚到近处 */
function handleEditorFocus(containerEl: HTMLElement) {
  setTimeout(() => {
    if (containerEl && typeof containerEl.scrollIntoView === 'function')
      containerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, 300)
}

/** 当展开项变化时，重新定位按钮 */
watch(expandedNote, () => {
  nextTick(() => {
    updateCollapsePos()
  })
})

/** 计算并更新浮动“收起”按钮的位置 */
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

  // 卡片完全不可见时隐藏
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

  // 左边缘对齐到卡片左边
  const leftPx = cardRect.left - wrapperRect.left + 0

  collapseStyle.value = {
    left: `${leftPx}px`,
    top: `${topPx - wrapperRect.top}px`,
  }
  collapseVisible.value = true
}
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
        >
          <div
            :ref="(el) => { if (el) noteContainers[item.id] = el as unknown as HTMLElement }"
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

    <!-- 锚定在“当前展开卡片左下角”的全局浮动收起按钮 -->
    <div
      v-if="expandedNote && collapseVisible"
      class="collapse-anchored"
      :style="collapseStyle"
    >
      <button
        ref="collapseBtnRef"
        type="button"
        class="collapse-btn"
        @click.stop="toggleExpand(expandedNote as string)"
      >
        {{ t('notes.collapse') }}
      </button>
    </div>
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

/* 锚定“收起”按钮：相对 .notes-list-wrapper 绝对定位，由 JS 动态设置 left/top */
.collapse-anchored {
  position: absolute;
  z-index: 60;
  pointer-events: auto;
}

.collapse-btn {
  background-color: #ffffff;
  color: #111827;
  border: none;
  border-radius: 9999px;
  padding: 6px 14px;
  font-size: 14px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.12);
  cursor: pointer;
}
.collapse-btn:hover {
  box-shadow: 0 3px 8px rgba(0,0,0,0.18);
}
.dark .collapse-btn {
  background-color: #374151;
  color: #e5e7eb;
  box-shadow: 0 2px 6px rgba(0,0,0,0.4);
}
</style>
