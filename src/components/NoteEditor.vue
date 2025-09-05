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
  }
})

onUnmounted(() => {
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

// --- [核心逻辑] 监听输入，手动控制滚动 ---
watch(contentModel, () => {
  nextTick(() => {
    const el = textareaRef.value
    if (!el)
      return

    // 仅在文本框成为滚动容器后才执行
    if (el.scrollHeight > el.clientHeight) {
      // 创建一个隐藏的div用于测量光标的精确像素位置
      const measurementDiv = document.createElement('div')
      // 必须精确复制所有影响布局的样式
      const style = window.getComputedStyle(el)
      measurementDiv.style.cssText = `
        position: absolute;
        visibility: hidden;
        width: ${el.clientWidth}px;
        box-sizing: ${style.boxSizing};
        padding: ${style.padding};
        font: ${style.font};
        line-height: ${style.lineHeight};
        white-space: ${style.whiteSpace};
        word-wrap: ${style.wordWrap};
        word-break: ${style.wordBreak};
      `
      document.body.appendChild(measurementDiv)

      // 测量光标之前文本的高度
      measurementDiv.textContent = el.value.substring(0, el.selectionEnd)
      const cursorPixelPosition = measurementDiv.offsetHeight
      document.body.removeChild(measurementDiv)

      // 定义一个“危险区域”：输入框可见高度的底部区域
      // 我们希望光标永远不要进入这个区域
      const lineHeight = Number.parseFloat(style.lineHeight)
      const dangerZoneTop = el.scrollTop + el.clientHeight - (lineHeight * 2.5) // 预留2.5行作为缓冲区

      // 如果光标位置进入了危险区域，就向上滚动
      if (cursorPixelPosition > dangerZoneTop) {
        // 新的滚动位置 = 光标位置 - 可见高度 + 缓冲区大小
        // 这样可以让光标始终保持在缓冲区上方
        el.scrollTop = cursorPixelPosition - el.clientHeight + (lineHeight * 2.5)
      }
    }
  })
}, { flush: 'post' }) // 使用 'post' flush 确保在DOM更新后执行
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
  /* --- [核心修改] 设定一个明确的最大高度 --- */
  max-height: 60vh;
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
