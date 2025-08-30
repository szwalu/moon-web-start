<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import { useDialog } from 'naive-ui'
import { useSettingStore } from '@/stores/setting.ts'

const props = defineProps({
  note: { type: Object, required: true },
  isExpanded: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'copy', 'pin', 'delete', 'toggleExpand', 'taskToggle'])

const { t } = useI18n()
const dialog = useDialog()
const noteOverflowStatus = ref(false)
const contentRef = ref<Element | null>(null)
let clickTimer: number | null = null
const clickDelay = 250 // 定义双击的毫秒间隔

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
}).use(taskLists, { enabled: true, label: true })

const settingsStore = useSettingStore()
const fontSizeClass = computed(() => `font-size-${settingsStore.noteFontSize}`)

function renderMarkdown(content: string) {
  if (!content)
    return ''

  const html = md.render(content)
  return html.replace(/(?<!\w)#([^\s#.,?!;:"'()\[\]{}]+)/g, '<span class="custom-tag">#$1</span>')
}

function checkIfNoteOverflows() {
  const el = contentRef.value
  if (el)
    noteOverflowStatus.value = el.scrollHeight > el.clientHeight
}

onMounted(() => {
  nextTick(() => {
    checkIfNoteOverflows()
  })
})

onUnmounted(() => {
  if (clickTimer)
    clearTimeout(clickTimer)
})

watch(() => props.note.content, () => {
  nextTick(() => {
    checkIfNoteOverflows()
  })
})

function getDropdownOptions(note: any) {
  const charCount = note.content ? note.content.length : 0
  const creationDateObj = new Date(note.created_at)
  const creationTime = !note.created_at || Number.isNaN(creationDateObj.getTime())
    ? '未知'
    : creationDateObj.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  const updatedDateObj = new Date(note.updated_at)
  const updatedTime = !note.updated_at || Number.isNaN(updatedDateObj.getTime())
    ? '未知'
    : updatedDateObj.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

  return [
    // 重新添加了“编辑”选项
    { label: t('notes.edit'), key: 'edit' },
    { label: t('notes.copy'), key: 'copy' },
    { label: note.is_pinned ? t('notes.unpin') : t('notes.pin'), key: 'pin' },
    { label: t('notes.delete'), key: 'delete' },
    { key: 'divider-1', type: 'divider' },
    { label: t('notes.word_count', { count: charCount }), key: 'char_count', disabled: true },
    { label: t('notes.created_at', { time: creationTime }), key: 'creation_time', disabled: true },
    { label: t('notes.updated2_at', { time: updatedTime }), key: 'updated2_time', disabled: true },
  ]
}

function handleDropdownSelect(key: string) {
  switch (key) {
    // 恢复编辑逻辑
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
      dialog.warning({
        title: t('dialog.delete_note_title'),
        content: t('dialog.delete_note_content'),
        positiveText: t('dialog.confirm_button'),
        negativeText: t('dialog.cancel_button'),
        onPositiveClick: () => {
          emit('delete', props.note.id)
        },
      })
      break
  }
}

function handleSingleClickAction(event: MouseEvent) {
  const target = event.target as HTMLElement
  const listItem = target.closest('li.task-list-item')
  if (!listItem)
    return

  const noteCard = target.closest('.note-card')
  if (!noteCard)
    return

  const allListItems = Array.from(noteCard.querySelectorAll('li.task-list-item'))
  const itemIndex = allListItems.indexOf(listItem)

  if (itemIndex !== -1)
    emit('taskToggle', { noteId: props.note.id, itemIndex })
}

// 恢复双击计时逻辑，用于区分单击和双击
function handleCardClick(event: MouseEvent) {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
    emit('edit', props.note) // 双击执行编辑
  }
  else {
    clickTimer = window.setTimeout(() => {
      handleSingleClickAction(event) // 单击执行任务列表勾选
      clickTimer = null
    }, clickDelay)
  }
}
</script>

<template>
  <div
    :data-note-id="note.id"
    class="note-card"
    :class="{ 'is-expanded': isExpanded }"
    @click="handleCardClick"
  >
    <div class="note-card-top-bar">
      <div class="note-meta-left">
        <p class="note-date">
          {{ new Date(note.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}
        </p>
        <span v-if="note.is_pinned" class="pinned-indicator">
          {{ $t('notes.pin') }}
        </span>
      </div>

      <div class="note-card-actions">
        <n-dropdown
          trigger="click"
          placement="bottom-end"
          :options="getDropdownOptions(note)"
          @select="handleDropdownSelect"
          @click.stop
        >
          <div class="kebab-menu" @dblclick.stop>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M6 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0z" /></svg>
          </div>
        </n-dropdown>
      </div>
    </div>

    <div class="flex-1 min-w-0" @click.self.stop="handleContentClick">
      <div v-if="isExpanded">
        <div
          class="prose dark:prose-invert max-w-none"
          :class="fontSizeClass"
          v-html="renderMarkdown(note.content)"
        />
        <div class="toggle-button-row" @click.stop="emit('toggleExpand', note.id)">
          <button class="toggle-button collapse-button">
            {{ $t('notes.collapse') }}
          </button>
        </div>
      </div>
      <div v-else>
        <div
          ref="contentRef"
          class="prose dark:prose-invert line-clamp-3 max-w-none"
          :class="fontSizeClass"
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
/* 样式调整：因为移除了铅笔按钮，所以相关的 `.action-button` 样式就不再需要了，但为了兼容性保留着也不会影响功能。
   `note-card-actions` 的样式可能需要微调，但通常情况下，只剩一个 `kebab-menu` 也会自动居中或靠边。 */
.note-card {
  @apply mb-3 flex flex-col w-full rounded-lg bg-gray-100 shadow-md p-4;
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
.note-card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.action-button, /* 铅笔按钮已移除，此样式可忽略 */
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
  color: #555;
  background: none;
  border: none;
}
.dark .action-button,
.dark .kebab-menu {
  color: #bbb;
}
.action-button:hover,
.kebab-menu:hover {
  background-color: rgba(0, 0, 0, 0.1);
}
.dark .action-button:hover,
.dark .kebab-menu:hover {
  background-color: rgba(255, 255, 255, 0.1);
}
.action-button svg {
  width: 18px;
  height: 18px;
}
.toggle-button-row {
  width: 100%;
  cursor: pointer;
  padding: 4px 0;
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
  font-size: 14px;
  font-weight: normal;
  font-family: 'KaiTi', 'BiauKai', '楷体', 'Apple LiSung', serif, sans-serif;
}
.dark .toggle-button {
  color: #38bdf8 !important;
}
.toggle-button:hover {
  text-decoration: underline;
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
.is-expanded .toggle-button-row {
  position: -webkit-sticky;
  position: sticky;
  bottom: 0rem;
  z-index: 5;
  background-color: #f3f4f6;
  margin-left: -1rem;
  margin-right: -1rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid #e5e7eb;
}
.dark .is-expanded .toggle-button-row {
  background-color: #374151;
  border-top-color: #4b5563;
}
:deep(.prose.font-size-small) {
  font-size: 14px !important;
}
:deep(.prose.font-size-medium) {
  font-size: 17px !important;
}
:deep(.prose.font-size-large) {
  font-size: 20px !important;
}
:deep(table) {
  width: auto;
  border-collapse: collapse;
  margin-top: 1em;
  margin-bottom: 1em;
  border: 1px solid #dfe2e5;
  display: table !important;
}
.dark :deep(table) {
  border-color: #4b5563;
}
:deep(th),
:deep(td) {
  padding: 8px 15px;
  border: 1px solid #dfe2e5;
}
.dark :deep(th),
.dark :deep(td) {
    border-color: #4b5563;
}
:deep(th) {
  font-weight: 600;
  background-color: #f6f8fa;
}
.dark :deep(th) {
    background-color: #374151;
}
:deep(.prose) {
  line-height: 1.5 !important;
}
:deep(.prose p) {
  margin-top: 0.2em !important;
  margin-bottom: 0.2em !important;
}
</style>
