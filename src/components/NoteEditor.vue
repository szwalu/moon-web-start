<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EasyMDE from 'easymde'

import { useSettingStore } from '@/stores/setting'

// 假设 store 路径正确
import 'easymde/dist/easymde.min.css'

// --- Props & Emits 定义 ---
const props = defineProps({
  modelValue: { type: String, required: true },
  isEditing: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  allTags: { type: Array as () => string[], default: () => [] },
  maxNoteLength: { type: Number, default: 3000 },
})

const emit = defineEmits(['update:modelValue', 'save', 'cancel', 'triggerAutoSave'])

// --- 核心状态定义 ---
const { t } = useI18n()
const settingsStore = useSettingStore()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const easymde = ref<EasyMDE | null>(null)
let isReadyForAutoSave = false // 改为 let 变量，避免响应式触发

// --- 标签建议功能状态 ---
const showTagSuggestions = ref(false)
const tagSuggestions = ref<string[]>([])
const suggestionsStyle = ref({ top: '0px', left: '0px' })
const highlightedSuggestionIndex = ref(-1)

const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => { emit('update:modelValue', value) },
})
const charCount = computed(() => contentModel.value.length)

// --- EasyMDE 编辑器核心逻辑 ---
function initializeEasyMDE() {
  if (!textareaRef.value || easymde.value)
    return
  isReadyForAutoSave = false

  const mobileToolbar: (EasyMDE.ToolbarIcon | string)[] = [
    'bold',
    'italic',
    'heading',
    '|',
    'unordered-list',
    'ordered-list',
    'taskList',
    '|',
    'link',
    'image',
    'quote',
    '|',
    'preview',
  ]

  easymde.value = new EasyMDE({
    element: textareaRef.value,
    initialValue: contentModel.value,
    spellChecker: false,
    placeholder: props.isEditing ? t('notes.edit_placeholder') : t('notes.create_placeholder'),
    toolbar: mobileToolbar,
    status: false,
    codemirror: {
      viewportMargin: Number.POSITIVE_INFINITY,
    },
    maxHeight: 'none',
    lineWrapping: true,
  })

  const cm = easymde.value.codemirror

  applyEditorFontSize()

  cm.on('change', (instance) => {
    const editorContent = easymde.value?.value() ?? ''
    if (contentModel.value !== editorContent)
      contentModel.value = editorContent

    if (!isReadyForAutoSave)
      isReadyForAutoSave = true
    else
      emit('triggerAutoSave')

    handleTagSuggestions(instance)

    // --- [核心修改] ---
    // 智能处理光标可见性，防止被输入法遮挡
    nextTick(() => {
      if (!easymde.value)
        return
      const cmInstance = easymde.value.codemirror

      // 1. 先确保光标在编辑器内部滚动到可见位置，并留出20px边距
      cmInstance.scrollIntoView(null, 20)

      // 2. 检查光标相对于浏览器窗口的位置，处理主页面滚动
      // window.visualViewport 提供了不受虚拟键盘影响的真实可视区域信息
      if (window.visualViewport) {
        // 'window' 模式获取光标相对于可视窗口的坐标
        const coords = cmInstance.cursorCoords(true, 'window')

        // 在可视窗口底部设置一个安全区，高度可以根据需要调整
        // 50px 通常足以容纳大部分输入法的候选词栏
        const bottomSafeArea = 50

        // 可视窗口的底部边缘
        const viewportBottom = window.visualViewport.height

        // 如果光标的底部进入了下方的“不安全”区域
        if (coords.bottom > viewportBottom - bottomSafeArea) {
          // 计算需要向上滚动的距离
          const scrollAmount = coords.bottom - (viewportBottom - bottomSafeArea)

          // 平滑地滚动主窗口，将光标“托”起来
          window.scrollBy({
            top: scrollAmount,
            left: 0,
            behavior: 'smooth',
          })
        }
      }
    })
  })

  cm.on('keydown', (cmInstance, event) => {
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

    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault()
      handleSave()
    }
  })

  focusEditor()
}

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
  nextTick(() => {
    easymde.value?.codemirror.focus()
    if (props.isEditing) {
      const cm = easymde.value!.codemirror
      const doc = cm.getDoc()
      doc.setCursor(doc.lastLine(), doc.getLine(doc.lastLine()).length)
    }
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
    tag.toLowerCase().startsWith(term.toLowerCase()),
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

function handleSave() {
  if (!props.isLoading && contentModel.value)
    emit('save', contentModel.value)
}

function handleCancel() {
  emit('cancel')
}

// --- 生命周期钩子 ---
onMounted(() => {
  initializeEasyMDE()
})

onUnmounted(() => {
  destroyEasyMDE()
})

watch(() => settingsStore.noteFontSize, applyEditorFontSize)

watch(() => props.modelValue, (newValue) => {
  if (easymde.value && newValue !== easymde.value.value()) {
    isReadyForAutoSave = false
    easymde.value.value(newValue)
  }
})
</script>

<template>
  <div class="note-editor">
    <div class="editor-wrapper">
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
    </div>

    <div class="editor-footer">
      <span class="char-counter">
        {{ charCount }}/{{ maxNoteLength }}
      </span>
      <div class="actions">
        <button v-if="isEditing" type="button" class="btn-secondary" @click="handleCancel">
          {{ $t('common.cancel') }}
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="isLoading || !contentModel"
          @click="handleSave"
        >
          {{ isLoading ? $t('notes.saving') : $t('notes.save_note') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* --- 主容器与布局 --- */
.note-editor {
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  position: relative;
  transition: box-shadow 0.2s ease;
}
.note-editor:focus-within {
  border-color: #00b386;
  box-shadow: 0 0 0 3px rgba(0, 179, 134, 0.1);
}
.dark .note-editor {
  background-color: #2c2c2e;
  border-color: #48484a;
}
.dark .note-editor:focus-within {
  border-color: #00b386;
  box-shadow: 0 0 0 3px rgba(0, 179, 134, 0.2);
}

.editor-wrapper {
  position: relative;
}

/* --- 底部状态与动作栏 --- */
.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-top: 1px solid #e0e0e0;
  background-color: #fff;
  border-radius: 0 0 12px 12px;
}
.dark .editor-footer {
  background-color: #1e1e1e;
  border-top-color: #3a3a3c;
}
.char-counter {
  font-size: 12px;
  color: #6b7280;
}
.dark .char-counter {
  color: #9ca3af;
}
.actions {
  display: flex;
  gap: 8px;
}
.btn-primary {
  background-color: #00b386;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-primary:hover { background-color: #009a74; }
.btn-primary:disabled {
  background-color: #a5a5a5;
  cursor: not-allowed;
  opacity: 0.7;
}
.btn-secondary {
  background-color: #f0f0f0;
  color: #333;
  border: 1px solid #ccc;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-secondary:hover { background-color: #e0e0e0; }
.dark .btn-secondary {
  background-color: #4b5563;
  color: #fff;
  border-color: #555;
}
.dark .btn-secondary:hover { background-color: #5a6676; }

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
.tag-suggestions ul { list-style: none; margin: 0; padding: 4px 0; }
.tag-suggestions li { padding: 6px 12px; cursor: pointer; font-size: 14px; }
.tag-suggestions li:hover,
.tag-suggestions li.highlighted { background-color: #f0f0f0; }
.dark .tag-suggestions li:hover,
.dark .tag-suggestions li.highlighted { background-color: #404040; }
</style>

<style>
/* --- 全局样式，用于覆盖 EasyMDE 默认样式 --- */
.note-editor .EasyMDEContainer {
  border: none !important;
  border-radius: 12px 12px 0 0;
}
.note-editor .editor-toolbar {
  border: none !important;
  border-bottom: 1px solid #e0e0e0 !important;
  background-color: #fff;
  border-radius: 12px 12px 0 0 !important;
  padding: 4px 8px !important;
}
.dark .note-editor .editor-toolbar {
  background-color: #1e1e1e !important;
  border-bottom-color: #3a3a3c !important;
}

.note-editor .CodeMirror {
  height: auto !important;
  border: none !important;
  background-color: transparent !important;
  padding: 16px;
  font-size: 16px !important;
  line-height: 1.6 !important;
  min-height: 120px;
}
.dark .note-editor .CodeMirror {
  color: #f3f4f6 !important;
}

.note-editor .CodeMirror-scroll {
  max-height: 50vh;
  overflow-y: auto;
}

.note-editor .CodeMirror.font-size-small { font-size: 14px !important; }
.note-editor .CodeMirror.font-size-medium { font-size: 16px !important; }
.note-editor .CodeMirror.font-size-large { font-size: 20px !important; }
.note-editor .CodeMirror.font-size-extra-large { font-size: 22px !important; }
</style>
