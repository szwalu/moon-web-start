<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import { debounce } from 'lodash-es'
import { useI18n } from 'vue-i18n'
import NoteItem from '@/components/NoteItem.vue'

const props = defineProps({
  notes: {
    type: Array as () => any[],
    required: true,
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
  expandedNoteId: {
    type: String as () => string | null,
    default: null,
  },
  hasMore: {
    type: Boolean,
    default: true,
  },
  scrollContainer: {
    type: Object as () => HTMLElement | null,
    default: null,
  },
  // --- 新增 props ---
  isSelectionModeActive: {
    type: Boolean,
    default: false,
  },
  selectedNoteIds: {
    type: Array as () => string[],
    default: () => [],
  },
})

const emit = defineEmits([
  'loadMore',
  'toggleExpand',
  'edit',
  'copy',
  'pin',
  'delete',
  'taskToggle',
  'toggleSelect', // --- 新增 emit ---
])

const { t } = useI18n()

const handleScroll = debounce(() => {
  const el = props.scrollContainer
  if (!el || props.isLoading || !props.hasMore)
    return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50)
    emit('loadMore')
}, 200)

watch(() => props.scrollContainer, (newEl, oldEl) => {
  if (oldEl)
    oldEl.removeEventListener('scroll', handleScroll)
  if (newEl)
    newEl.addEventListener('scroll', handleScroll)
})

onUnmounted(() => {
  handleScroll.cancel()
  if (props.scrollContainer)
    props.scrollContainer.removeEventListener('scroll', handleScroll)
})

// --- 新增方法: 在选择模式下，阻止默认的展开/编辑等操作 ---
function handleNoteAction(action: (...args: any[]) => void, ...args: any[]) {
  if (props.isSelectionModeActive)
    return // 在选择模式下，不执行任何笔记操作
  action(...args)
}
</script>

<template>
  <div class="notes-list">
    <div v-if="isLoading && notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.loading') }}
    </div>
    <div v-else-if="notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.no_notes') }}
    </div>
    <div v-else class="space-y-6">
      <div
        v-for="note in notes"
        :key="note.id"
        class="note-selection-wrapper"
        :class="{ 'selection-mode': isSelectionModeActive }"
        @click.stop="isSelectionModeActive && emit('toggleSelect', note.id)"
      >
        <div v-if="isSelectionModeActive" class="selection-indicator">
          <div
            class="selection-circle"
            :class="{ selected: selectedNoteIds.includes(note.id) }"
          />
        </div>
        <NoteItem
          :note="note"
          :is-expanded="expandedNoteId === note.id"
          @toggle-expand="noteId => handleNoteAction(emit, 'toggleExpand', noteId)"
          @edit="noteToEdit => handleNoteAction(emit, 'edit', noteToEdit)"
          @copy="content => handleNoteAction(emit, 'copy', content)"
          @pin="noteToPin => handleNoteAction(emit, 'pin', noteToPin)"
          @delete="noteId => handleNoteAction(emit, 'delete', noteId)"
          @task-toggle="payload => handleNoteAction(emit, 'taskToggle', payload)"
        />
      </div>

      <div v-if="isLoading && notes.length > 0" class="py-4 text-center text-gray-500">
        {{ t('notes.loading', '正在加载...') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.notes-list {
  margin-top: 1rem;
}

.text-gray-500 {
  color: #6b7280;
}
.dark .text-gray-500 {
  color: #9ca3af;
}

.space-y-6 > :not([hidden]) ~ :not([hidden]) {
  --tw-space-y-reverse: 0;
  margin-top: calc(1.5rem * calc(1 - var(--tw-space-y-reverse)));
  margin-bottom: calc(1.5rem * var(--tw-space-y-reverse));
}

/* --- 新增样式 --- */
.note-selection-wrapper {
  display: flex;
  align-items: flex-start; /* 让圆点和笔记顶部对齐 */
  gap: 0.75rem; /* 圆点和笔记之间的间距 */
  transition: background-color 0.2s ease;
}

.note-selection-wrapper.selection-mode {
  cursor: pointer;
  padding: 0.5rem;
  margin: -0.5rem; /* 抵消 padding 带来的额外空间 */
  border-radius: 8px;
}

.note-selection-wrapper.selection-mode:hover {
  background-color: rgba(0, 0, 0, 0.03);
}
.dark .note-selection-wrapper.selection-mode:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.note-selection-wrapper > :last-child {
  flex: 1; /* 让 NoteItem 占据剩余空间 */
}

.selection-indicator {
  padding-top: 0.75rem; /* 让圆点和日期大致对齐 */
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

/* 在选中的圆点内用伪元素画一个对勾 */
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
</style>
