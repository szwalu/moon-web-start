<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'

import { NDropdown, useDialog, useMessage } from 'naive-ui'

// 引入 useMessage 用于提示
import DateTimePickerModal from '@/components/DateTimePickerModal.vue'
import { supabase } from '@/utils/supabaseClient'

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
  // 新增：在这里正式声明 isSelectionModeActive 这个 prop
  isSelectionModeActive: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['edit', 'copy', 'pin', 'delete', 'toggleExpand', 'taskToggle', 'dateUpdated'])

// --- 初始化 & 状态 ---
const { t } = useI18n()
const messageHook = useMessage() // 初始化 message
const showDatePicker = ref(false) // 控制日期选择器显示的状态
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

let observer: ResizeObserver | null = null

onMounted(() => {
  if (contentRef.value) {
    // 创建一个 ResizeObserver 实例，每当尺寸变化时就重新检查是否溢出
    observer = new ResizeObserver(() => {
      checkIfNoteOverflows()
    })
    // 开始监视文本内容区域
    observer.observe(contentRef.value)
  }
})

// 在组件卸载时，停止监视，防止内存泄漏
onUnmounted(() => {
  if (observer)
    observer.disconnect()
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
    { label: '设定日期', key: 'set_date' },
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
    case 'set_date': // <-- 新增
      showDatePicker.value = true
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

async function handleDateUpdate(newDate: Date) {
  showDatePicker.value = false // 关闭选择器
  if (!props.note || !props.note.id)
    return

  try {
    const newTimestamp = newDate.toISOString()
    const { error } = await supabase
      .from('notes')
      .update({ created_at: newTimestamp })
      .eq('id', props.note.id)

    if (error)
      throw error

    messageHook.success('笔记日期更新成功！')
    emit('dateUpdated') // 通知父组件日期已更新
  }
  catch (err: any) {
    messageHook.error(`日期更新失败: ${err.message}`)
  }
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

      <NDropdown
        trigger="click"
        placement="bottom-end"
        :options="getDropdownOptions(note)"
        @select="handleDropdownSelect"
      >
        <div class="kebab-menu">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M6 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0a2 2 0 0 1 4 0z" /></svg>
        </div>
      </NDropdown>
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

  <DateTimePickerModal
    :show="showDatePicker"
    :initial-date="new Date(note.created_at)"
    @close="showDatePicker = false"
    @confirm="handleDateUpdate"
  />
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
  overflow-wrap: break-word; /* 新增：允许在长单词内部换行 */
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
  bottom: 1.5rem;
  z-index: 5;

  /* 背景和边框都设置为透明或移除 */
  background-color: transparent;
  border-top: none;

  /* 保留 padding 以提供更好的点击体验 */
  padding: 0.75rem 1rem;
}

.dark .is-expanded .toggle-button-row {
  /* 暗黑模式下也一样，确保背景和边框是透明的 */
  background-color: transparent;
  border-top: none;
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

/* 新增：为“收起”按钮本身添加白色背景和胶囊样式 */
.collapse-button {
  background-color: white;
  padding: 4px 12px; /* 增加内边距，让背景比文字大一点 */
  border-radius: 9999px; /* 使用一个很大的值来制作胶囊形状的圆角 */
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1); /* 添加一点阴影，让它有悬浮感 */
}

/* 新增：暗黑模式下的“收起”按钮样式 */
.dark .collapse-button {
  background-color: #374151; /* 使用一个深色背景 */
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}
</style>

<style>
/* 注意：这个 style 标签没有 scoped 属性 */

/* 1. 针对被禁用的信息项（如字数、日期）的容器 */
.n-dropdown-option.n-dropdown-option--disabled {
  min-height: auto !important; /* 覆盖 naive-ui 的最小高度限制 */
}

/* 2. 针对这些信息项的内部内容区域 */
.n-dropdown-option.n-dropdown-option--disabled .n-dropdown-option-body {
  height: 12px !important; /* 关键：强制设定一个更小的高度 */
  padding-top: 0 !important; /* 移除上内边距 */
  padding-bottom: 0 !important; /* 移除下内边距 */
  font-size: 13px !important; /* 保持较小的字体 */
  line-height: 22px !important; /* 让文字在新的高度里垂直居中 */
}

/* 3. 针对分割线 */
.n-dropdown-divider {
  margin-top: 3px !important;
  margin-bottom: 3px !important;
}
</style>
