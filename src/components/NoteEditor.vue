<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EasyMDE from 'easymde'
import { useSettingStore } from '@/stores/setting'
import 'easymde/dist/easymde.min.css'

// --- Props & Emits 定义 ---
const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as () => any | null, default: null },
  isLoading: { type: Boolean, default: false },
  allTags: { type: Array as () => string[], default: () => [] },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave', 'close'])

// --- 核心状态定义 ---
const { t } = useI18n()
const settingsStore = useSettingStore()
const editorContainerRef = ref<HTMLDivElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const easymde = ref<EasyMDE | null>(null)
const isReadyForAutoSave = ref(false)

const showTagSuggestions = ref(false)
const tagSuggestions = ref<string[]>([])
const suggestionsStyle = ref({ top: '0px', left: '0px' })
const highlightedSuggestionIndex = ref(-1)

const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => { emit('update:modelValue', value) },
})
const charCount = computed(() => contentModel.value.length)
const editorTitle = computed(() => props.editingNote ? t('notes.edit_note') : t('notes.new_note'))

// --- 键盘与视口适配 ---
function handleViewportResize() {
  if (editorContainerRef.value && window.visualViewport) {
    const visualViewport = window.visualViewport
    const editorEl = editorContainerRef.value
    const keyboardHeight = window.innerHeight - visualViewport.height

    if (keyboardHeight > 100) {
      editorEl.style.bottom = `${keyboardHeight}px`
      editorEl.style.height = `${visualViewport.height}px`
      editorEl.style.maxHeight = 'none'
    }
    else {
      editorEl.style.bottom = '0px'
      editorEl.style.height = ''
      editorEl.style.maxHeight = ''
    }

    // ✨✨✨ START: FINAL FIX ✨✨✨
    // 无论键盘是弹出还是收起，只要视口变化，就强制 CodeMirror 刷新。
    // 使用 setTimeout 确保 DOM 尺寸更新先生效，再执行刷新。
    if (easymde.value) {
      setTimeout(() => {
        easymde.value?.codemirror.refresh()
      }, 50) // 一个短暂的延迟
    }
    // ✨✨✨ END: FINAL FIX ✨✨✨
  }
}

// --- EasyMDE 编辑器核心逻辑 ---
function initializeEasyMDE(initialValue = '') {
  // ... (此函数内部无变化)
  if (!textareaRef.value || easymde.value)
    return
  isReadyForAutoSave.value = false

  const mobileToolbar = [
    'bold',
    'italic',
    'heading',
    '|',
    'unordered-list',
    'ordered-list',
    {
      name: 'taskList',
      action: (editor: EasyMDE) => {
        const cm = editor.codemirror
        cm.getDoc().replaceSelection('- [ ] ', cm.getDoc().getCursor())
        cm.focus()
      },
      className: 'fa fa-check-square-o',
      title: 'Task List',
    },
    '|',
    'link',
    'quote',
  ]

  easymde.value = new EasyMDE({
    element: textareaRef.value,
    initialValue,
    spellChecker: false,
    placeholder: t('notes.content_placeholder'),
    toolbar: mobileToolbar,
    status: false,
    minHeight: '100px',
  })

  const cm = easymde.value.codemirror

  applyEditorFontSize()

  cm.on('change', (instance) => {
    const editorContent = easymde.value?.value() ?? ''
    if (contentModel.value !== editorContent)
      contentModel.value = editorContent

    // 检查是否是首次触发
    if (!isReadyForAutoSave.value) {
      // 使用 nextTick 将响应式状态的变更推迟到下一个更新周期
      // 从而避免与 EasyMDE 的内部事件冲突
      nextTick(() => {
        isReadyForAutoSave.value = true
      })
    }
    else {
      emit('triggerAutoSave')
    }

    handleTagSuggestions(instance)
    // 注意：之前版本中多余的 scrollIntoView 也在此一并移除，以获得更稳定的体验
  })

  cm.on('keydown', (cm, event) => {
    if (showTagSuggestions.value && tagSuggestions.value.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveSuggestionSelection(1)
      }
      else if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveSuggestionSelection(-1)
      }
      else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        selectTag(tagSuggestions.value[highlightedSuggestionIndex.value])
      }
      else if (event.key === 'Escape') {
        event.preventDefault()
        showTagSuggestions.value = false
      }
    }
  })

  focusEditor()
}

// ... (其他JS函数 handleClose, focusEditor, selectTag 等均无变化)
function destroyEasyMDE() {
  if (easymde.value) {
    easymde.value.toTextArea()
    easymde.value = null
  }
}

function applyEditorFontSize() {
  if (easymde.value) {
    const cmWrapper = easymde.value.codemirror.getWrapperElement()
    cmWrapper.classList.remove('font-size-small', 'font-size-medium', 'font-size-large')
    cmWrapper.classList.add(`font-size-${settingsStore.noteFontSize}`)
  }
}

function focusEditor() {
  if (!easymde.value)
    return

  nextTick(() => {
    const cm = easymde.value!.codemirror
    cm.focus()
    const doc = cm.getDoc()
    doc.setCursor(doc.lastLine(), doc.getLine(doc.lastLine()).length)
    cm.scrollIntoView(null)
    // 首次加载时也强制刷新一下，确保万无一失
    setTimeout(() => cm.refresh(), 50)
  })
}

function handleTagSuggestions(cm: CodeMirror.Editor) {
  const cursor = cm.getDoc().getCursor()
  const line = cm.getDoc().getLine(cursor.line)
  const textBefore = line.substring(0, cursor.ch)
  const lastHashIndex = textBefore.lastIndexOf('#')

  if (lastHashIndex === -1 || /\s/.test(textBefore.substring(lastHashIndex + 1))) {
    showTagSuggestions.value = false
    return
  }

  const term = textBefore.substring(lastHashIndex + 1)
  tagSuggestions.value = props.allTags.filter(tag =>
    tag.toLowerCase().startsWith(`#${term.toLowerCase()}`),
  )

  if (tagSuggestions.value.length > 0) {
    const coords = cm.cursorCoords()
    suggestionsStyle.value = { top: `${coords.bottom + 5}px`, left: `${coords.left}px` }
    showTagSuggestions.value = true
    highlightedSuggestionIndex.value = 0
  }
  else {
    showTagSuggestions.value = false
  }
}

function selectTag(tag: string) {
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
    doc.replaceRange(`${tag} `, start, cursor)
  }
  showTagSuggestions.value = false
  cm.focus()
}

function moveSuggestionSelection(offset: number) {
  const count = tagSuggestions.value.length
  highlightedSuggestionIndex.value = (highlightedSuggestionIndex.value + offset + count) % count
}

async function fetchWeather() {
  return null
}

function handleSubmit() {
  emit('submit')
}

function handleClose() {
  emit('close')
}

// --- 生命周期钩子 ---
onMounted(async () => {
  let initialContent = props.modelValue
  if (!props.editingNote && !initialContent) {
    const weatherString = await fetchWeather()
    if (weatherString) {
      initialContent = `${weatherString}\n`
      emit('update:modelValue', initialContent)
    }
  }

  initializeEasyMDE(initialContent)

  window.visualViewport?.addEventListener('resize', handleViewportResize)
  handleViewportResize()
})

onUnmounted(() => {
  destroyEasyMDE()
  window.visualViewport?.removeEventListener('resize', handleViewportResize)
})

watch(() => settingsStore.noteFontSize, applyEditorFontSize)

watch(() => props.editingNote?.id, () => {
  destroyEasyMDE()
  nextTick(() => {
    initializeEasyMDE(props.modelValue)
  })
})
</script>

<template>
  <div ref="editorContainerRef" class="note-editor-container">
    <div class="editor-header">
      <h2 class="editor-title">
        {{ editorTitle }}
      </h2>
      <button class="close-btn" type="button" aria-label="Close editor" @click="handleClose">
        &times;
      </button>
    </div>

    <form class="editor-form" autocomplete="off" @submit.prevent="handleSubmit">
      <textarea ref="textareaRef" style="display: none;" />
      <div
        v-if="showTagSuggestions && tagSuggestions.length"
        class="tag-suggestions"
        :style="suggestionsStyle"
      >
        <ul>
          <li
            v-for="(tag, index) in tagSuggestions"
            :key="tag"
            :class="{ highlighted: index === highlightedSuggestionIndex }"
            @mousedown.prevent="selectTag(tag)"
          >
            {{ tag }}
          </li>
        </ul>
      </div>
    </form>

    <div class="editor-footer">
      <div class="status-bar">
        <span class="char-counter">
          {{ charCount }}/{{ maxNoteLength }}
        </span>
        <span v-if="lastSavedTime" class="save-status">
          💾 {{ lastSavedTime }}
        </span>
      </div>
      <button
        type="button"
        class="submit-btn"
        :disabled="isLoading || !contentModel"
        @click="handleSubmit"
      >
        {{ isLoading ? $t('notes.saving') : $t('notes.save_note') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 此处 scoped 样式与上一版完全相同，无需修改 */
/* --- 主容器与布局 --- */
.note-editor-container {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  z-index: 1002;

  background-color: #ffffff;
  border-top: 1px solid #e5e7eb;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.08);

  max-height: 90vh;
  margin: 0 auto;
  max-width: 640px;
  left: 50%;
  transform: translateX(-50%);
  border-radius: 12px 12px 0 0;

  display: flex;
  flex-direction: column;

  will-change: height, bottom;
  transition: bottom 0.2s ease-out, height 0.2s ease-out;

  padding-bottom: env(safe-area-inset-bottom);
}

.dark .note-editor-container {
  background-color: #1e1e1e;
  border-top-color: #3a3a3c;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.25);
}

.editor-form {
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
}

/* --- 顶部操作栏 --- */
.editor-header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}
.dark .editor-header {
  border-bottom-color: #3a3a3c;
}
.editor-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #111827;
}
.dark .editor-title {
  color: #f3f4f6;
}
.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  line-height: 1;
  color: #6b7280;
  cursor: pointer;
  padding: 0;
}
.dark .close-btn {
  color: #9ca3af;
}

/* --- 底部状态与动作栏 --- */
.editor-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-top: 1px solid #e5e7eb;
  gap: 16px;
}
.dark .editor-footer {
  border-top-color: #3a3a3c;
}
.status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #6b7280;
}
.dark .status-bar {
  color: #9ca3af;
}
.submit-btn {
  background-color: #00b386;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}
.submit-btn:hover {
  background-color: #009a74;
}
.submit-btn:disabled {
  background-color: #a5a5a5;
  cursor: not-allowed;
  opacity: 0.7;
}
.dark .submit-btn:disabled {
  background-color: #4b5563;
}

/* --- 标签建议样式 --- */
.tag-suggestions {
  position: absolute;
  background-color: #fff;
  border: 1px solid #ccc;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 1010;
  max-height: 150px;
  overflow-y: auto;
  min-width: 120px;
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
}
.tag-suggestions li:hover,
.tag-suggestions li.highlighted {
  background-color: #f0f0f0;
}
.dark .tag-suggestions li:hover,
.dark .tag-suggestions li.highlighted {
  background-color: #404040;
}
</style>

<style>
/* 此处全局样式与上一版完全相同，无需修改 */
/* --- 全局样式，用于覆盖 EasyMDE 默认样式 --- */
.editor-form > .EasyMDEContainer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: none !important;
}

.editor-toolbar {
  border: none !important;
  border-bottom: 1px solid #e5e7eb !important;
  border-radius: 0 !important;
  background-color: #ffffff;
  padding: 4px 8px !important;
  flex-shrink: 0;
  overflow-x: auto;
}
.dark .editor-toolbar {
  background-color: #1e1e1e !important;
  border-bottom-color: #3a3a3c !important;
}
.dark .editor-toolbar a {
  color: #d1d5db !important;
}
.dark .editor-toolbar a.active {
  background-color: #374151 !important;
}

.CodeMirror {
  flex: 1 !important;
  height: auto !important;

  border: none !important;
  border-radius: 0 !important;
  padding: 12px;
  font-size: 16px !important;
  line-height: 1.6 !important;
}
.dark .CodeMirror {
  background-color: #1e1e1e !important;
  color: #f3f4f6 !important;
}
.dark .CodeMirror-cursor {
  border-left-color: #f3f4f6 !important;
}

.CodeMirror.font-size-small { font-size: 14px !important; }
.CodeMirror.font-size-medium { font-size: 16px !important; }
.CodeMirror.font-size-large { font-size: 20px !important; }
</style>
