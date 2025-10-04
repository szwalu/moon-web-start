<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import { NDropdown, useMessage } from 'naive-ui'
import ins from 'markdown-it-ins'
import { useDark } from '@vueuse/core'

import mark from 'markdown-it-mark'
import linkAttrs from 'markdown-it-link-attributes'
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
  showInternalCollapseButton: { type: Boolean, default: false },
})

const emit = defineEmits([
  'edit',
  'toggleExpand',
  'copy',
  'pin',
  'delete',
  'date-updated',
  'set-date',
  'taskToggle',
  'dateUpdated',
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
})
  .use(taskLists, { enabled: true, label: true })
  .use(mark)
  .use(ins)
  .use(linkAttrs, {
    attrs: {
      target: '_blank',
      rel: 'noopener noreferrer',
    },
  })

const settingsStore = useSettingStore()
const fontSizeClass = computed(() => `font-size-${settingsStore.noteFontSize}`)

// ✅ 仅“几日”加粗，其余（时间/周几）常规
function formatDateWithWeekday(dateStr: string) {
  const d = new Date(dateStr)
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const weekdayMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const weekday = weekdayMap[d.getDay()]
  return `<span class="date-day">${day}日</span> ${weekday} ${hh}:${mm}`
}

const weatherDisplay = computed(() => {
  const w = String(props.note?.weather ?? '').trim()
  return w || ''
})

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
    nextTick(() => {
      checkIfNoteOverflows()
    })
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

// 展开/收起状态变化时，也重新检查
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
    case 'edit': {
      emit('edit', props.note)
      break
    }
    case 'copy': {
      emit('copy', props.note.content)
      break
    }
    case 'pin': {
      emit('pin', props.note)
      break
    }
    case 'set_date': {
      showDatePicker.value = true
      break
    }
    case 'delete': {
      emit('delete', props.note.id)
      break
    }
    default: {
      break
    }
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
    const { error } = await supabase
      .from('notes')
      .update({ created_at: newTimestamp })
      .eq('id', props.note.id)
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
  <div class="note-item" @dblclick="emit('edit', note)" v-on="$attrs">
    <div
      :data-note-id="note.id"
      class="note-card"
      :class="{ 'is-expanded': isExpanded }"
      @click="handleNoteContentClick"
    >
      <div class="note-card-top-bar">
        <div class="note-meta-left">
          <span v-if="note.is_pinned" class="pinned-indicator">
            {{ $t('notes.pin') }}
          </span>

          <!-- 日期（几日）加粗；时间/周几常规；天气同一行 -->
          <p class="note-date" v-html="formatDateWithWeekday(note.created_at)" />
          <span v-if="weatherDisplay" class="weather-inline">
            · {{ weatherDisplay }}
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
            class="note-content prose dark:prose-invert max-w-none"
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
            class="prose dark:prose-invert note-content line-clamp-3 max-w-none"
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
  border-radius: 0.5rem;
  background-color: #f3f4f6;
  box-shadow: 0 2px 6px rgba(0,0,0,0.08);
  padding: 1rem;
  margin-bottom: 0.75rem;
}
.dark .note-card {
  background-color: #374151;
}

.note-card-top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  height: 24px;
}

.note-date {
  font-size: 14px;
  font-weight: 400; /* 整体常规字重 */
  color: #333;
  margin: 0;
  padding: 0;
  text-align: left;
}
.dark .note-date {
  color: #f0f0f0;
}

/* v-html 注入的元素不带作用域，必须用 :deep 才能命中 */
:deep(.date-day) {
  font-weight: 700 !important; /* 仅“几日”加粗 */
  font-size: 16px !important;  /* ← 加这一行即可，原来是跟随 14px，现在稍大 */
}

.note-meta-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.weather-inline {
  margin-left: 2px;
}

.pinned-indicator {
  font-size: 13px;
  font-weight: 600;
  color: #888;
  background-color: transparent;
  padding: 2px 6px;
  line-height: 1;
}
.dark .pinned-indicator {
  color: #aaa;
  background-color: transparent;
}

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
.kebab-menu:hover {
  background-color: rgba(0,0,0,0.1);
}
.dark .kebab-menu:hover {
  background-color: rgba(255,255,255,0.1);
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
  font-family: 'KaiTi','BiauKai','楷体','Apple LiSung',serif,sans-serif;
}
.dark .toggle-button {
  color: #38bdf8 !important;
}
.toggle-button:hover {
  text-decoration: underline;
}

/* 内容排版 */
/* 默认：桌面端 */
:deep(.prose) {
  font-size: 17px !important;
  line-height: 2.0; /* 桌面端更宽松 */
  overflow-wrap: break-word;
}

/* 移动端（屏幕宽度 <= 768px 时） */
@media (max-width: 768px) {
  :deep(.prose) {
    line-height: 1.7; /* 移动端稍紧凑 */
    overflow-wrap: break-word;
  }
}
.line-clamp-3 {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

/* 自定义 tag */
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

:deep(.prose.font-size-small) {
  font-size: 14px !important;
}
:deep(.prose.font-size-medium) {
  font-size: 17px !important;
}
:deep(.prose.font-size-large) {
  font-size: 20px !important;
}
:deep(.prose.font-size-extra-large) {
  font-size: 22px !important;
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
:deep(th), :deep(td) {
  padding: 8px 15px;
  border: 1px solid #dfe2e5;
}
.dark :deep(th), .dark :deep(td) {
  border-color: #4b5563;
}
:deep(th) {
  font-weight: 600;
  background-color: #f6f8fa;
}
.dark :deep(th) {
  background-color: #374151;
}

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

:deep(.n-dropdown-divider) {
  margin: 2px 0 !important;
}

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

:deep(ins) {
  text-decoration: underline;
  text-underline-offset: 2px; /* 可选：下划线与文字距离 */
}
/* 让 Tailwind Typography 的链接色变量变成你要的蓝色 */
.note-content {
  /* 亮色模式链接色 */
  --tw-prose-links: #2563eb;
}
.dark .note-content {
  /* 暗色模式链接色（Typography 的反相变量） */
  --tw-prose-invert-links: #60a5fa;
}

/* 直接命中渲染出来的 <a>（v-html 的内容需用 :deep 才能选中） */
.note-content :deep(a),
.note-content :deep(a:visited) {
  color: #2563eb !important;
  text-decoration: underline !important;
}
.note-content :deep(a:hover) {
  color: #1d4ed8 !important;
}
/* 暗色模式下更亮一些 */
.dark .note-content :deep(a),
.dark .note-content :deep(a:visited) {
  color: #60a5fa !important;
}

/* 1) 统一把列表上下的外边距收紧（不影响段落自身行高） */
.note-content :deep(ul),
.note-content :deep(ol) {
  margin-top: 0.35em;
  margin-bottom: 0.35em;
  padding-left: 1.2em;
}

/* 2) 普通段落的上下外边距略收紧（避免整体过稀） */
.note-content :deep(p) {
  margin-top: 0.4em;
  margin-bottom: 0.4em;
}

/* 3) 关键：当“段落后面紧跟列表”时，把两者之间的间距进一步压小
   - 现代浏览器（含新 iOS Safari）支持 :has，精准只影响相邻场景 */
@supports(selector(:has(+ *))) {
  .note-content :deep(p:has(+ ul)),
  .note-content :deep(p:has(+ ol)),
  .note-content :deep(p:has(+ ul.task-list)) {
    margin-bottom: 0.15em; /* ← 决定红框这块的高度 */
  }
}

/* 4) 任务列表的复选框细节（防止复选框把行拉高） */
.note-content :deep(li.task-list-item) {
  line-height: inherit;
  margin: 0;
  padding: 0;
}
.note-content :deep(li.task-list-item > label) {
  display: inline;
  margin: 0;
  line-height: inherit;
}
.note-content :deep(li.task-list-item input[type="checkbox"]) {
  vertical-align: middle;
  margin: 0 0.45em 0 0;
  line-height: 1;
  transform: translateY(-0.5px);
}

/* 5) 有些渲染器会在 li 里包 <p>，把它变成内联，避免额外间距 */
.note-content :deep(li > p) {
  display: inline;
  margin: 0;
  line-height: inherit;
}
</style>
