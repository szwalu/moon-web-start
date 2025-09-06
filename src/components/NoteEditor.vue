<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
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

// ✨ 新增：处理 textarea 滚动的函数
function handleTextareaScroll() {
  const el = textarea.value
  if (!el)
    return

  // 检查是否滚动到底部（使用 1px 的容差以避免像素计算问题）
  const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 1

  if (isAtBottom) {
    // 如果滚动到底部，就让整个页面向上滚动一点距离
    // 为了更好的体验，可以添加 'smooth' 行为
    window.scrollBy({ top: 60, behavior: 'smooth' })
  }
}

watch(() => props.modelValue, (newValue) => {
  if (newValue === '') {
    nextTick(() => {
      triggerResize()
    })
  }
})

// ✨ 更新：修改这个 watch 侦听器
watch(textarea, (newTextarea, _, onCleanup) => {
  if (newTextarea) {
    // 保持原有的 MutationObserver 逻辑
    const observer = new MutationObserver(() => {
      emit('heightChange')
    })
    observer.observe(newTextarea, {
      attributes: true,
      attributeFilter: ['style'],
    })

    // 添加新的 scroll 事件监听器
    newTextarea.addEventListener('scroll', handleTextareaScroll)

    // 使用 onCleanup 来确保在组件卸载或 textarea 元素变化时
    // 移除监听器和观察者，防止内存泄漏
    onCleanup(() => {
      observer.disconnect()
      newTextarea.removeEventListener('scroll', handleTextareaScroll)
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
        @blur="setTimeout(() => showTagSuggestions = false, 200)"
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
      <span class="char-counter">
        {{ charCount }}/{{ maxNoteLength }}
      </span>
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
/* Scoped 样式无变化 */
.note-editor-reborn{position:relative;background-color:#f9f9f9;border:1px solid #e0e0e0;border-radius:12px;display:flex;flex-direction:column;transition:box-shadow .2s ease,border-color .2s ease}.note-editor-reborn:focus-within{border-color:#00b386;box-shadow:0 0 0 3px rgba(0,179,134,.1)}.dark .note-editor-reborn{background-color:#2c2c2e;border-color:#48484a}.dark .note-editor-reborn:focus-within{border-color:#00b386;box-shadow:0 0 0 3px rgba(0,179,134,.2)}.editor-wrapper{position:relative}.editor-textarea{width:100%;min-height:120px;max-height:40vh;padding:16px;border:none;background-color:transparent;color:inherit;line-height:1.6;resize:none;outline:0;box-sizing:border-box;font-family:inherit;transition:height .1s ease-out}.editor-textarea.font-size-small{font-size:14px}.editor-textarea.font-size-medium{font-size:16px}.editor-textarea.font-size-large{font-size:20px}.editor-textarea.font-size-extra-large{font-size:22px}.editor-footer{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-top:1px solid #e0e0e0;background-color:#fff;border-radius:0 0 11px 11px}.dark .editor-footer{background-color:#1e1e1e;border-top-color:#3a3a3c}.char-counter{font-size:12px;color:#6b7280}.dark .char-counter{color:#9ca3af}.actions{display:flex;gap:8px}.btn-primary{background-color:#00b386;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:14px;font-weight:500;cursor:pointer;transition:background-color .2s}.btn-primary:hover{background-color:#009a74}.btn-primary:disabled{background-color:#a5a5a5;cursor:not-allowed;opacity:.7}.btn-secondary{background-color:#f0f0f0;color:#333;border:1px solid #ccc;border-radius:6px;padding:6px 14px;font-size:14px;font-weight:500;cursor:pointer;transition:background-color .2s}.btn-secondary:hover{background-color:#e0e0e0}.dark .btn-secondary{background-color:#4b5563;color:#fff;border-color:#555}.dark .btn-secondary:hover{background-color:#5a6676}.tag-suggestions{position:absolute;background-color:#fff;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:10;max-height:150px;overflow-y:auto;min-width:120px}.dark .tag-suggestions{background-color:#2c2c2e;border-color:#48484a}.tag-suggestions ul{list-style:none;margin:0;padding:4px 0}.tag-suggestions li{padding:6px 12px;cursor:pointer;font-size:14px}.tag-suggestions li:hover{background-color:#f0f0f0}.dark .tag-suggestions li:hover{background-color:#404040}
</style>
