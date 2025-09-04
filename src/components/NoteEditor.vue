<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EasyMDE from 'easymde'
import type CodeMirror from 'codemirror'
import { useSettingStore } from '@/stores/setting'
import 'easymde/dist/easymde.min.css'

// --- Props & Emits ---
const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as () => any | null, default: null },
  isLoading: { type: Boolean, default: false },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
  allTags: { type: Array as () => string[], default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave', 'close'])

// --- 核心状态 ---
const { t } = useI18n()
const settingsStore = useSettingStore()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const easymde = ref<EasyMDE | null>(null)
const isReadyForAutoSave = ref(false)
const MAX_EDITOR_HEIGHT = window.innerHeight * 0.6

// --- 标签功能所需的状态变量 ---
const showAllTagsPanel = ref(false)
const showTagSuggestions = ref(false)
const tagSuggestions = ref<string[]>([])
const suggestionsStyle = ref({ top: '0px', left: '0px' })
const highlightedSuggestionIndex = ref(-1)

const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => { emit('update:modelValue', value) },
})
const charCount = computed(() => contentModel.value.length)

// --- 光标和高度函数 ---
function ensureCursorVisible() {
  if (!easymde.value || !window.visualViewport)
    return

  const cm = easymde.value.codemirror
  const cursorCoords = cm.cursorCoords(true, 'page')
  const viewportBottom = window.visualViewport.offsetTop + window.visualViewport.height
  const scrollOffset = cursorCoords.bottom - viewportBottom + 10
  if (scrollOffset > 0)
    window.scrollBy({ top: scrollOffset, behavior: 'smooth' })
}

function updateEditorHeight() {
  if (!easymde.value)
    return

  const cm = easymde.value.codemirror
  const wrapper = cm.getWrapperElement()
  const scroller = cm.getScrollerElement()
  wrapper.style.height = 'auto'
  scroller.style.height = 'auto'
  const contentHeight = Math.max(scroller.scrollHeight, 30)
  const finalHeight = Math.min(contentHeight, MAX_EDITOR_HEIGHT)
  wrapper.style.height = `${finalHeight}px`
  scroller.style.height = `${finalHeight}px`
}

function handleClose() {
  emit('close')
}

// --- 标签功能所需的全部函数 ---
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
    const coords = cm.cursorCoords(true, 'local')
    suggestionsStyle.value = { top: `${coords.bottom}px`, left: `${coords.left}px` }
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

function insertTag(tag: string) {
  if (!easymde.value)
    return

  const cm = easymde.value.codemirror
  cm.getDoc().replaceSelection(`${tag} `)
  showAllTagsPanel.value = false
  cm.focus()
}

function moveSuggestionSelection(offset: number) {
  const count = tagSuggestions.value.length
  if (count === 0)
    return

  highlightedSuggestionIndex.value = (highlightedSuggestionIndex.value + offset + count) % count
}

// --- EasyMDE 编辑器核心逻辑 ---
function initializeEasyMDE(initialValue = '') {
  if (!textareaRef.value || easymde.value)
    return

  isReadyForAutoSave.value = false

  const mobileToolbar: (EasyMDE.ToolbarIcon | string)[] = [
    {
      name: 'tags',
      action: () => {
        showAllTagsPanel.value = !showAllTagsPanel.value
      },
      className: 'fa fa-tags',
      title: 'Tags',
    },
    'bold',
    'italic',
    'heading',
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
    'link',
    'image',
    'quote',
    {
      name: 'spacer',
      className: 'toolbar-spacer',
      action: () => {},
    },
    {
      name: 'close',
      action: handleClose,
      className: 'fa fa-times custom-close-button',
      title: 'Close Editor',
    },
  ]

  easymde.value = new EasyMDE({ element: textareaRef.value, initialValue, spellChecker: false, placeholder: t('notes.content_placeholder'), toolbar: mobileToolbar, status: false, minHeight: '30px', maxHeight: `${MAX_EDITOR_HEIGHT}px`, lineWrapping: true })

  const cm = easymde.value.codemirror
  applyEditorFontSize()

  const cmWrapper = cm.getWrapperElement()
  cmWrapper.style.whiteSpace = 'pre-wrap'
  cmWrapper.style.wordBreak = 'break-all'
  cmWrapper.style.overflowWrap = 'break-word'

  cm.on('change', (instance) => {
    const editorContent = easymde.value?.value() ?? ''
    if (contentModel.value !== editorContent)
      contentModel.value = editorContent

    updateEditorHeight()
    cm.scrollIntoView(null)
    handleTagSuggestions(instance)
    setTimeout(ensureCursorVisible, 50)
    if (!isReadyForAutoSave.value)
      isReadyForAutoSave.value = true

    else
      emit('triggerAutoSave')
  })

  cm.on('keydown', (cm_instance, event) => {
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
  nextTick(() => {
    updateEditorHeight()
  })
}

// --- 其他函数、生命周期钩子和 Watchers ---
function destroyEasyMDE() {
  if (easymde.value) {
    easymde.value.toTextArea()
    easymde.value = null
  }
}

function applyEditorFontSize() {
  if (easymde.value) {
    const cmWrapper = easymde.value.codemirror.getWrapperElement()
    cmWrapper.classList.remove('font-size-small', 'font-size-medium', 'font-size-large', 'font-size-extra-large')
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
    setTimeout(ensureCursorVisible, 100)
  })
}

function handleSubmit() {
  emit('submit')
}

onMounted(async () => {
  initializeEasyMDE(props.modelValue)
})

onUnmounted(() => {
  destroyEasyMDE()
})

watch(() => props.modelValue, (newValue) => {
  if (easymde.value && newValue !== easymde.value.value()) {
    easymde.value.value(newValue)
    nextTick(() => updateEditorHeight())
  }
})

watch(() => settingsStore.noteFontSize, () => {
  applyEditorFontSize()
  nextTick(() => updateEditorHeight())
})

watch(() => props.editingNote?.id, () => {
  destroyEasyMDE()
  nextTick(() => {
    initializeEasyMDE(props.modelValue)
  })
})
</script>

<template>
  <div class="note-editor-flomo-container">
    <form class="editor-form" autocomplete="off" @submit.prevent="handleSubmit">
      <textarea ref="textareaRef" style="display: none;" />
      <div v-if="showAllTagsPanel" class="all-tags-panel">
        <ul>
          <li v-for="tag in allTags" :key="tag" @mousedown.prevent="insertTag(tag)">
            {{ tag }}
          </li>
        </ul>
      </div>
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
/* Scoped 样式不变 */
.note-editor-flomo-container { padding: 16px; background-color: #ffffff; }
.dark .note-editor-flomo-container { background-color: #1e1e1e; }
.editor-form { position: relative; }
.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 6px !important; /* [修改] 减小内边距并强制生效 */
  margin-top: 8px !important; /* [修改] 减小外边距并强制生效 */
  border-top: 1px solid #e5e7eb;
}
.dark .editor-footer { border-top-color: #3a3a3c; }
.status-bar { display: flex; align-items: center; gap: 12px; font-size: 12px; color: #6b7280; }
.dark .status-bar { color: #9ca3af; }
.submit-btn {
  background-color: #00b386;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 5px 14px !important; /* [核心] 减小内边距并强制生效 */
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.submit-btn:disabled { background-color: #a5a5a5; cursor: not-allowed; }
.tag-suggestions, .all-tags-panel { position: absolute; background-color: #fff; border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1010; max-height: 150px; overflow-y: auto; min-width: 120px; }
.dark .tag-suggestions, .dark .all-tags-panel { background-color: #2c2c2e; border-color: #48484a; }
.tag-suggestions ul, .all-tags-panel ul { list-style: none; margin: 0; padding: 4px 0; }
.tag-suggestions li, .all-tags-panel li { padding: 6px 12px; cursor: pointer; font-size: 14px; }
.tag-suggestions li:hover, .tag-suggestions li.highlighted, .all-tags-panel li:hover { background-color: #f0f0f0; }
.dark .tag-suggestions li:hover, .dark .tag-suggestions li.highlighted, .dark .all-tags-panel li:hover { background-color: #404040; }
.all-tags-panel { top: 38px; left: 5px; }
</style>

<style>
/* 全局样式不变 */
.note-editor-flomo-container .EasyMDEContainer { border: none !important; }
.note-editor-flomo-container .editor-toolbar {
  border: none !important;
  border-bottom: 1px solid #e5e7eb !important;
  background-color: transparent !important;
  padding: 2px 8px 4px 8px !important; /* [核心] 精确控制上下左右内边距 */
  display: flex !important;
  align-items: center !important;
  min-height: auto !important; /* [新增] 重置最小高度 */
  height: auto !important; /* [新增] 重置高度 */
}
.dark .note-editor-flomo-container .editor-toolbar { border-bottom-color: #3a3a3c !important; }
.dark .note-editor-flomo-container .editor-toolbar a { color: #d1d5db !important; }
.note-editor-flomo-container .editor-toolbar .toolbar-spacer { flex-grow: 1; background: none !important; border: none !important; cursor: default !important; }
.note-editor-flomo-container .editor-toolbar .toolbar-spacer:hover { background: none !important; }
@media (max-width: 767px) { .note-editor-flomo-container .editor-toolbar .toolbar-spacer { flex-grow: 0; } }
.note-editor-flomo-container .editor-toolbar a.custom-close-button { font-size: 1.2em; margin-left: 8px; }
.note-editor-flomo-container .CodeMirror { padding: 10px 0 !important; font-size: 16px !important; line-height: 1.6 !important; background-color: transparent !important; transition: height 0.1s ease-out; }
.note-editor-flomo-container .CodeMirror-scroll { padding-bottom: 40px !important; }
.dark .note-editor-flomo-container .CodeMirror { color: #f3f4f6 !important; }
.CodeMirror.font-size-small { font-size: 14px !important; }
.CodeMirror.font-size-medium { font-size: 16px !important; }
.CodeMirror.font-size-large { font-size: 20px !important; }
.CodeMirror.font-size-extra-large { font-size: 22px !important; }
</style>
