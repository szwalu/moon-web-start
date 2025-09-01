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

// 标签建议相关状态
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
    // 键盘高度 = 布局视口高度 - 可视视口高度
    // 我们只在键盘弹出时（高度差 > 100px，以防意外触发）应用偏移
    const keyboardHeight = window.innerHeight - visualViewport.height

    // 直接将编辑器的 bottom 设置为键盘的高度，实现整体上移
    editorContainerRef.value.style.bottom = `${keyboardHeight > 100 ? keyboardHeight : 0}px`
  }
}

// --- EasyMDE 编辑器核心逻辑 ---

function initializeEasyMDE(initialValue = '') {
  if (!textareaRef.value || easymde.value)
    return
  isReadyForAutoSave.value = false

  // 移动端优先的精简工具栏
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
    status: false, // 我们用自己的状态栏
    minHeight: '100px', // 配合Flexbox，给一个初始高度
  })

  const cm = easymde.value.codemirror

  // 应用自定义字体大小
  applyEditorFontSize()

  // 内容变更监听
  cm.on('change', (instance) => {
    const editorContent = easymde.value?.value() ?? ''
    if (contentModel.value !== editorContent)
      contentModel.value = editorContent

    // 首次加载内容不触发自动保存，后续编辑才触发
    if (!isReadyForAutoSave.value)
      isReadyForAutoSave.value = true
    else
      emit('triggerAutoSave')

    handleTagSuggestions(instance)
  })

  // 键盘事件监听（用于标签建议的上下选择和回车）
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

  // 初始聚焦和光标定位
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
    cmWrapper.classList.remove('font-size-small', 'font-size-medium', 'font-size-large')
    cmWrapper.classList.add(`font-size-${settingsStore.noteFontSize}`)
  }
}

// 将光标定位到末尾并聚焦
function focusEditor() {
  if (!easymde.value)
    return

  nextTick(() => {
    const cm = easymde.value!.codemirror
    cm.focus()
    const doc = cm.getDoc()
    doc.setCursor(doc.lastLine(), doc.getLine(doc.lastLine()).length)
    cm.scrollIntoView(null)
  })
}

// --- 标签建议逻辑 ---
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

// --- 天气功能 (保持不变) ---
async function fetchWeather() {
  // ... 此处逻辑与您原代码完全相同，为简洁省略 ...
  // 为确保完整性，实际使用时请将原 `fetchWeather` 及相关辅助函数粘贴到此处
  // getCachedWeather, setCachedWeather, getMappedCityName, getWeatherText
  return null // 临时返回值
}

// --- 组件事件处理 ---
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

  // 关键：添加视口监听
  window.visualViewport?.addEventListener('resize', handleViewportResize)
  // 立即执行一次以获取初始状态
  handleViewportResize()
})

onUnmounted(() => {
  destroyEasyMDE()
  // 关键：移除监听，防止内存泄漏
  window.visualViewport?.removeEventListener('resize', handleViewportResize)
})

watch(() => props.modelValue, (newValue) => {
  if (easymde.value && newValue !== easymde.value.value())
    easymde.value.value(newValue)
})

// 监听字体大小设置变化
watch(() => settingsStore.noteFontSize, applyEditorFontSize)

// 切换编辑/新建模式时，重新初始化编辑器
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
      <h2 class="editor-title">{{ editorTitle }}</h2>
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
/* --- 主容器与布局 --- */
.note-editor-container {
  position: fixed;
  /* 初始 bottom 为 0，JS 会根据键盘调整它 */
  bottom: 0;
  left: 0;
  width: 100%;
  z-index: 1002;

  background-color: #ffffff;
  border-top: 1px solid #e5e7eb;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.08);

  /* 在PC端给一个最大高度和宽度，使其更像一个模态框 */
  max-height: 90vh;
  margin: 0 auto;
  max-width: 640px;
  left: 50%;
  transform: translateX(-50%);
  border-radius: 12px 12px 0 0;

  /* 核心：Flexbox 垂直布局 */
  display: flex;
  flex-direction: column;

  /* 平滑过渡效果 */
  transition: bottom 0.2s ease-out;

  /* 为 iPhone 底部安全区域留出空间 */
  padding-bottom: env(safe-area-inset-bottom);
}

.dark .note-editor-container {
  background-color: #1e1e1e;
  border-top-color: #3a3a3c;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.25);
}

.editor-form {
  /* 关键：让表单（编辑器）填满剩余空间 */
  flex: 1;
  /* 关键：配合 flex: 1，防止内容溢出时撑破容器 */
  min-height: 0;
  display: flex; /* 让内部的 .EasyMDEContainer 也能撑满 */
  position: relative; /* 为标签建议提供定位上下文 */
}

/* --- 顶部操作栏 --- */
.editor-header {
  flex-shrink: 0; /* 防止被压缩 */
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
  flex-shrink: 0; /* 防止被压缩 */
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
  z-index: 1010; /* 比编辑器工具栏还高 */
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
/* --- 全局样式，用于覆盖 EasyMDE 默认样式 --- */
/* 使 EasyMDE 容器填满其 Flex 父容器 (.editor-form) */
.editor-form > .EasyMDEContainer {
  flex: 1;
  min-height: 0; /* flex 布局关键属性 */
  display: flex;
  flex-direction: column;
  border: none !important;
}

/* 编辑器工具栏样式 */
.editor-toolbar {
  border: none !important;
  border-bottom: 1px solid #e5e7eb !important;
  border-radius: 0 !important;
  background-color: #ffffff;
  padding: 4px 8px !important;
  flex-shrink: 0;
  overflow-x: auto; /* 在小屏上工具栏可横向滚动 */
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

/* CodeMirror 文本输入区样式 */
.CodeMirror {
  /* 关键：让其在 Flex 容器中自动伸缩 */
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

/* 根据设置动态修改编辑器字号的 CSS 规则 */
.CodeMirror.font-size-small { font-size: 14px !important; }
.CodeMirror.font-size-medium { font-size: 16px !important; }
.CodeMirror.font-size-large { font-size: 20px !important; }
</style>
