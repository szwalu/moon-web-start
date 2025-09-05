<script setup lang="ts">
import { type PropType, computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import autosize from 'autosize'
import { useSettingStore } from '@/stores/setting'

const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as PropType<any | null>, default: null },
  isLoading: { type: Boolean, default: false },
  allTags: { type: Array as PropType<string[]>, default: () => [] },
  maxNoteLength: { type: Number, default: 3000 },
})

const emit = defineEmits(['update:modelValue', 'submit'])

const { t } = useI18n()
const settingsStore = useSettingStore()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const isComposing = ref(false)
const isEditingInline = computed(() => !!props.editingNote)

const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
  },
})

const editorFontSizeClass = computed(() => {
  const sizeMap: { [key: string]: string } = {
    'small': 'font-size-small',
    'medium': 'font-size-medium',
    'large': 'font-size-large',
    'extra-large': 'font-size-extra-large',
  }
  return sizeMap[settingsStore.noteFontSize] || 'font-size-medium'
})

function handleSubmit() {
  if (props.isLoading || !contentModel.value.trim())
    return
  emit('submit')
}

function insertTag() {
  if (!textareaRef.value)
    return
  const cursorPosition = textareaRef.value.selectionStart
  const text = contentModel.value
  const newText = `${text.slice(0, cursorPosition)}#${text.slice(cursorPosition)}`
  contentModel.value = newText

  nextTick(() => {
    if (textareaRef.value) {
      textareaRef.value.selectionStart = cursorPosition + 1
      textareaRef.value.selectionEnd = cursorPosition + 1
      textareaRef.value.focus()
    }
  })
}

function insertCheckbox() {
  if (!textareaRef.value)
    return
  const cursorPosition = textareaRef.value.selectionStart
  const text = contentModel.value
  const lineStart = text.lastIndexOf('\n', cursorPosition - 1) + 1
  const newText = `${text.slice(0, lineStart)}- [ ] ${text.slice(lineStart)}`
  contentModel.value = newText

  nextTick(() => {
    if (textareaRef.value) {
      const newCursorPosition = cursorPosition + 6
      textareaRef.value.selectionStart = newCursorPosition
      textareaRef.value.selectionEnd = newCursorPosition
      textareaRef.value.focus()
    }
  })
}

// --- [核心修改 1] 新增一个变量来持有 ResizeObserver 实例 ---
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (textareaRef.value) {
    autosize(textareaRef.value)
    if (!isEditingInline.value) {
      textareaRef.value.focus()
    }
    else {
      const el = textareaRef.value
      el.focus()
      const len = el.value.length
      el.setSelectionRange(len, len)
    }

    // --- [核心修改 2] 创建 ResizeObserver 逻辑 ---
    // 创建一个实例，当观察到元素尺寸变化时执行回调
    resizeObserver = new ResizeObserver(() => {
      // 只有当用户正在此输入框中输入时才触发滚动
      if (document.activeElement === textareaRef.value) {
        // 命令浏览器将输入框的底部滚动到视野内
        // 这会触发父容器滚动，并因 scroll-padding-bottom 而留出安全空间
        textareaRef.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      }
    })

    // 开始用 resizeObserver 监听 textarea 元素的高度变化
    resizeObserver.observe(textareaRef.value)
  }
})

onUnmounted(() => {
  // --- [核心修改 3] 组件卸载时，停止监听 ---
  if (textareaRef.value && resizeObserver)
    resizeObserver.unobserve(textareaRef.value)

  if (textareaRef.value)
    autosize.destroy(textareaRef.value)
})

watch(() => props.editingNote?.id, (newId, oldId) => {
  if (newId !== oldId && textareaRef.value) {
    nextTick(() => {
      if (textareaRef.value) {
        autosize.update(textareaRef.value)
        textareaRef.value.focus()
      }
    })
  }
})
</script>

<template>
  <div class="new-note-editor" :class="{ 'is-inline-editing': isEditingInline }">
    <div class="editor-main">
      <textarea
        ref="textareaRef"
        v-model="contentModel"
        :placeholder="t('notes.content_placeholder', '写点什么...')"
        class="editor-textarea"
        :class="editorFontSizeClass"
        rows="3"
        @compositionstart="isComposing = true"
        @compositionend="isComposing = false"
      />
    </div>
    <div class="editor-actions">
      <div class="action-buttons">
        <button type="button" class="action-btn" title="插入标签" @click="insertTag">#</button>
        <button type="button" class="action-btn" title="插入待办事项" @click="insertCheckbox">✓</button>
      </div>
      <button type="button" class="submit-btn" :disabled="isLoading || !contentModel.trim()" @click="handleSubmit">
        <span v-if="!isEditingInline">
          {{ isLoading ? t('notes.saving', '保存中...') : t('notes.save_note', '保存') }}
        </span>
        <span v-else>
          {{ isLoading ? t('notes.saving', '保存中...') : t('notes.update_note', '更新') }}
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.new-note-editor {
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin-bottom: 1.5rem;
}
.is-inline-editing {
    box-shadow: 0 6px 20px rgba(0, 100, 200, 0.12);
    border: 1px solid #c0c0c0;
    margin-top: 0;
    margin-bottom: 0;
    border-radius: 8px;
}
.dark .new-note-editor {
  background-color: #2a2a2a;
  border-color: #444;
}
.editor-main {
  padding: 12px 16px 8px;
}
.editor-textarea {
  width: 100%;
  border: none;
  background-color: transparent;
  resize: none;
  outline: none;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.6;
  color: #333;
  box-sizing: border-box;
  overflow-y: auto;
  max-height: 50vh;
  /* --- [核心修改 4] 移除之前无效的 scroll-padding-bottom --- */
}
.dark .editor-textarea {
  color: #f0f0f0;
}
.editor-textarea::placeholder {
  color: #999;
}
.dark .editor-textarea::placeholder {
  color: #777;
}
.editor-textarea.font-size-small { font-size: 14px; }
.editor-textarea.font-size-medium { font-size: 16px; }
.editor-textarea.font-size-large { font-size: 20px; }
.editor-textarea.font-size-extra-large { font-size: 22px; }
.editor-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 12px 8px;
  border-top: 1px solid #eee;
}
.dark .editor-actions {
  border-top-color: #444;
}
.action-buttons {
  display: flex;
  gap: 8px;
}
.action-btn {
  background: none;
  border: none;
  color: #555;
  font-size: 18px;
  font-weight: bold;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background-color 0.2s;
}
.action-btn:hover {
  background-color: #e0e0e0;
}
.dark .action-btn {
  color: #aaa;
}
.dark .action-btn:hover {
  background-color: #555;
}
.submit-btn {
  background-color: #333;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s, opacity 0.2s;
}
.submit-btn:hover {
  background-color: #000;
}
.submit-btn:disabled {
  background-color: #a5a5a5;
  cursor: not-allowed;
  opacity: 0.7;
}
.dark .submit-btn {
    background-color: #f0f0f0;
    color: #1a1a1a;
}
.dark .submit-btn:hover {
    background-color: #fff;
}
.dark .submit-btn:disabled {
  background-color: #4b5563;
  color: #999;
}
</style>
