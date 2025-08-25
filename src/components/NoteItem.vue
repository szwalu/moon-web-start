<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'

// --- Props and Emits ---
const props = defineProps({
  note: {
    type: Object,
    required: true,
  },
  isExpanded: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['edit', 'copy', 'pin', 'delete', 'toggleExpand', 'taskToggle'])

// --- 初始化 & 状态 ---
const { t } = useI18n()
const noteOverflowStatus = ref(false)
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
}).use(taskLists, { enabled: true, label: true })

// --- Markdown 渲染 ---
function renderMarkdown(content: string) {
  if (!content)
    return ''
  const html = md.render(content)
  return html.replace(/(?<!\w)#([^\s#.,?!;:"'()\[\]{}]+)/g, '<span class="custom-tag">#$1</span>')
}

// --- DOM 相关 ---
function checkIfNoteOverflows(el: Element | null) {
  if (el)
    noteOverflowStatus.value = el.scrollHeight > el.clientHeight
}

// --- 下拉菜单逻辑 ---
function getDropdownOptions(note: any) {
  const charCount = note.content ? note.content.length : 0
  const dateObj = new Date(note.created_at)
  const creationTime = !note.created_at || Number.isNaN(dateObj.getTime())
    ? '未知'
    : dateObj.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  return [
    { label: t('notes.edit'), key: 'edit' },
    { label: t('notes.copy'), key: 'copy' },
    { label: note.is_pinned ? t('notes.unpin') : t('notes.pin'), key: 'pin' },
    { label: t('notes.delete'), key: 'delete' },
    { key: 'divider-1', type: 'divider' },
    { label: t('notes.word_count', { count: charCount }), key: 'char_count', disabled: true },
    { label: t('notes.created_at', { time: creationTime }), key: 'creation_time', disabled: true },
  ]
}

function handleDropdownSelect(key: string) {
  switch (key) {
    case 'edit':
      emit('edit', props.note)
      break
    case 'copy':
      emit('copy', props.note.content)
      break
    case 'pin':
      emit('pin', props.note)
      break
    case 'delete':
      emit('delete', props.note.id)
      break
  }
}

// --- 任务列表点击处理 ---
function handleNoteContentClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const listItem = target.closest('li.task-list-item')
  if (!listItem)
    return

  event.stopPropagation()

  const noteCard = (event.currentTarget as HTMLElement)
  const allListItems = Array.from(noteCard.querySelectorAll('li.task-list-item'))
  const itemIndex = allListItems.indexOf(listItem)

  if (itemIndex !== -1)
    emit('taskToggle', { noteId: props.note.id, itemIndex })
}
</script>

<template>
  <div
    :data-note-id="note.id"
    class="note-card"
    :class="{ 'is-expanded': isExpanded }"
    @click="handleNoteContentClick"
  >
    <div class="note-card-top-bar">
      <div class="note-meta-left">
        <p class="note-date">
          {{ new Date(note.updated_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}
        </p>
        <span v-if="note.is_pinned" class="pinned-indicator">
          {{ $t('notes.pin') }}
        </span>
      </div>
      <n-dropdown
        trigger="click"
        placement="bottom-end"
        :options="getDropdownOptions(note)"
        @select="handleDropdownSelect"
      >
        <div class="kebab-menu">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M6 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0z" /></svg>
        </div>
      </n-dropdown>
    </div>

    <div class="flex-1 min-w-0">
      <div v-if="isExpanded">
        <div
          class="prose dark:prose-invert max-w-none"
          v-html="renderMarkdown(note.content)"
        />
      </div>
      <div v-else>
        <div
          :ref="checkIfNoteOverflows"
          class="prose dark:prose-invert line-clamp-3 max-w-none"
          v-html="renderMarkdown(note.content)"
        />
        <div
          v-if="noteOverflowStatus"
          class="toggle-button-row"
          @click.stop="emit('toggleExpand', note.id)"
        >
          <button class="toggle-button">
            {{ $t('notes.expand') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.note-card {
  @apply mb-3 block w-full rounded-lg bg-gray-100 shadow-md p-4;
  /* position: relative;  为粘性定位提供一个参照上下文 */
}

.dark .note-card {
  @apply bg-gray-700;
}

.note-card-top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  height: 24px;
}

.note-date {
  font-size: 11px;
  color: #888;
  margin: 0;
  padding: 0;
}

.dark .note-date {
  color: #aaa;
}

.note-meta-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.pinned-indicator {
  font-size: 10px;
  font-weight: bold;
  color: #c2410c;
  background-color: #ffedd5;
  padding: 2px 6px;
  border-radius: 9999px;
  line-height: 1;
}

.dark .pinned-indicator {
  color: #fde68a;
  background-color: #78350f;
}

.kebab-menu {
  cursor: pointer;
  padding: 4px;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.kebab-menu:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

.dark .kebab-menu:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.toggle-button-row {
  width: 100%;
  cursor: pointer;
  padding-top: 4px;
  margin-top: 4px;
}

.toggle-button {
  pointer-events: none;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  width: auto;
  display: block;
  text-align: left;
  color: #007bff !important;
  font-size: 12px;
  font-weight: normal;
  font-family: 'KaiTi', 'BiauKai', '楷体', 'Apple LiSung', serif, sans-serif;
}

.dark .toggle-button {
  color: #38bdf8 !important;
}

.toggle-button:hover {
  text-decoration: underline;
}

:deep(.prose) {
  font-size: 17px !important;
  line-height: 1.6;
}

.line-clamp-3 {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

:deep(.custom-tag) {
  background-color: #eef2ff;
  color: #4338ca;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.875em;
  font-weight: 500;
  margin: 0 2px;
}

.dark :deep(.custom-tag) {
  background-color: #312e81;
  color: #c7d2fe;
}

:deep(.prose > :first-child) {
  margin-top: 0 !important;
}

:deep(.prose > :last-child) {
  margin-bottom: 0 !important;
}
</style>
