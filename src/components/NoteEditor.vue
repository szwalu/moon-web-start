<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EasyMDE from 'easymde'
import { useSettingStore } from '@/stores/setting'
import 'easymde/dist/easymde.min.css'

// --- Props & Emits (保持不变) ---
const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as () => any | null, default: null },
  isLoading: { type: Boolean, default: false },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave'])

// --- 核心状态 (有简化) ---
const { t } = useI18n()
const settingsStore = useSettingStore()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const easymde = ref<EasyMDE | null>(null)
const isReadyForAutoSave = ref(false)

// --- 新增：编辑器最大高度常量 (可根据需求调整) ---
const MAX_EDITOR_HEIGHT = window.innerHeight * 0.6 // 屏幕高度的60%

const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => { emit('update:modelValue', value) },
})
const charCount = computed(() => contentModel.value.length)

// --- [核心重构] 动态更新编辑器高度 ---
function updateEditorHeight() {
  if (!easymde.value)
    return

  const cm = easymde.value.codemirror
  const wrapper = cm.getWrapperElement()
  const scroller = cm.getScrollerElement()

  // 1. 先重置高度，以便获取内容真实高度
  wrapper.style.height = 'auto'
  scroller.style.height = 'auto'

  // 2. 获取内容所需的滚动高度
  const contentHeight = scroller.scrollHeight

  // 3. 计算最终高度，不能超过最大值
  const finalHeight = Math.min(contentHeight, MAX_EDITOR_HEIGHT)

  // 4. 应用最终高度
  wrapper.style.height = `${finalHeight}px`
  scroller.style.height = `${finalHeight}px`
}

// --- EasyMDE 编辑器核心逻辑 (有简化和调整) ---
function initializeEasyMDE(initialValue = '') {
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
    'quote',
    // 您可以根据需要保留或修改工具栏
  ]

  easymde.value = new EasyMDE({
    element: textareaRef.value,
    initialValue,
    spellChecker: false,
    placeholder: t('notes.content_placeholder'),
    toolbar: mobileToolbar,
    status: false,
    minHeight: '100px', // 初始最小高度
    maxHeight: `${MAX_EDITOR_HEIGHT}px`, // EasyMDE自身的maxHeight
    lineWrapping: true,
  })

  const cm = easymde.value.codemirror

  applyEditorFontSize()

  cm.on('change', () => {
    const editorContent = easymde.value?.value() ?? ''
    if (contentModel.value !== editorContent)
      contentModel.value = editorContent

    // [重构] 每次内容变化，都重新计算编辑器高度
    updateEditorHeight()

    // 确保光标始终可见
    cm.scrollIntoView(null)

    if (!isReadyForAutoSave.value)
      isReadyForAutoSave.value = true
    else
      emit('triggerAutoSave')
  })

  // 初始加载时聚焦并设置光标
  focusEditor()

  // 初始加载时计算一次高度
  nextTick(() => {
    updateEditorHeight()
  })
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
    cm.scrollIntoView(null)
  })
}

function handleSubmit() {
  emit('submit')
}

// --- 生命周期钩子 (极大简化) ---
onMounted(async () => {
  initializeEasyMDE(props.modelValue)
})

onUnmounted(() => {
  destroyEasyMDE()
})

watch(() => props.modelValue, (newValue) => {
  if (easymde.value && newValue !== easymde.value.value()) {
    easymde.value.value(newValue)
    nextTick(() => updateEditorHeight()) // 内容从外部变化时也要更新高度
  }
})

watch(() => settingsStore.noteFontSize, () => {
  applyEditorFontSize()
  nextTick(() => updateEditorHeight()) // 字体大小变化会影响高度
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
.note-editor-flomo-container {
  padding: 16px;
  background-color: #ffffff;
  /* 您可以根据需要添加边框等 */
}
.dark .note-editor-flomo-container {
  background-color: #1e1e1e;
}

.editor-form {
  position: relative;
}

/* --- 底部状态与动作栏 --- */
.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 12px;
  margin-top: 12px;
  border-top: 1px solid #e5e7eb;
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
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.submit-btn:disabled {
  background-color: #a5a5a5;
  cursor: not-allowed;
}
</style>

<style>
/* --- 全局样式，用于覆盖 EasyMDE 默认样式 --- */
.note-editor-flomo-container .EasyMDEContainer {
  border: none !important;
}

.note-editor-flomo-container .editor-toolbar {
  border: none !important;
  border-bottom: 1px solid #e5e7eb !important;
  background-color: transparent !important;
  padding: 0 0 8px 0 !important;
}
.dark .note-editor-flomo-container .editor-toolbar {
  border-bottom-color: #3a3a3c !important;
}
.dark .note-editor-flomo-container .editor-toolbar a {
  color: #d1d5db !important;
}

.note-editor-flomo-container .CodeMirror {
  padding: 10px 0 !important;
  font-size: 16px !important;
  line-height: 1.6 !important;
  background-color: transparent !important;
  /* 平滑的高度过渡效果 */
  transition: height 0.1s ease-out;
}
.dark .note-editor-flomo-container .CodeMirror {
  color: #f3f4f6 !important;
}

.CodeMirror.font-size-small { font-size: 14px !important; }
.CodeMirror.font-size-medium { font-size: 16px !important; }
.CodeMirror.font-size-large { font-size: 20px !important; }
.CodeMirror.font-size-extra-large { font-size: 22px !important; }
</style>
