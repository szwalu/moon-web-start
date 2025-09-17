<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import { NDropdown, useMessage } from 'naive-ui'
import { useDark } from '@vueuse/core'

import DateTimePickerModal from '@/components/DateTimePickerModal.vue'
import { supabase } from '@/utils/supabaseClient'
import { useSettingStore } from '@/stores/setting.ts'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  note: { type: Object, required: true },
  isExpanded: { type: Boolean, default: false },
  isSelectionModeActive: { type: Boolean, default: false },
  searchQuery: { type: String, default: '' },
  dropdownInPlace: { type: Boolean, default: false },
  // 关键新增：添加开关prop，与您最开始的文件保持一致
  showInternalCollapseButton: { type: Boolean, default: false },
})

// 例：按你当前模板里用到的事件补齐即可
const emit = defineEmits([
  'edit',
  'toggleExpand',
  'copy',
  'pin',
  'delete',
  'date-updated',
  'set-date',
])

const { t } = useI18n()
const isDark = useDark()
const messageHook = useMessage()

const showDatePicker = ref(false)
const noteOverflowStatus = ref(false)
const contentRef = ref<Element | null>(null)

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
}).use(taskLists, { enabled: true, label: true })

const settingsStore = useSettingStore()
const fontSizeClass = computed(() => `font-size-${settingsStore.noteFontSize}`)

// ✅ 新增：日期+星期格式化函数
function formatDateWithWeekday(dateStr: string) {
  const d = new Date(dateStr)
  const dateText = d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const weekday = d.toLocaleDateString('zh-CN', { weekday: 'long' })
  return `${dateText} ${weekday}`
}

function renderMarkdown(content: string) {
  if (!content)
    return ''

  let html = md.render(content)
  html = html.replace(/(?<!\w)#([^\s#.,?!;:"'()\[\]{}]+)/g, '<span class="custom-tag">#$1</span>')
  const query = props.searchQuery.trim()
  if (query) {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escapedQuery, 'gi')
    html = html.replace(regex, match => `<mark class="search-highlight">${match}</mark>`)
  }
  return html
}

function checkIfNoteOverflows() {
  const el = contentRef.value as HTMLElement | null
  if (el)
    noteOverflowStatus.value = el.scrollHeight > el.clientHeight
}

let observer: ResizeObserver | null = null
onMounted(() => {
  if (contentRef.value) {
    observer = new ResizeObserver(() => {
      checkIfNoteOverflows()
    })
    observer.observe(contentRef.value)
    // 确保初始状态正确
    nextTick(() => checkIfNoteOverflows())
  }
})
onUnmounted(() => {
  if (observer)
    observer.disconnect()
})

// 当笔记内容变化时，重新检查
watch(() => props.note.content, () => {
  nextTick(() => {
    checkIfNoteOverflows()
  })
})

// 关键新增：当展开/收起状态变化时，也重新检查
watch(() => props.isExpanded, () => {
  nextTick(() => {
    checkIfNoteOverflows()
  })
})

function getDropdownOptions(note: any) {
  const charCount = note.content ? note.content.length : 0
  const creationTime = new Date(note.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  const updatedTime = new Date(note.updated_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  return [
    { label: t('notes.edit'), key: 'edit' },
    { label: t('notes.copy'), key: 'copy' },
    { label: note.is_pinned ? t('notes.unpin') : t('notes.pin'), key: 'pin' },
    { label: t('notes.delete'), key: 'delete' },
    { label: '设定日期', key: 'set_date' },
    { key: 'divider-1', type: 'divider' },
    {
      key: 'info-block',
      type: 'render',
      render: () => {
        const textColor = isDark.value ? '#aaa' : '#666'
        const pStyle = { margin: '0', padding: '0', lineHeight: '1.8', whiteSpace: 'nowrap', fontSize: '13px', color: textColor } as const
        return h('div', { style: { padding: '4px 12px', cursor: 'default' } }, [
          h('p', { style: pStyle }, t('notes.word_count', { count: charCount })),
          h('p', { style: pStyle }, t('notes.created_at', { time: creationTime })),
          h('p', { style: pStyle }, t('notes.updated2_at', { time: updatedTime })),
        ])
      },
    },
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
    case 'set_date':
      showDatePicker.value = true
      break
    case 'delete':
      emit('delete', props.note.id)
      break
    default:
      break
  }
}

function handleNoteContentClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const listItem = target.closest('li.task-list-item')
  if (!listItem)
    return

  event.stopPropagation()
  const noteCard = event.currentTarget as HTMLElement
  const allListItems = Array.from(noteCard.querySelectorAll('li.task-list-item'))
  const itemIndex = allListItems.indexOf(listItem)
  if (itemIndex !== -1)
    emit('taskToggle', { noteId: props.note.id, itemIndex })
}

async function handleDateUpdate(newDate: Date) {
  showDatePicker.value = false
  if (!props.note || !props.note.id)
    return

  try {
    const newTimestamp = newDate.toISOString()
    const { error } = await supabase.from('notes').update({ created_at: newTimestamp }).eq('id', props.note.id)
    if (error)
      throw error

    messageHook.success('笔记日期更新成功！')
    emit('dateUpdated')
  }
  catch (err: any) {
    messageHook.error(`日期更新失败: ${err.message}`)
  }
}
</script>

<template>
  <!-- ✅ 新增的包裹根：承接父级传入的原生事件，并把双击转成 edit 事件 -->
  <div
    class="note-item"
    @dblclick="emit('edit', note)"
    v-on="$attrs"
  >
    <!-- 原先的根节点移到里面；去掉它自己的 @dblclick -->
    <div
      :data-note-id="note.id"
      class="note-card"
      :class="{ 'is-expanded': isExpanded }"
      @click="handleNoteContentClick"
    >
      <div class="note-card-top-bar">
        <div class="note-meta-left">
          <!-- ✅ 替换日期显示 -->
          <p class="note-date">
            {{ formatDateWithWeekday(note.created_at) }}
          </p>
          <span v-if="note.is_pinned" class="pinned-indicator">
            {{ $t('notes.pin') }}
          </span>
        </div>

        <NDropdown
          trigger="click"
          placement="bottom-end"
          :options="getDropdownOptions(note)"
          :style="{ minWidth: '220px' }"
          :to="props.dropdownInPlace ? false : undefined"
          :z-index="props.dropdownInPlace ? 6001 : undefined"
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
          <div
            v-if="showInternalCollapseButton"
            class="toggle-button-row"
            @click.stop="emit('toggleExpand', note.id)"
          >
            <button class="toggle-button">
              {{ $t('notes.collapse', '收起') }}
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

    <Teleport to="body">
      <DateTimePickerModal
        v-if="showDatePicker"
        :show="showDatePicker"
        :initial-date="new Date(note.created_at)"
        :style="{ zIndex: dropdownInPlace ? 6000 : 100 }"
        @close="showDatePicker = false"
        @confirm="handleDateUpdate"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.note-card {
  /* Tailwind 合成：等价于 rounded + 背景 + 阴影 + padding + margin */
  border-radius: 0.5rem;
  background-color: #f3f4f6; /* gray-100 */
  box-shadow: 0 2px 6px rgba(0,0,0,0.08);
  padding: 1rem;
  margin-bottom: 0.75rem;
}

.dark .note-card {
  background-color: #374151; /* gray-700 */
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
.dark .note-date { color: #aaa; }

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
.dark .pinned-indicator { color: #fde68a; background-color: #78350f; }

.kebab-menu {
  cursor: pointer;
  padding: 2px;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}
.kebab-menu:hover { background-color: rgba(0,0,0,0.1); }
.dark .kebab-menu:hover { background-color: rgba(255,255,255,0.1); }

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
.dark .toggle-button { color: #38bdf8 !important; }
.toggle-button:hover { text-decoration: underline; }

/* 文字内容排版 */
:deep(.prose) {
  font-size: 17px !important;
  line-height: 1.6;
  overflow-wrap: break-word;
}
.line-clamp-3 {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

/* 自定义 tag 样式 */
:deep(.custom-tag) {
  background-color: #eef2ff;
  color: #4338ca;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.875em;
  font-weight: 500;
  margin: 0 2px;
}
.dark :deep(.custom-tag) { background-color: #312e81; color: #c7d2fe; }

:deep(.prose > :first-child) { margin-top: 0 !important; }
:deep(.prose > :last-child)  { margin-bottom: 0 !important; }

/* 不同字号 */
:deep(.prose.font-size-small)        { font-size: 14px !important; }
:deep(.prose.font-size-medium)       { font-size: 17px !important; }
:deep(.prose.font-size-large)        { font-size: 20px !important; }
:deep(.prose.font-size-extra-large)  { font-size: 22px !important; }

/* 表格样式 */
:deep(table) {
  width: auto;
  border-collapse: collapse;
  margin-top: 1em;
  margin-bottom: 1em;
  border: 1px solid #dfe2e5;
  display: table !important;
}
.dark :deep(table) { border-color: #4b5563; }
:deep(th), :deep(td) { padding: 8px 15px; border: 1px solid #dfe2e5; }
.dark :deep(th), .dark :deep(td) { border-color: #4b5563; }
:deep(th) { font-weight: 600; background-color: #f6f8fa; }
.dark :deep(th) { background-color: #374151; }

/* 收起按钮样式 */
.collapse-button {
  background-color: white;
  padding: 4px 12px;
  border-radius: 9999px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.1);
}
.dark .collapse-button {
  background-color: #374151;
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
}

/* dropdown 分割线更细 */
:deep(.n-dropdown-divider) { margin: 2px 0 !important; }

/* 搜索高亮 */
:deep(.search-highlight) {
  background-color: #ffdd77;
  color: #333;
  padding: 0 2px;
  border-radius: 3px;
}
.dark :deep(.search-highlight) {
  background-color: #8f7400;
  color: #f0e6c5;
}
</style>
