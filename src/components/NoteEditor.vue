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
  // 新增一个 prop，用于区分是“创建新笔记”还是“编辑旧笔记”的场景
  // 这有助于我们显示不同的按钮或占位符
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
const isReadyForAutoSave = ref(false)

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
  isReadyForAutoSave.value = false

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
    status: false, // 我们使用自己的状态栏
    // --- 实现自动增高的核心配置 ---
    codemirror: {
      // 这个选项是让 CodeMirror 渲染所有行，从而让容器可以自然增高
      viewportMargin: Number.POSITIVE_INFINITY,
    },
    // 为了美观，可以关闭自带的最大高度限制，我们用 CSS 控制
    maxHeight: 'none',
    lineWrapping: true,
  })

  const cm = easymde.value.codemirror

  applyEditorFontSize()

  cm.on('change', (instance) => {
    const editorContent = easymde.value?.value() ?? ''
    if (contentModel.value !== editorContent)
      contentModel.value = editorContent

    // 继承自动保存逻辑
    if (!isReadyForAutoSave.value)
      isReadyForAutoSave.value = true
    else
      emit('triggerAutoSave')

    handleTagSuggestions(instance)

    // --- 保证光标可见的核心逻辑 ---
    // 每当内容变化，都确保光标所在位置滚动到视野内
    nextTick(() => {
      const cursor = instance.getCursor()
      instance.scrollIntoView({ line: cursor.line, ch: cursor.ch }, 10) // 10px 的边距
    })
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

    // 添加快捷键保存 (Ctrl/Cmd + S)
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

// 继承字号选择逻辑
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
    // 如果是编辑模式，将光标移动到末尾
    if (props.isEditing) {
      const cm = easymde.value!.codemirror
      const doc = cm.getDoc()
      doc.setCursor(doc.lastLine(), doc.getLine(doc.lastLine()).length)
    }
  })
}

// --- 继承标签建议相关方法 (保持不变) ---
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
    tag.toLowerCase().startsWith(term.toLowerCase()), // 简化了逻辑，不需要在标签前加'#'
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

// --- 组件事件处理 ---
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

// 当 modelValue 从外部变化时（例如，点击不同的笔记进行编辑），更新编辑器内容
watch(() => props.modelValue, (newValue) => {
  if (easymde.value && newValue !== easymde.value.value()) {
    isReadyForAutoSave.value = false // 重置自动保存状态
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
  position: relative; /* 为标签建议面板提供定位上下文 */
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

/* --- 标签建议样式 (基本保持不变) --- */
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
  /* --- 关键：让编辑器高度自适应内容 --- */
  height: auto !important;

  border: none !important;
  background-color: transparent !important; /* 使其背景透明，由.note-editor控制 */
  padding: 16px;
  font-size: 16px !important;
  line-height: 1.6 !important;
  min-height: 120px; /* 编辑器的最小高度 */
}
.dark .note-editor .CodeMirror {
  color: #f3f4f6 !important;
}

/* --- 核心：控制编辑器达到最大高度后出现滚动条 --- */
.note-editor .CodeMirror-scroll {
  max-height: 50vh; /* 编辑器最大高度为屏幕高度的50% */
  overflow-y: auto;
}

/* 继承字体大小设置 */
.note-editor .CodeMirror.font-size-small { font-size: 14px !important; }
.note-editor .CodeMirror.font-size-medium { font-size: 16px !important; }
.note-editor .CodeMirror.font-size-large { font-size: 20px !important; }
.note-editor .CodeMirror.font-size-extra-large { font-size: 22px !important; }
</style>
