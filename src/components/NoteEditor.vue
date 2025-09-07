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
let blurTimeoutId: number | null = null

function updateTextarea(newText: string, newCursorPos: number) {
  const el = textarea.value
  if (!el)
    return

  // 1. 【关键】在进行任何修改前，保存当前的滚动位置
  const originalScrollTop = el.scrollTop

  // 2. 更新 ref，这将触发 v-model 的异步 DOM 更新和 useTextareaAutosize 的高度计算
  input.value = newText

  // 3. 使用 nextTick 来确保我们的代码在 DOM 更新和高度调整完成后执行
  nextTick(() => {
    // 4. 首先，恢复焦点并设置正确的光标逻辑位置
    el.focus()
    el.setSelectionRange(newCursorPos, newCursorPos)

    // 5. 【关键】然后，将滚动位置恢复到之前保存的位置
    el.scrollTop = originalScrollTop
  })
}

function handleSave() {
  if (!props.isLoading && contentModel.value)
    emit('save', contentModel.value)
}

function handleCancel() {
  emit('cancel')
}

function handleBlur() {
  blurTimeoutId = setTimeout(() => {
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
  const newTextFragment = `${prefix}${selectedText}${suffix}`

  // 计算最终的完整文本
  const finalFullText = el.value.substring(0, start) + newTextFragment + el.value.substring(end)

  // 计算新的光标位置
  // 如果有选中文本，光标应在替换内容之后；否则，在插入的前缀之后。
  const newCursorPos = selectedText
    ? start + newTextFragment.length
    : start + prefix.length

  // 清除可能存在的失焦定时器
  if (blurTimeoutId) {
    clearTimeout(blurTimeoutId)
    blurTimeoutId = null
  }

  updateTextarea(finalFullText, newCursorPos)
}

function addTag() {
  insertText('#')

  // 使用 nextTick 确保 insertText 函数对文本的修改已经更新到 DOM 中
  nextTick(() => {
    // 手动在 textarea 元素上触发一次 input 事件
    textarea.value?.dispatchEvent(new Event('input'))
  })
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
  // 找到当前行或光标所在行的起始位置
  const currentLineStart = el.value.lastIndexOf('\n', start - 1) + 1
  const textToInsert = '- [ ] '

  // 计算最终的完整文本
  const finalFullText = el.value.substring(0, currentLineStart) + textToInsert + el.value.substring(currentLineStart)

  // 计算新的光标位置
  const newCursorPos = start + textToInsert.length

  updateTextarea(finalFullText, newCursorPos)
}
function addOrderedList() {
  const el = textarea.value
  if (!el)
    return

  const start = el.selectionStart
  const currentLineStart = el.value.lastIndexOf('\n', start - 1) + 1
  const textToInsert = '1. '

  // 计算最终的完整文本
  const finalFullText = el.value.substring(0, currentLineStart) + textToInsert + el.value.substring(currentLineStart)

  // 计算新的光标位置
  const newCursorPos = start + textToInsert.length

  updateTextarea(finalFullText, newCursorPos)
}

function handleEnterKey(event: KeyboardEvent) {
  // 只处理回车键事件
  if (event.key !== 'Enter')
    return

  const el = textarea.value
  if (!el)
    return

  const start = el.selectionStart
  const end = el.selectionEnd

  // 找到当前光标所在行的起始位置
  const currentLineStart = el.value.lastIndexOf('\n', start - 1) + 1
  const currentLine = el.value.substring(currentLineStart, start)

  // 使用正则表达式匹配 "数字. " 格式，例如 "1. " 或 "12. "
  const listRegex = /^(\d+)\.\s+/
  const match = currentLine.match(listRegex)

  // 仅当当前行是数字列表项时才执行特殊逻辑
  if (match) {
    // 如果在一个空的列表项上按回车，则取消列表
    if (currentLine.trim() === match[0].trim()) {
      // 阻止默认的回车行为
      event.preventDefault()
      // 将当前行的 "2. " 删掉，并换行
      input.value = el.value.substring(0, currentLineStart - 1) + el.value.substring(end)

      nextTick(() => {
        el.focus()
        // 恢复光标位置
        el.setSelectionRange(currentLineStart - 1, currentLineStart - 1)
      })
      return
    }

    // 阻止默认的回车行为（即简单地插入一个换行符）
    event.preventDefault()

    // 计算下一个序号
    const currentNumber = Number.parseInt(match[1], 10)
    const nextPrefix = `\n${currentNumber + 1}. `

    // 插入换行符和下一个序号
    input.value = el.value.substring(0, start) + nextPrefix + el.value.substring(end)

    // 更新后，重新聚焦并把光标移动到新行的末尾
    nextTick(() => {
      el.focus()
      const newCursorPos = start + nextPrefix.length
      el.setSelectionRange(newCursorPos, newCursorPos)
    })
  }
}

function addHeading() {
  const el = textarea.value
  if (!el)
    return

  const start = el.selectionStart
  const lineStart = el.value.lastIndexOf('\n', start - 1) + 1
  const lineEnd = !el.value.includes('\n', lineStart) ? el.value.length : el.value.indexOf('\n', lineStart)

  const currentLine = el.value.substring(lineStart, lineEnd)
  const headingRegex = /^(#+\s)/
  let newLineContent

  if (headingRegex.test(currentLine))
    newLineContent = currentLine.replace(headingRegex, '')
  else
    newLineContent = `## ${currentLine}`

  // 计算最终的完整文本
  const finalFullText = el.value.substring(0, lineStart) + newLineContent + el.value.substring(lineEnd)

  // 计算新的光标位置
  const newCursorPos = lineStart + newLineContent.length

  updateTextarea(finalFullText, newCursorPos)
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
        @keydown="handleEnterKey"
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
          <button type="button" class="toolbar-btn" title="数字列表" @click="addOrderedList">1.</button>
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
  padding: 3px 9px;
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
  padding: 3px 9px;
  font-size: 13px;
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
  gap: 8px; /* 工具栏和字数统计之间的间距 */
}

/* 3. 明确移除 editor-toolbar 的边框和背景 */
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 1px;
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
  font-size: 18px;
  width: 20px;
  height: 20px;
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
