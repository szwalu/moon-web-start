<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'

// --- 新增：从 Naive UI 引入 useDialog ---
import { useDialog } from 'naive-ui'
import { useSettingStore } from '@/stores/setting.ts'

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
// --- 新增：初始化 dialog ---
const dialog = useDialog()
const noteOverflowStatus = ref(false)
const contentRef = ref<Element | null>(null)
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
}).use(taskLists, { enabled: true, label: true })

const settingsStore = useSettingStore()
const fontSizeClass = computed(() => `font-size-${settingsStore.noteFontSize}`)

// --- Markdown 渲染 ---
function renderMarkdown(content: string) {
  if (!content)
    return ''
  const html = md.render(content)
  return html.replace(/(?<!\w)#([^\s#.,?!;:"'()\[\]{}]+)/g, '<span class="custom-tag">#$1</span>')
}

// --- DOM 相关 ---
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

watch(() => props.note.content, () => {
  nextTick(() => {
    checkIfNoteOverflows()
  })
})

// --- 下拉菜单逻辑 ---
function getDropdownOptions(note: any) {
  const charCount = note.content ? note.content.length : 0

  // 格式化创建时间
  const creationDateObj = new Date(note.created_at)
  const creationTime = !note.created_at || Number.isNaN(creationDateObj.getTime())
    ? '未知'
    : creationDateObj.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })

  // 格式化编辑时间
  const updatedDateObj = new Date(note.updated_at)
  const updatedTime = !note.updated_at || Number.isNaN(updatedDateObj.getTime())
    ? '未知'
    : updatedDateObj.toLocaleString('zh-CN', {
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
    { label: t('notes.updated2_at', { time: updatedTime }), key: 'updated2_time', disabled: true },
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
    // --- 修改：删除操作 ---
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
    @dblclick="emit('edit', note)"
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
/* 样式部分无需修改 */
/* 为了方便，我直接使用 Tailwind 的 @apply 指令来整合基础样式 */
.note-card {
  @apply mb-3 block w-full rounded-lg bg-gray-100 shadow-md p-4;
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
  font-size: 13px;
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
  font-size: 13px;
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

:deep(.prose) {
  /*
    注意：这里的 font-size 会被下面的动态类覆盖，
    所以它的值是多少不重要了，但保留 line-height 是好的。
  */
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

/* 关键改动3：为展开状态下的“收起”按钮行添加粘性定位 */
.is-expanded .toggle-button-row {
  position: -webkit-sticky;
  position: sticky;
  bottom: 0rem; /* 粘在卡片底部，-1rem是为了抵消卡片的 padding-bottom */
  z-index: 5;

  /* 为了遮挡下方滚动的内容，需要一个和卡片背景色一致的背景 */
  background-color: #f3f4f6; /* 对应 .bg-gray-100 */

  /* 增加一些视觉效果，让它看起来更像一个独立的栏 */
  /* 使用负边距让背景铺满整个卡片宽度（抵消父元素的padding） */
  margin-left: -1rem;  /* 1rem = 16px, 对应 p-4 */
  margin-right: -1rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid #e5e7eb;
}

.dark .is-expanded .toggle-button-row {
  background-color: #374151; /* 对应 .dark .bg-gray-700 */
  border-top-color: #4b5563;
}

/* 5. 新增：用于动态修改笔记字号的 CSS 规则 */
/* 使用 :deep() 来确保样式能应用到 v-html 渲染出的 .prose 元素上 */
:deep(.prose.font-size-small) {
  font-size: 14px !important;
}

:deep(.prose.font-size-medium) {
  font-size: 17px !important; /* 这是原始的默认大小 */
}

:deep(.prose.font-size-large) {
  font-size: 20px !important;
}

:deep(.prose.font-size-extra-large) {
  font-size: 22px !important;
}

/* In NoteItem.vue's <style scoped> section */
:deep(table) {
  width: auto;
  border-collapse: collapse;
  margin-top: 1em;
  margin-bottom: 1em;
  border: 1px solid #dfe2e5;
  display: table !important; /* Force display property */
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
  /* 强制浏览器在任意字符间断行，以防止长英文单词溢出 */
  word-break: break-all;

  /* 推荐：同时保留您在笔记中输入的回车换行 */
  white-space: pre-wrap;
}
</style>
