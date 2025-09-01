<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EasyMDE from 'easymde'
import 'easymde/dist/easymde.min.css'
import { useSettingStore } from '@/stores/setting'

// --- Props & Emits Definition ---
const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as () => any | null, default: null },
  isLoading: { type: Boolean, default: false },
  lastSavedTime: { type: String, default: '' },
  maxNoteLength: { type: Number, default: 3000 },
})

const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave', 'close'])

// --- Core State Definition ---
const { t } = useI18n()
const settingsStore = useSettingStore()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const easymde = ref<EasyMDE | null>(null)
const footerRef = ref<HTMLElement | null>(null)
const isReadyForAutoSave = ref(false)

const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => { emit('update:modelValue', value) },
})

const charCount = computed(() => contentModel.value.length)

/**
 * 核心函数：为编辑器滚动区域设置安全边距，防止光标被底部栏遮挡。
 */
function applyScrollerPadding() {
  setTimeout(() => {
    if (easymde.value && footerRef.value) {
      const footerHeight = footerRef.value.offsetHeight
      const scroller = easymde.value.codemirror.getScrollerElement()
      if (scroller && scroller.style.paddingBottom !== `${footerHeight}px`)
        scroller.style.paddingBottom = `${footerHeight}px`
    }
  }, 0)
}

function initializeEasyMDE(initialValue = '') {
  isReadyForAutoSave.value = false
  const newEl = textareaRef.value
  if (!newEl || easymde.value)
    return

  easymde.value = new EasyMDE({
    element: newEl,
    initialValue,
    spellChecker: false,
    placeholder: t('notes.content_placeholder'),
    toolbar: [
      'bold',
      'italic',
      'heading',
      '|',
      'quote',
      'unordered-list',
      'ordered-list',
      '|',
      'link',
      'table',
      '|',
      'preview',
    ],
    status: false,
  })

  // 应用字体大小设置
  nextTick(applyEditorFontSize)

  const cm = easymde.value.codemirror
  cm.on('change', () => {
    // 更新 v-model
    const editorContent = easymde.value?.value() ?? ''
    if (contentModel.value !== editorContent)
      contentModel.value = editorContent

    // 触发自动保存
    if (!isReadyForAutoSave.value)
      isReadyForAutoSave.value = true
    else
      emit('triggerAutoSave')

    // 每次内容变化，都重新计算安全边距
    applyScrollerPadding()
  })

  // 编辑器刷新时也重新计算
  cm.on('refresh', applyScrollerPadding)

  // 初始聚焦并移动光标到末尾
  cm.focus()
  cm.setCursor(cm.lineCount(), 0)
}

function applyEditorFontSize() {
  if (!easymde.value)
    return
  const cmWrapper = easymde.value.codemirror.getWrapperElement()
  cmWrapper.classList.remove('font-size-small', 'font-size-medium', 'font-size-large')
  cmWrapper.classList.add(`font-size-${settingsStore.noteFontSize}`)
}

function destroyEasyMDE() {
  if (easymde.value) {
    easymde.value.toTextArea()
    easymde.value = null
  }
}

// --- Lifecycle Hooks & Watchers ---
onMounted(() => {
  initializeEasyMDE(props.modelValue)
  // 在DOM完全渲染后执行一次安全边距计算
  nextTick(applyScrollerPadding)
})

onUnmounted(() => {
  destroyEasyMDE()
})

// 监听可能影响 footer 高度的 prop，并重新计算边距
watch([() => props.lastSavedTime, () => props.editingNote], () => {
  nextTick(applyScrollerPadding)
})
</script>

<template>
  <div class="note-editor-container">
    <div class="editor-main-area">
      <textarea ref="textareaRef" v-model="contentModel" />
    </div>
    <div ref="footerRef" class="editor-footer">
      <div class="status-bar">
        <span class="char-counter">
          {{ charCount }}/{{ maxNoteLength }}
        </span>
        <span v-if="lastSavedTime" class="last-saved-time">
          {{ lastSavedTime }}
        </span>
      </div>
      <div class="action-buttons">
        <button type="button" class="form-button close-btn" @click="$emit('close')">
          {{ t('notes.cancel') }}
        </button>
        <button
          type="button"
          class="form-button submit-btn"
          :disabled="isLoading || !contentModel"
          @click="$emit('submit')"
        >
          {{ isLoading ? t('notes.saving') : (editingNote ? t('notes.update_note') : t('notes.save_note')) }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.note-editor-container {
  /* 核心：作为 flex 子项，填满父容器的可用空间 */
  flex: 1;
  min-height: 0; /* 防止内容溢出时撑破父容器 */

  /* 内部也使用 flex 布局来管理文本区和底部栏 */
  display: flex;
  flex-direction: column;
  background-color: #fff;
}
.dark .note-editor-container {
  background-color: #1e1e1e;
}

.editor-main-area {
  /* 核心：让编辑器主体部分填满所有可用空间 */
  flex: 1;
  min-height: 0;
  position: relative; /* 为 EasyMDE 提供定位上下文 */
}

.editor-footer {
  /* 核心：底部栏高度固定，不收缩 */
  flex-shrink: 0;
  padding: 0.75rem 1rem;
  border-top: 1px solid #e0e0e0;
  background-color: #fff;
}
.dark .editor-footer {
  border-top-color: #48484a;
  background-color: #1e1e1e;
}

.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  font-size: 12px;
  color: #999;
}
.dark .status-bar {
  color: #aaa;
}

.action-buttons {
  display: flex;
  gap: 0.75rem;
}
.form-button {
  flex: 1;
  padding: 0.75rem;
  font-size: 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-weight: 500;
}
.close-btn {
  background-color: #f0f0f0;
  color: #333;
}
.dark .close-btn {
  background-color: #555;
  color: #f0f0f0;
}
.submit-btn {
  background-color: #00b386;
  color: white;
}
.form-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

<style>
/* EasyMDE 全局样式调整 */
.note-editor-container .EasyMDEContainer {
  height: 100%;
  width: 100%;
  border: none;
}
.note-editor-container .editor-toolbar {
  border: none;
  border-bottom: 1px solid #e0e0e0;
}
.dark .note-editor-container .editor-toolbar {
  background: #1e1e1e;
  border-bottom-color: #48484a;
}
.dark .note-editor-container .editor-toolbar a {
  color: #e0e0e0;
}
.dark .note-editor-container .editor-toolbar a.active {
  background: #404040;
}

.note-editor-container .CodeMirror {
  height: 100%;
  background: #fff;
  color: #333;
  font-size: 16px !important;
  line-height: 1.6 !important;
}
.dark .note-editor-container .CodeMirror {
  background: #1e1e1e;
  color: #e0e0e0;
}
.note-editor-container .CodeMirror-scroll {
  /* 我们的 JS 解决方案会在这里动态添加 padding-bottom */
}

/* 字体大小设置 */
.CodeMirror.font-size-small { font-size: 14px !important; }
.CodeMirror.font-size-medium { font-size: 16px !important; }
.CodeMirror.font-size-large { font-size: 20px !important; }
</style>
