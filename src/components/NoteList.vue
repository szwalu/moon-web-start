<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { debounce } from 'lodash-es'
import NoteItem from '@/components/NoteItem.vue'

// --- Props ---
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
})

// --- Emits ---
const emit = defineEmits([
  'loadMore',
  'toggleExpand',
  'edit',
  'copy',
  'pin',
  'delete',
  'taskToggle',
])

// --- 无限滚动逻辑 ---
const notesListRef = ref<HTMLElement | null>(null)

const handleScroll = debounce(() => {
  const el = notesListRef.value
  if (!el || props.isLoading || !props.hasMore)
    return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50)
    emit('loadMore')
}, 200)

watch(notesListRef, (newEl, oldEl) => {
  if (oldEl)
    oldEl.removeEventListener('scroll', handleScroll)
  if (newEl)
    newEl.addEventListener('scroll', handleScroll)
})

onUnmounted(() => {
  handleScroll.cancel()
  if (notesListRef.value)
    notesListRef.value.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <div ref="notesListRef" class="notes-list h-80 overflow-auto">
    <div v-if="isLoading && notes.length === 0" class="py-4 text-center text-gray-500">
      加载中...
    </div>
    <div v-else-if="notes.length === 0" class="py-4 text-center text-gray-500">
      暂无笔记
    </div>
    <div v-else class="space-y-6">
      <NoteItem
        v-for="note in notes"
        :key="note.id"
        :note="note"
        :is-expanded="expandedNoteId === note.id"
        @toggle-expand="noteId => emit('toggleExpand', noteId)"
        @edit="noteToEdit => emit('edit', noteToEdit)"
        @copy="content => emit('copy', content)"
        @pin="noteToPin => emit('pin', noteToPin)"
        @delete="noteId => emit('delete', noteId)"
        @task-toggle="payload => emit('taskToggle', payload)"
      />
      <div v-if="isLoading && notes.length > 0" class="py-4 text-center text-gray-500">
        加载中...
      </div>
    </div>

    <div v-if="expandedNoteId" class="sticky-collapse-button-wrapper">
      <button class="sticky-collapse-button" @click="emit('toggleExpand', expandedNoteId)">
        {{ $t('notes.collapse') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.notes-list {
  margin-top: 1rem;
  /* 移除固定的 height: 500px */
  /* height: 500px; */
  overflow-y: auto;
  position: relative;
  /* 新增：让列表在 flex 容器中自动伸展，填满所有可用空间 */
  flex: 1;
  /* 新增：一个防止 flex 溢出的 hack */
  min-height: 0;
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

.sticky-collapse-button-wrapper {
  position: -webkit-sticky;
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  justify-content: center;
  padding: 8px 0;
  background: linear-gradient(to top, rgba(255, 255, 255, 1) 70%, rgba(255, 255, 255, 0));
}

.dark .sticky-collapse-button-wrapper {
  background: linear-gradient(to top, rgba(26, 32, 44, 1) 70%, rgba(26, 32, 44, 0));
}

.sticky-collapse-button {
  padding: 8px 24px;
  border-radius: 9999px;
  border: 1px solid #e2e8f0;
  background-color: #fff;
  color: #4a5568;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  cursor: pointer;
  transition: all 0.2s ease-in-out;
}

.sticky-collapse-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
}

.dark .sticky-collapse-button {
  background-color: #2d3748;
  border-color: #4a5568;
  color: #e2e8f0;
}
</style>
