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
  allTags: { type: Array as () => string[], default: () => [] },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave', 'close'])

// --- Core State Definition (Refs, Computed, etc.) ---
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

// ===================================================================
// --- 全新的、更稳定的JS解决方案 ---
// ===================================================================
const wrapperStyle = ref({})

/**
 * 强制为编辑器滚动区域设置安全边距（padding），防止光标被遮挡。
 * 这个函数被设计为可以被反复安全调用。
 */
function applyScrollerPadding() {
  // 使用 setTimeout(..., 0) 将此操作推到浏览器任务队列的末尾，
  // 以确保在任何可能重置样式的编辑器内部操作之后执行。
  setTimeout(() => {
    if (easymde.value && footerRef.value) {
      const footerHeight = footerRef.value.offsetHeight
      const scroller = easymde.value.codemirror.getScrollerElement()
      if (scroller && scroller.style.paddingBottom !== `${footerHeight}px`)
        scroller.style.paddingBottom = `${footerHeight}px`
    }
  }, 0)
}

/**
 * 处理浏览器可见区域大小的变化（主要是键盘弹出/收起）。
 */
function handleViewportResize() {
  if (window.visualViewport) {
    const viewport = window.visualViewport
    const keyboardHeight = window.innerHeight - viewport.height

    wrapperStyle.value = {
      transform: `translateY(-${keyboardHeight}px)`,
      height: `${viewport.height}px`,
    }
    // 每次窗口变化后，都重新计算和应用一次安全边距
    applyScrollerPadding()
  }
}

// ===================================================================

// --- 其他函数 (无重大改动) ---

function destroyEasyMDE() {
  if (easymde.value) {
    easymde.value.toTextArea()
    easymde.value = null
  }
}

function applyEditorFontSize() {
  if (!easymde.value)
    return
  const cmWrapper = easymde.value.codemirror.getWrapperElement()
  cmWrapper.classList.remove('font-size-small', 'font-size-medium', 'font-size-large')
  cmWrapper.classList.add(`font-size-${settingsStore.noteFontSize}`)
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
    toolbar: [ /* 工具栏配置保持不变 */
      'bold',
      'italic',
      'heading',
      '|',
      'quote',
      'unordered-list',
      'ordered-list',
      '|',
      'link',
      'image',
      'table',
      '|',
      'preview',
    ],
    status: false,
  })

  nextTick(applyEditorFontSize)

  const cm = easymde.value.codemirror
  cm.on('change', () => {
    const editorContent = easymde.value?.value() ?? ''
    if (contentModel.value !== editorContent)
      contentModel.value = editorContent

    if (!isReadyForAutoSave.value)
      isReadyForAutoSave.value = true
    else
      emit('triggerAutoSave')

    // 每次内容变化，都重新计算和应用一次安全边距
    applyScrollerPadding()
  })

  // 编辑器刷新时也需要重新应用
  cm.on('refresh', applyScrollerPadding)
}

function handleSubmit() {
  emit('submit')
}

// --- Lifecycle Hooks & Watchers ---
onMounted(async () => {
  const initialContent = props.modelValue
  if (!props.editingNote && !props.modelValue) {
    // [已修复] 删除了此处的 console.log 语句
  }

  initializeEasyMDE(initialContent)

  window.visualViewport?.addEventListener('resize', handleViewportResize)
  handleViewportResize()

  // 确保在DOM完全渲染后执行
  nextTick(applyScrollerPadding)
})

onUnmounted(() => {
  destroyEasyMDE()
  window.visualViewport?.removeEventListener('resize', handleViewportResize)
})

watch(() => props.modelValue, (newValue) => {
  if (easymde.value && newValue !== easymde.value.value())
    easymde.value.value(newValue)
})

// 监听任何可能影响footer高度的prop，并重新计算边距
watch([() => props.lastSavedTime, () => props.editingNote], () => {
  nextTick(applyScrollerPadding)
})
</script>

<template>
  <div
    class="note-editor-wrapper"
    :style="wrapperStyle"
  >
    <form class="note-editor-form" autocomplete="off" @submit.prevent="handleSubmit">
      <textarea
        ref="textareaRef"
        v-model="contentModel"
        style="display: none;"
      />
      <div ref="footerRef" class="editor-footer">
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
            type="button"
            class="form-button close-btn"
            @click="$emit('close')"
          >
            {{ t('notes.cancel') }}
          </button>
          <button
            type="submit"
            class="form-button submit-btn"
            :disabled="isLoading || !contentModel"
          >
            💾 {{ isLoading ? t('notes.saving') : editingNote ? t('notes.update_note') : t('notes.save_note') }}
          </button>
        </div>
      </div>
    </form>
  </div>
</template>

<style scoped>
.note-editor-wrapper {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 100vh; /* 初始高度，JS会动态调整 */
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  background-color: #fff;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
  display: flex;
  flex-direction: column;
  /* 平滑过渡 */
  transition: transform 0.2s ease-out, height 0.2s ease-out;
  transform: translateY(0);
}
.dark .note-editor-wrapper {
  background-color: #2c2c2e;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.3);
}

.note-editor-form {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-height: 0;
  overflow: hidden;
}

.editor-footer {
  flex-shrink: 0;
  padding: 0.75rem 1rem;
  border-top: 1px solid #e0e0e0;
}
.dark .editor-footer {
  border-top-color: #48484a;
}
.status-bar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  margin-bottom: 0.5rem;
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
  display: flex;
  gap: 0.75rem;
}
.form-button {
  flex-grow: 1;
  padding: 0.6rem;
  font-size: 16px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color 0.2s;
}
.form-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
</style>

<style>
/* 全局样式 */
.note-editor-form > .EasyMDEContainer {
    flex-grow: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border: none !important;
}
.editor-toolbar {
  flex-shrink: 0;
  border-bottom: 1px solid #e0e0e0 !important;
}
.dark .editor-toolbar {
  border-bottom-color: #48484a !important;
}
.CodeMirror {
  height: 100% !important;
  flex-grow: 1;
  min-height: 0;
  overflow-y: auto !important;
  font-size: 16px !important;
  line-height: 1.6 !important;
}
</style>
