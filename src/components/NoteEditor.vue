<script setup lang="ts">
import { computed, defineExpose, nextTick, ref, watch } from 'vue'
import { useTextareaAutosize } from '@vueuse/core'
import { useSettingStore } from '@/stores/setting'

const props = defineProps({
  modelValue: { type: String, required: true },
  isEditing: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  maxNoteLength: { type: Number, default: 3000 },
  placeholder: { type: String, default: '写点什么...' },
  allTags: { type: Array as () => string[], default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'save', 'cancel', 'focus', 'heightChange'])

const settingsStore = useSettingStore()

const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => { emit('update:modelValue', value) },
})

const { textarea, input, triggerResize } = useTextareaAutosize({ input: contentModel })
const charCount = computed(() => contentModel.value.length)

const showTagSuggestions = ref(false)
const tagSuggestions = ref<string[]>([])
const suggestionsStyle = ref({ top: '0px', left: '0px' })

function handleSave() {
  if (!props.isLoading && contentModel.value)
    emit('save', contentModel.value)
}

function handleCancel() {
  emit('cancel')
}

function handleBlur() {
  setTimeout(() => {
    showTagSuggestions.value = false
  }, 200)
}

function handleInput(event: Event) {
  const el = event.target as HTMLTextAreaElement
  const cursorPos = el.selectionStart
  const textBeforeCursor = el.value.substring(0, cursorPos)
  const lastHashIndex = textBeforeCursor.lastIndexOf('#')

  if (lastHashIndex === -1 || /\s/.test(textBeforeCursor.substring(lastHashIndex + 1))) {
    showTagSuggestions.value = false
    return
  }

  const searchTerm = textBeforeCursor.substring(lastHashIndex + 1)
  tagSuggestions.value = props.allTags.filter(tag =>
    tag.toLowerCase().startsWith(`#${searchTerm.toLowerCase()}`),
  )

  if (tagSuggestions.value.length > 0) {
    const textLines = textBeforeCursor.split('\n')
    const currentLine = textLines.length - 1
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight)
    const topOffset = currentLine * lineHeight

    const measure = document.createElement('span')
    measure.style.cssText = `
      position: absolute;
      visibility: hidden;
      font: inherit;
      white-space: pre;
    `
    measure.textContent = textLines[currentLine].substring(0, textLines[currentLine].length)
    el.parentNode?.appendChild(measure)
    const leftOffset = measure.offsetWidth
    el.parentNode?.removeChild(measure)

    suggestionsStyle.value = {
      top: `${el.offsetTop + topOffset + lineHeight}px`,
      left: `${el.offsetLeft + leftOffset}px`,
    }
    showTagSuggestions.value = true
  }
  else {
    showTagSuggestions.value = false
  }
}

function selectTag(tag: string) {
  const el = textarea.value!
  const cursorPos = el.selectionStart
  const textBeforeCursor = el.value.substring(0, cursorPos)
  const lastHashIndex = textBeforeCursor.lastIndexOf('#')

  const textAfterCursor = el.value.substring(cursorPos)
  const newText = `${el.value.substring(0, lastHashIndex)}${tag} ${textAfterCursor}`

  input.value = newText
  showTagSuggestions.value = false

  nextTick(() => {
    const newCursorPos = lastHashIndex + tag.length + 1
    el.focus()
    el.setSelectionRange(newCursorPos, newCursorPos)
  })
}

function reset() {
  triggerResize()
}

defineExpose({
  reset,
})

function insertText(prefix: string, suffix: string = '') {
  const el = textarea.value
  if (!el)
    return

  const start = el.selectionStart
  const end = el.selectionEnd
  const selectedText = el.value.substring(start, end)
  const newText = `${prefix}${selectedText}${suffix}`

  input.value = el.value.substring(0, start) + newText + el.value.substring(end)

  nextTick(() => {
    el.focus()
    if (selectedText)
      el.setSelectionRange(start, start + newText.length)

    else
      el.setSelectionRange(start + prefix.length, start + prefix.length)
  })
}

function addTag() {
  insertText('#')
}

function addBold() {
  insertText('**', '**')
}

function addItalic() {
  insertText('*', '*')
}

function addTodo() {
  const el = textarea.value
  if (!el)
    return

  const start = el.selectionStart
  const currentLineStart = el.value.lastIndexOf('\n', start - 1) + 1
  const newText = '- [ ] '

  input.value = el.value.substring(0, currentLineStart) + newText + el.value.substring(currentLineStart)

  nextTick(() => {
    el.focus()
    const newCursorPos = start + newText.length
    el.setSelectionRange(newCursorPos, newCursorPos)
  })
}

function addHeading() {
  const el = textarea.value
  if (!el)
    return

  const start = el.selectionStart
  // 找到当前光标所在行的起始位置
  const lineStart = el.value.lastIndexOf('\n', start - 1) + 1
  // 找到当前行的结束位置
  const lineEnd = (!el.value.includes('\n', lineStart)) ? el.value.length : el.value.indexOf('\n', lineStart)

  const currentLine = el.value.substring(lineStart, lineEnd)
  const headingRegex = /^(#+\s)/ // 用于匹配行首的 #
  let newLineContent

  if (headingRegex.test(currentLine)) {
    // 如果当前行已经是标题，则移除标题标记
    newLineContent = currentLine.replace(headingRegex, '')
  }
  else {
    // 如果不是标题，则添加二级标题标记
    newLineContent = `## ${currentLine}`
  }

  // 替换整行内容
  input.value = el.value.substring(0, lineStart) + newLineContent + el.value.substring(lineEnd)

  // 更新后，重新聚焦并把光标放到行末
  nextTick(() => {
    el.focus()
    const newCursorPos = lineStart + newLineContent.length
    el.setSelectionRange(newCursorPos, newCursorPos)
  })
}

watch(() => props.modelValue, (newValue) => {
  if (newValue === '') {
    nextTick(() => {
      triggerResize()
    })
  }
})

watch(textarea, (newTextarea) => {
  if (newTextarea) {
    const observer = new MutationObserver(() => {
      emit('heightChange')
    })
    observer.observe(newTextarea, {
      attributes: true,
      attributeFilter: ['style'],
    })
  }
})
</script>

<template>
  <div class="note-editor-reborn">
    <div class="editor-wrapper">
      <textarea
        ref="textarea"
        v-model="input"
        class="editor-textarea"
        :class="`font-size-${settingsStore.noteFontSize}`"
        :placeholder="placeholder"
        :maxlength="maxNoteLength"
        @focus="emit('focus')"
        @input="handleInput"
        @blur="handleBlur"
      />
      <div
        v-if="showTagSuggestions && tagSuggestions.length"
        class="tag-suggestions"
        :style="suggestionsStyle"
      >
        <ul>
          <li
            v-for="tag in tagSuggestions"
            :key="tag"
            @mousedown.prevent="selectTag(tag)"
          >
            {{ tag }}
          </li>
        </ul>
      </div>
    </div>

    <div class="editor-footer">
      <div class="footer-left">
        <div class="editor-toolbar">
          <button type="button" class="toolbar-btn" title="添加标签" @click="addTag">#</button>
          <button type="button" class="toolbar-btn" title="待办事项" @click="addTodo">✓</button>
          <button type="button" class="toolbar-btn" title="加粗" @click="addBold">B</button>
          <button type="button" class="toolbar-btn" title="添加标题" @click="addHeading">H</button>
          <button type="button" class="toolbar-btn" title="斜体" @click="addItalic">I</button>
        </div>
        <span class="char-counter">
          {{ charCount }}/{{ maxNoteLength }}
        </span>
      </div>
      <div class="actions">
        <button v-if="isEditing" type="button" class="btn-secondary" @click="handleCancel">
          取消
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="isLoading || !contentModel"
          @click="handleSave"
        >
          保存
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.note-editor-reborn {
  position: relative;
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}

.note-editor-reborn:focus-within {
  border-color: #00b386;
  box-shadow: 0 0 0 3px rgba(0, 179, 134, 0.1);
}

.dark .note-editor-reborn {
  background-color: #2c2c2e;
  border-color: #48484a;
}

.dark .note-editor-reborn:focus-within {
  border-color: #00b386;
  box-shadow: 0 0 0 3px rgba(0, 179, 134, 0.2);
}

.editor-wrapper {
  position: relative;
}

.editor-textarea {
  width: 100%;
  min-height: 120px;
  max-height: 50vh;
  padding: 16px 16px 4px 16px;
  border: none;
  background-color: transparent;
  color: inherit;
  line-height: 1.6;
  resize: none;
  outline: 0;
  box-sizing: border-box;
  font-family: inherit;
}

.editor-textarea.font-size-small {
  font-size: 14px;
}

.editor-textarea.font-size-medium {
  font-size: 16px;
}

.editor-textarea.font-size-large {
  font-size: 20px;
}

.editor-textarea.font-size-extra-large {
  font-size: 22px;
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
  align-items: center; /* 确保按钮和字数统计垂直居中对齐 */
  gap: 8px; /* 按钮之间的间距 */
  white-space: nowrap; /* 关键：确保按钮不会换行 */
}

.btn-primary {
  background-color: #00b386;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 3px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-primary:hover {
  background-color: #009a74;
}

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
  padding: 3px 14px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-secondary:hover {
  background-color: #e0e0e0;
}

.dark .btn-secondary {
  background-color: #4b5563;
  color: #fff;
  border-color: #555;
}

.dark .btn-secondary:hover {
  background-color: #5a6676;
}

.tag-suggestions {
  position: absolute;
  background-color: #fff;
  border: 1px solid #ccc;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10;
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

.tag-suggestions li:hover {
  background-color: #f0f0f0;
}

.dark .tag-suggestions li:hover {
  background-color: #404040;
}

/* --- START: Toolbar Final Fix --- */

/* 1. 精简页脚容器，大幅减少垂直内边距 */
.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px; /* 关键：大幅减少上下内边距，控制整体高度 */
  border-top: none;
  background-color: transparent;
}

.dark .editor-footer {
  background-color: transparent;
  border-top: none;
}

/* 2. 新增 footer-left 的样式 */
.footer-left {
  display: flex;
  align-items: center;
  gap: 12px; /* 工具栏和字数统计之间的间距 */
}

/* 3. 明确移除 editor-toolbar 的边框和背景 */
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  border: none; /* 关键：明确移除边框 */
  background: none; /* 确保无背景 */
  padding: 0; /* 确保无内边距 */
}

/* 4. 保持 toolbar-btn 的精简尺寸 */
.toolbar-btn {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  color: #6b7280;
  border-radius: 4px;
  font-weight: bold;
  font-size: 15px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s, color 0.2s;
}

.toolbar-btn:hover {
  background-color: #f0f0f0;
  color: #333;
}

.dark .toolbar-btn {
  color: #9ca3af;
}

.dark .toolbar-btn:hover {
  background-color: #404040;
  color: #f0f0f0;
}

/* --- END: Toolbar Final Fix --- */
</style>
