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

// —— 新增：输入法/键盘占用的底部偏移（px）
const imeBottomOffset = ref(0)

// content 双向绑定
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

// —— 新增：保证“光标行”可见（考虑 IME / 保存按钮高度）
function ensureCaretVisible() {
  const el = textareaRef.value
  if (!el)
    return

  const ACTIONS_HEIGHT = 52 // 与样式中 .editor-actions 的 min-height 保持一致
  const desiredBottomPadding = imeBottomOffset.value + ACTIONS_HEIGHT + 16

  const scrollTop = el.scrollTop
  const viewHeight = el.clientHeight
  const totalHeight = el.scrollHeight

  // 用行高近似估算光标位置
  const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight || '24')
  const caretPos = el.selectionEnd || 0
  const textUptoCaret = el.value.slice(0, caretPos)
  const caretLines = (textUptoCaret.match(/\n/g)?.length ?? 0) + 1
  const caretY = (caretLines - 1) * lineHeight

  const viewportBottom = scrollTop + viewHeight
  const targetBottom = caretY + lineHeight + desiredBottomPadding

  if (targetBottom > viewportBottom)
    el.scrollTop = Math.min(targetBottom - viewHeight, totalHeight - viewHeight)
  else if (caretY < scrollTop)
    el.scrollTop = Math.max(caretY - 8, 0)
}

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
      ensureCaretVisible()
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
      ensureCaretVisible()
    }
  })
}

let resizeObserver: ResizeObserver | null = null

// —— 可视视口变化 → 计算 IME 高度；需在 onUnmounted 中用同一引用移除
function updateImeOffsetFn() {
  const vv = window.visualViewport
  if (!vv) {
    imeBottomOffset.value = 0
    return
  }
  // 键盘高度 ≈ 窗口内高 - 可视高 - 可视顶部偏移
  const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  imeBottomOffset.value = keyboard > 80 ? Math.round(keyboard) : 0
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

    // 用“光标行”定位替代 scrollIntoView 底部滚动
    resizeObserver = new ResizeObserver(() => {
      if (document.activeElement === textareaRef.value)
        ensureCaretVisible()
    })
    resizeObserver.observe(textareaRef.value)
  }

  // 监听 visualViewport 变化（IME / 键盘）
  updateImeOffsetFn()
  window.visualViewport?.addEventListener('resize', updateImeOffsetFn)
  window.visualViewport?.addEventListener('scroll', updateImeOffsetFn)
})

onUnmounted(() => {
  if (textareaRef.value && resizeObserver)
    resizeObserver.unobserve(textareaRef.value)

  if (textareaRef.value)
    autosize.destroy(textareaRef.value)

  window.visualViewport?.removeEventListener('resize', updateImeOffsetFn)
  window.visualViewport?.removeEventListener('scroll', updateImeOffsetFn)
})

watch(
  () => props.editingNote?.id,
  (newId, oldId) => {
    if (newId !== oldId && textareaRef.value) {
      nextTick(() => {
        if (textareaRef.value) {
          autosize.update(textareaRef.value)
          textareaRef.value.focus()
          ensureCaretVisible()
        }
      })
    }
  },
)
</script>

<template>
  <div
    class="new-note-editor"
    :class="{ 'is-inline-editing': isEditingInline }"
    :style="{ '--ime-bottom': `${imeBottomOffset}px` }"
  >
    <div class="editor-main">
      <textarea
        ref="textareaRef"
        v-model="contentModel"
        :placeholder="t('notes.content_placeholder', '写点什么...')"
        class="editor-textarea"
        :class="editorFontSizeClass"
        rows="3"
        @compositionstart="isComposing = true"
        @compositionend="() => { isComposing = false; ensureCaretVisible() }"
        @input="ensureCaretVisible"
        @focus="ensureCaretVisible"
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

  /* 防止被系统底部条覆盖（iOS 安全区） */
  padding-bottom: env(safe-area-inset-bottom);
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

/* 文本域：滚动 + 底部留白（操作区 + IME + 安全区） */
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

  /* 键盘弹起时，视口变小 —— 用 dvh 更准确 */
  max-height: calc(60dvh);

  /* 底部留白：16px + IME 高度 + 安全区 + 操作区高度(52px) */
  padding-bottom: calc(16px + var(--ime-bottom, 0px) + env(safe-area-inset-bottom) + 52px);

  /* 滚动定位的底部缓冲，配合 ensureCaretVisible/粘性操作区 */
  scroll-padding-bottom: calc(16px + var(--ime-bottom, 0px) + env(safe-area-inset-bottom) + 52px);
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

/* 操作区 sticky 在容器内部底部，不与系统状态栏/键盘打架 */
.editor-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-top: 1px solid #eee;
  min-height: 52px;          /* —— 与脚本常量一致 */
  position: sticky;
  bottom: 0;
  background: inherit;
  z-index: 1;
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
