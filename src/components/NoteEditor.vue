<script setup lang="ts">
// --- <script setup> 部分与之前完全一样，无需改动 ---
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EasyMDE from 'easymde'
import 'easymde/dist/easymde.min.css'

const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as () => any | null, default: null },
  isLoading: { type: Boolean, default: false },
  allTags: { type: Array as () => string[], default: () => [] },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'submit'])

const { t } = useI18n()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const easymde = ref<EasyMDE | null>(null)
const showEditorTagSuggestions = ref(false)
const editorTagSuggestions = ref<string[]>([])
const editorSuggestionsStyle = ref({ top: '0px', left: '0px' })
const highlightedEditorIndex = ref(-1)
const editorSuggestionsRef = ref<HTMLDivElement | null>(null)
// --- 升级后的代码 ---
const minEditorHeight = 130

// 判断是否为小屏幕（通常指手机或窄浏览器窗口）
const isSmallScreen = window.innerWidth < 768

let maxEditorHeight

if (isSmallScreen) {
  // --- 移动端/小屏幕设置 ---
  // 设置为屏幕可见高度的 65%，感觉不够可以调高这个值（比如 0.7）
  maxEditorHeight = window.innerHeight * 0.65
}
else {
  // --- 桌面端/大屏幕设置 ---
  // 设置为屏幕可见高度的 75%，但最高不超过 800px
  // 这样既能自适应窗口大小，又能避免在超大显示器上编辑器区域过高
  maxEditorHeight = Math.min(window.innerHeight * 0.75, 800)
}

const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => { emit('update:modelValue', value) },
})

const charCount = computed(() => contentModel.value.length)

function updateEditorHeight() {
  if (!easymde.value)
    return
  const cm = easymde.value.codemirror
  const sizer = cm.display.sizer
  if (!sizer)
    return
  const contentHeight = sizer.scrollHeight + 5
  const newHeight = Math.max(minEditorHeight, Math.min(contentHeight, maxEditorHeight))
  cm.setSize(null, newHeight)
}

function destroyEasyMDE() {
  if (easymde.value) {
    easymde.value.toTextArea()
    easymde.value = null
  }
}

function initializeEasyMDE(initialValue = '') {
  const newEl = textareaRef.value
  if (!newEl || easymde.value)
    return

  const customToolbar = [
    {
      name: 'tag',
      action: (editor: any) => {
        const cm = editor.codemirror
        cm.getDoc().replaceSelection('#')
        cm.focus()
        editorTagSuggestions.value = props.allTags
        if (editorTagSuggestions.value.length > 0) {
          const coords = cm.cursorCoords()
          editorSuggestionsStyle.value = { top: `${coords.bottom + 5}px`, left: `${coords.left}px` }
          showEditorTagSuggestions.value = true
          highlightedEditorIndex.value = 0
        }
      },
      className: 'fa fa-tag',
      title: '插入标签 (Insert Tag)',
    },
    '|',
    'bold',
    'italic',
    'heading',
    '|',
    'quote',
    'unordered-list',
    'ordered-list',
    {
      name: 'taskList',
      action: (editor: any) => {
        editor.codemirror.getDoc().replaceRange('- [ ] ', editor.codemirror.getDoc().getCursor())
        editor.codemirror.focus()
      },
      className: 'fa fa-check-square-o',
      title: 'Task List',
    },
    '|',
    'link',
    'table',
    '|',
    'preview',
    'side-by-side',
    'fullscreen',
  ]

  easymde.value = new EasyMDE({
    element: newEl,
    initialValue,
    spellChecker: false,
    placeholder: t('notes.content_placeholder'),
    toolbar: customToolbar,
    status: false,
  })

  const cm = easymde.value.codemirror
  cm.on('change', (instance: any) => {
    const editorContent = easymde.value?.value() ?? ''
    if (contentModel.value !== editorContent)
      contentModel.value = editorContent

    nextTick(() => updateEditorHeight())
    const cursor = instance.getDoc().getCursor()
    const line = instance.getDoc().getLine(cursor.line)
    const textBefore = line.substring(0, cursor.ch)
    const lastHashIndex = textBefore.lastIndexOf('#')
    if (lastHashIndex === -1 || (textBefore[lastHashIndex - 1] && /\w/.test(textBefore[lastHashIndex - 1]))) {
      showEditorTagSuggestions.value = false
      return
    }
    const potentialTag = textBefore.substring(lastHashIndex)
    if (potentialTag[1] === ' ' || potentialTag.includes('#', 1) || /\s/.test(potentialTag)) {
      showEditorTagSuggestions.value = false
      return
    }
    const term = potentialTag.substring(1)
    editorTagSuggestions.value = props.allTags.filter(tag => tag.toLowerCase().includes(term.toLowerCase()))
    if (editorTagSuggestions.value.length > 0) {
      const coords = instance.cursorCoords()
      editorSuggestionsStyle.value = { top: `${coords.bottom + 5}px`, left: `${coords.left}px` }
      showEditorTagSuggestions.value = true
      highlightedEditorIndex.value = 0
    }
    else {
      showEditorTagSuggestions.value = false
    }
  })
  cm.on('keydown', handleEditorKeyDown)
  nextTick(() => updateEditorHeight())
}
function selectEditorTag(tag: string) {
  if (!easymde.value)
    return
  const cm = easymde.value.codemirror
  const doc = cm.getDoc()
  const cursor = doc.getCursor()
  const line = doc.getLine(cursor.line)
  const textBeforeCursor = line.substring(0, cursor.ch)
  const lastHashIndex = textBeforeCursor.lastIndexOf('#')
  if (lastHashIndex !== -1) {
    const start = { line: cursor.line, ch: lastHashIndex }
    const end = cursor
    doc.replaceRange(`${tag} `, start, end)
  }
  showEditorTagSuggestions.value = false
  cm.focus()
}
function moveEditorSelection(offset: number) {
  if (showEditorTagSuggestions.value)
    highlightedEditorIndex.value = (highlightedEditorIndex.value + offset + editorTagSuggestions.value.length) % editorTagSuggestions.value.length
}
function handleEditorKeyDown(cm: any, event: KeyboardEvent) {
  if (showEditorTagSuggestions.value && editorTagSuggestions.value.length > 0) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveEditorSelection(1)
    }
    else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveEditorSelection(-1)
    }
    else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      selectEditorTag(editorTagSuggestions.value[highlightedEditorIndex.value])
    }
    else if (event.key === 'Escape') {
      event.preventDefault()
      showEditorTagSuggestions.value = false
    }
  }
}
onMounted(() => {
  initializeEasyMDE(props.modelValue)
})
onUnmounted(() => {
  destroyEasyMDE()
})
watch(() => props.modelValue, (newValue) => {
  if (easymde.value && newValue !== easymde.value.value())
    easymde.value.value(newValue)
})
watch(() => props.editingNote, (newNote, oldNote) => {
  if (newNote?.id !== oldNote?.id) {
    destroyEasyMDE()
    nextTick(() => {
      initializeEasyMDE(props.modelValue)
      if (easymde.value) {
        const cm = easymde.value.codemirror
        const doc = cm.getDoc()
        const lastLine = doc.lastLine()
        doc.setCursor(lastLine, doc.getLine(lastLine).length)
        cm.focus()
      }
    })
  }
}, { deep: true })
function handleSubmit() {
  emit('submit')
}
</script>

<template>
  <div>
    <form class="mb-6" autocomplete="off" @submit.prevent="handleSubmit">
      <textarea
        ref="textareaRef"
        v-model="contentModel"
        :placeholder="$t('notes.content_placeholder')"
        class="mb-2 w-full border rounded p-2"
        required
        :disabled="isLoading"
        :maxlength="maxNoteLength"
        autocomplete="off"
      />
      <div class="status-bar">
        <span class="char-counter">
          {{ t('notes.char_count') }}: {{ charCount }}/{{ maxNoteLength }}
        </span>
        <span v-if="lastSavedTime" class="char-counter ml-4">
          💾 {{ t('notes.auto_saved_at') }}: {{ lastSavedTime }}
        </span>
      </div>
      <div class="emoji-bar">
        <button
          type="submit"
          class="form-button flex-2"
          :disabled="isLoading || !contentModel"
        >
          💾 {{ isLoading ? $t('notes.saving') : editingNote ? $t('notes.update_note') : $t('notes.save_note') }}
        </button>
      </div>
    </form>
    <div
      v-if="showEditorTagSuggestions && editorTagSuggestions.length"
      ref="editorSuggestionsRef"
      class="tag-suggestions editor-suggestions"
      :style="editorSuggestionsStyle"
    >
      <ul>
        <li
          v-for="(tag, index) in editorTagSuggestions"
          :key="tag"
          :class="{ highlighted: index === highlightedEditorIndex }"
          @mousedown.prevent="selectEditorTag(tag)"
        >
          {{ tag }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.info-label {
  display: block;
  text-align: center;
  font-size: 18px;
  margin-bottom: 0.5rem;
  color: #555;
  font-weight: bold;
}
.dark .info-label {
  color: #adadad;
}

/* 隐藏原始的 textarea，因为 EasyMDE 会创建自己的UI */
textarea {
  visibility: hidden;
}

.status-bar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  margin: 0;
}

.char-counter {
  font-size: 12px;
  color: #999;
}
.dark .char-counter {
  color: #aaa;
}
.ml-4 {
  margin-left: 1rem;
}

.emoji-bar {
  margin-top: 0.2rem;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.form-button {
  width: 100%;
  flex: 1;
  padding: 0.5rem;
  font-size: 14px;
  border-radius: 6px;
  border: 1px solid #ccc;
  cursor: pointer;
  background: #d3d3d3;
  color: #111;
}
.dark .form-button {
  background-color: #404040;
  color: #fff;
  border-color: #555;
}

.form-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tag-suggestions {
  position: absolute;
  background-color: white;
  border: 1px solid #ccc;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 1000;
  max-height: 200px;
  overflow-y: auto;
  min-width: 150px;
}
.dark .tag-suggestions {
  background-color: #2c2c2e;
  border-color: #48484a;
}
.tag-suggestions ul {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}
.tag-suggestions li {
  padding: 6px 12px;
  cursor: pointer;
  font-size: 14px;
  white-space: nowrap;
}
.tag-suggestions li:hover,
.tag-suggestions li.highlighted {
  background-color: #f0f0f0;
}
.dark .tag-suggestions li:hover,
.dark .tag-suggestions li.highlighted {
  background-color: #404040;
}
.editor-suggestions {
  position: absolute;
}
</style>

<style>
/* --- EasyMDE 编辑器样式最终整合版 --- */

/* 编辑器工具栏的基础和吸顶样式 */
.editor-toolbar {
  padding: 1px 3px !important;
  min-height: 0 !important;
  border: 1px solid #ccc;
  border-bottom: none !important;
  border-radius: 6px 6px 0 0;
  position: -webkit-sticky;
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: #fff;
}

/* 编辑器输入区域的基础样式 */
.CodeMirror {
  border: 1px solid #ccc !important;
  border-top: none !important;
  border-radius: 0 0 6px 6px;
  font-size: 16px !important;
  line-height: 1.6 !important;
  overscroll-behavior: contain;
}

/* 编辑器工具栏按钮和图标的通用样式 (PC端优化版) */
.editor-toolbar a,
.editor-toolbar button {
  padding-left: 2px !important;
  padding-right: 2px !important;
  padding-top: 1px !important;
  padding-bottom: 1px !important;
  line-height: 1 !important;
  height: auto !important;
  min-height: 0 !important;
  display: inline-flex !important;
  align-items: center !important;
}

.editor-toolbar a i,
.editor-toolbar button i {
  font-size: 15px !important;
  vertical-align: middle;
}

.editor-toolbar i.separator {
  margin: 1px 3px !important;
  border-width: 0 1px 0 0 !important;
  height: 8px !important;
}

/* --- 暗黑模式的覆盖样式 --- */
.dark .editor-toolbar {
  background-color: #2c2c2e !important;
  border-color: #48484a !important;
}
.dark .CodeMirror {
  background-color: #2c2c2e !important;
  border-color: #48484a !important;
  color: #ffffff !important;
}
.dark .editor-toolbar a {
  color: #e0e0e0 !important;
}
.dark .editor-toolbar a.active {
  background: #404040 !important;
}

/* --- [新增] 移动端响应式处理 --- */
@media (max-width: 480px) {
  .editor-toolbar {
    overflow-x: auto; /* 允许X轴（水平）滚动 */
    white-space: nowrap; /* 禁止元素换行 */
    -webkit-overflow-scrolling: touch; /* 在iOS上提供更流畅的滚动体验 */
  }

  /* 隐藏滚动条，让界面更干净 */
  .editor-toolbar::-webkit-scrollbar {
    display: none;
    height: 0;
  }
}
</style>
