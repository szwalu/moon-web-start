<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { debounce } from 'lodash-es'
import NoteItem from '@/components/NoteItem.vue'

// 组件卸载时，确保取消 debounce 并解绑事件

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
  // 新增一个 prop，用来判断是否还有更多笔记可加载
  hasMore: {
    type: Boolean,
    default: true,
  },
})

// --- Emits ---
// 定义所有需要向父组件传递的事件
const emit = defineEmits([
  'loadMore',
  'toggleExpand',
  'edit',
  'copy',
  'pin',
  'delete',
  'taskToggle',
])

// --- 无限滚动逻辑 (从 auth.vue 迁移过来) ---
const notesListRef = ref<HTMLElement | null>(null)

const handleScroll = debounce(() => {
  const el = notesListRef.value
  // 如果正在加载或没有更多了，则不执行
  if (!el || props.isLoading || !props.hasMore)
    return
  // 滚动到底部附近时，向父组件发出 'load-more' 事件
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50)
    emit('loadMore')
}, 200)

// 侦听 notesListRef 的变化，自动绑定和解绑滚动事件
// 这使得滚动逻辑完全封装在本组件内
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
  <div ref="notesListRef" class="notes-list">
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
        loding...
      </div>
    </div>
  </div>
</template>

<style scoped>
.notes-list {
  margin-top: 1rem;
  height: 510px; /* PC端默认高度 */
  overflow-y: auto;
  position: relative;
}

/* 关键改动：使用媒体查询来设置移动端的高度 */
@media (max-width: 768px) {
  .notes-list {
    height: 620px; /* 移动端高度 */
  }
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
