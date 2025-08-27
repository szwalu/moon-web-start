<script setup lang="ts">
// 1. 恢复之前的 import
import { onUnmounted, watch } from 'vue'
import { debounce } from 'lodash-es'
import { useI18n } from 'vue-i18n'
import NoteItem from '@/components/NoteItem.vue'

// 2. 修改 props 定义，增加 scrollContainer
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
  // --- 新增这个 prop ---
  scrollContainer: {
    type: Object as () => HTMLElement | null,
    default: null,
  },
})

// 3. 恢复 emits 定义
const emit = defineEmits([
  'loadMore',
  'toggleExpand',
  'edit',
  'copy',
  'pin',
  'delete',
  'taskToggle',
])

const { t } = useI18n()

// 4. 恢复无限滚动逻辑，并修改它
const handleScroll = debounce(() => {
  // 使用 props.scrollContainer 代替 el
  const el = props.scrollContainer
  if (!el || props.isLoading || !props.hasMore)
    return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50)
    emit('loadMore')
}, 200)

// 监听 props.scrollContainer 的变化，而不是 notesListRef
watch(() => props.scrollContainer, (newEl, oldEl) => {
  if (oldEl)
    oldEl.removeEventListener('scroll', handleScroll)
  if (newEl)
    newEl.addEventListener('scroll', handleScroll)
})

onUnmounted(() => {
  handleScroll.cancel()
  // 组件卸载时，也从 prop 传来的元素上移除监听
  if (props.scrollContainer)
    props.scrollContainer.removeEventListener('scroll', handleScroll)
})
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
        loading...
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
</style>
