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
const showAllTagsPanel = ref(false)

// --- 新增：用于在组件挂载时存储初始窗口高度 ---
const initialInnerHeight = ref(0)

const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => { emit('update:modelValue', value) },
})
const charCount = computed(() => contentModel.value.length)

// --- 键盘与视口适配 ---
function handleViewportResize() {
  if (editorContainerRef.value && window.visualViewport) {
    const visualViewport = window.visualViewport
    const editorEl = editorContainerRef.value

    const keyboardHeight = window.innerHeight - visualViewport.height
    const heightReduced = initialInnerHeight.value > 0 && window.innerHeight < initialInnerHeight.value * 0.9

    // 当键盘弹出时
    if (keyboardHeight > 100 || heightReduced) {
      // 以下部分是您原有的正确逻辑，保持不变
      editorEl.style.bottom = `${keyboardHeight}px`
      editorEl.style.height = `${visualViewport.height}px`
      editorEl.style.maxHeight = 'none'

      // --- [核心修改 2] ---
      // 当我们确认键盘已经弹出，并且容器已经被JS定位到正确位置后，
      // 就移除准备类，让容器以正确姿态“现身”。
      if (editorEl.classList.contains('editor-preparing')) {
        // 使用一个极短的延时，确保样式的应用和移除在不同的渲染帧，防止冲突
        setTimeout(() => {
          editorEl.classList.remove('editor-preparing')
        }, 50)
      }
    }
    else {
      // 键盘收起，恢复由 CSS 控制样式
      editorEl.style.bottom = '0px'
      editorEl.style.height = ''
      editorEl.style.maxHeight = ''

      // 同样，在键盘收起时，也要确保移除准备类
      editorEl.classList.remove('editor-preparing')
    }
  }
}

// --- EasyMDE 编辑器核心逻辑 ---
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
      className: 'toolbar-spacer', // 给“弹簧”一个自定义类名
      action: () => {}, // 它不需要任何功能
    },
    {
      name: 'close',
      action: handleClose, // 调用我们刚添加的函数
      className: 'fa fa-times custom-close-button', // 使用 'x' 图标并添加自定义类名
      title: 'Close Editor', // 鼠标悬停提示
    },
  ]

  easymde.value = new EasyMDE({
    element: textareaRef.value,
    initialValue,
    spellChecker: false,
    placeholder: t('notes.content_placeholder'),
    toolbar: mobileToolbar,
    status: false,
    minHeight: '100px',
    lineWrapping: true, // --- 新增此行，从根本上开启自动换行 ---
  })

  const cm = easymde.value.codemirror

  applyEditorFontSize()

  cm.on('change', (instance) => {
    const editorContent = easymde.value?.value() ?? ''
    if (contentModel.value !== editorContent)
      contentModel.value = editorContent

    if (!isReadyForAutoSave.value)
      isReadyForAutoSave.value = true
    else
      emit('triggerAutoSave')

    handleTagSuggestions(instance)

    nextTick(() => {
      instance.scrollIntoView(null)
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
  if (!easymde.value)
    return

  nextTick(() => {
    const cm = easymde.value!.codemirror
    cm.focus()
    const doc = cm.getDoc()
    doc.setCursor(doc.lastLine(), doc.getLine(doc.lastLine()).length)
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
// --- onMounted 生命周期钩子 ---
onMounted(async () => {
  // --- 新增：在挂载时记录初始视口高度，作为后续判断基准 ---
  initialInnerHeight.value = window.innerHeight

  // --- [核心修改 1] ---
  // 在初始化和聚焦之前，立即为容器添加“准备”类
  if (editorContainerRef.value)
    editorContainerRef.value.classList.add('editor-preparing')

  // 等待DOM更新，确保类已生效
  await nextTick()

  let initialContent = props.modelValue
  if (!props.editingNote && !initialContent) {
    const weatherString = await fetchWeather()
    if (weatherString) {
      initialContent = `${weatherString}\n`
      emit('update:modelValue', initialContent)
    }
  }

  // 现在，在容器处于“安全”状态下初始化编辑器，这会间接触发 focus
  initializeEasyMDE(initialContent)

  window.visualViewport?.addEventListener('resize', handleViewportResize)
  handleViewportResize() // 首次调用以处理初始状态
})

onUnmounted(() => {
  destroyEasyMDE()
  window.visualViewport?.removeEventListener('resize', handleViewportResize)
})

watch(() => props.modelValue, (newValue) => {
  if (easymde.value && newValue !== easymde.value.value())
    easymde.value.value(newValue)
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

.note-editor-container.editor-preparing {
  /* 在准备阶段，将其从危险的屏幕底部（bottom: 0）移开，
    放到一个相对安全的位置，避免浏览器因其在底部而剧烈滚动。
    同时设置为不可见，防止用户看到闪烁。
  */
  bottom: 30vh;
  visibility: hidden;
  transition: none; /* 在准备阶段禁用过渡动画 */
}

.editor-form {
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
}

/* --- 底部状态与动作栏 --- */
.editor-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1px 14px; /* --- 进一步减小垂直内边距 --- */
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
  border-radius: 6px; /* --- 可选：减小圆角使其更紧凑 --- */
  padding: 2px 10px; /* --- 进一步减小内边距 --- */
  font-size: 14px;
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

/* --- 所有标签面板的样式 --- */
.all-tags-panel {
  position: absolute;
  top: 38px; /* 根据工具栏高度微调 */
  left: 5px;
  background-color: #fff;
  border: 1px solid #ccc;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 1010;
  max-height: 150px;
  overflow-y: auto;
  min-width: 120px;
}
.dark .all-tags-panel {
  background-color: #2c2c2e;
  border-color: #48484a;
}
.all-tags-panel ul {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}
.all-tags-panel li {
  padding: 6px 12px;
  cursor: pointer;
  font-size: 14px;
}
.all-tags-panel li:hover {
  background-color: #f0f0f0;
}
.dark .all-tags-panel li:hover {
  background-color: #404040;
}
</style>

<style>
/* --- 全局样式，用于覆盖 EasyMDE 默认样式 --- */
.editor-form > .EasyMDEContainer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: none !important;
  min-width: 0; /* --- 新增此行，防止容器被内容撑开 --- */
}

.editor-toolbar {
  border: none !important;
  border-bottom: 1px solid #e5e7eb !important;
  border-radius: 0 !important;
  background-color: #ffffff;
  padding: 2px 8px !important;
  flex-shrink: 0;
  overflow-x: auto;
  min-height: auto !important;
  display: flex !important;
  align-items: center;
  /* 关键默认值：强制所有图标都从左边开始排列，这主要用于移动端 */
  justify-content: flex-start !important;
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

/* --- “弹簧”元素的样式 --- */
.editor-toolbar .toolbar-spacer {
  /* 默认不伸展，让它在移动端不产生效果 */
  flex-grow: 0;
  background: none !important;
  border: none !important;
  cursor: default !important;
  transition: flex-grow 0.3s ease;
}
.editor-toolbar .toolbar-spacer:hover {
  background: none !important;
}

/* --- 3. 仅在PC端（屏幕宽度 > 768px）应用特殊布局 --- */
@media (min-width: 768px) {
  .editor-toolbar .toolbar-spacer {
    /* 在PC端，让“弹簧”伸展，推开按钮 */
    flex-grow: 1;
  }
}

/* --- 4. 关闭按钮的样式 (保持不变) --- */
.editor-toolbar a.custom-close-button {
  font-size: 1.2em;
}

.CodeMirror {
  flex: 1 !important;
  height: auto !important;
  border: none !important;
  border-radius: 0 !important;
  padding: 12px;
  font-size: 16px !important;
  line-height: 1.6 !important;
  white-space: pre-wrap !important;
  word-break: break-all !important;
  overflow-wrap: break-word !important;
}
.dark .CodeMirror {
  background-color: #1e1e1e !important;
  color: #f3f4f6 !important;
}
.dark .CodeMirror-cursor {
  border-left-color: #f3f4f6 !important;
}

.editor-toolbar a i,
.editor-toolbar button i {
    font-size: 15px !important; /* 您可以在这里调整为您想要的任何大小 */
}

.CodeMirror.font-size-small { font-size: 14px !important; }
.CodeMirror.font-size-medium { font-size: 16px !important; }
.CodeMirror.font-size-large { font-size: 20px !important; }
.CodeMirror.font-size-extra-large { font-size: 22px !important; }
</style>
