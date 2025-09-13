<script setup lang="ts">
import { computed, defineExpose, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTextareaAutosize } from '@vueuse/core'
import { NDropdown } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingStore } from '@/stores/setting'
import { useTagMenu } from '@/composables/useTagMenu'

// ============== Props & Emits ==============
const props = defineProps({
  modelValue: { type: String, required: true },
  isEditing: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  maxNoteLength: { type: Number, default: 5000 },
  placeholder: { type: String, default: '写点什么...' },
  allTags: { type: Array as () => string[], default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'save', 'cancel', 'focus', 'blur'])

// ============== Store ==============
const settingsStore = useSettingStore()

// ============== v-model ==============
const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
  },
})

// ============== Autosize ==============
const { textarea, input, triggerResize } = useTextareaAutosize({ input: contentModel })
const charCount = computed(() => contentModel.value.length)

// ============== Refs ==============
const editorFooterRef = ref<HTMLElement | null>(null)

// ============== 状态与响应式变量 ==============
const isComposing = ref(false)
const suppressNextBlur = ref(false)
let blurTimeoutId: number | null = null
const showTagSuggestions = ref(false)
const tagSuggestions = ref<string[]>([])
const suggestionsStyle = ref({ top: '0px', left: '0px' })

// ============== 键盘稳定调度器 (所有布局的核心入口) ==============
let keyboardStableTimer: number | null = null
function scheduleLayoutUpdate() {
  if (keyboardStableTimer !== null)
    window.clearTimeout(keyboardStableTimer)
  keyboardStableTimer = window.setTimeout(updateLayout, 350)
}

// ============== 布局与滚动计算 ==============
function getScrollableAncestor(node: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = node?.parentElement || null
  while (el) {
    const style = getComputedStyle(el)
    const canScroll = /(auto|scroll)/.test(style.overflowY)
    if (canScroll && el.clientHeight < el.scrollHeight)
      return el
    el = el.parentElement
  }
  return null
}

function getSafeViewportBottom(): number {
  const SAFE_PADDING = 10
  const vv = window.visualViewport
  if (vv)
    return vv.offsetTop + vv.height - SAFE_PADDING
  return window.innerHeight - SAFE_PADDING
}

function getFooterHeight(): number {
  return editorFooterRef.value?.offsetHeight || 0
}

function applyDynamicMaxHeight() {
  const el = textarea.value
  if (!el)
    return

  const rect = el.getBoundingClientRect()
  const safeBottom = getSafeViewportBottom()
  const footerH = getFooterHeight()
  const SAFE_GAP = 10
  const usable = Math.floor(safeBottom - rect.top - footerH - SAFE_GAP)
  const maxPx = Math.max(120, usable)
  el.style.maxHeight = `${maxPx}px`
}

function ensureCaretVisible() {
  const el = textarea.value
  if (!el)
    return

  const style = getComputedStyle(el)
  const mirror = document.createElement('div')
  mirror.style.cssText = `position:absolute; visibility:hidden; white-space:pre-wrap; word-wrap:break-word; box-sizing:border-box; top:0; left:-9999px; width:${el.clientWidth}px; font:${style.font}; line-height:${style.lineHeight}; padding:${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}; border:solid transparent; border-width:${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth};`
  document.body.appendChild(mirror)

  const val = el.value
  const selEnd = el.selectionEnd ?? val.length
  const before = val.slice(0, selEnd).replace(/\n$/, '\n ').replace(/ /g, '\u00A0')
  mirror.textContent = before

  const lineHeight = Number.parseFloat(style.lineHeight || '20')
  const caretTopInTextarea = mirror.scrollHeight - Number.parseFloat(style.paddingBottom || '0')
  document.body.removeChild(mirror)

  // 1. 校准内部滚动
  const viewTop = el.scrollTop
  const viewBottom = el.scrollTop + el.clientHeight
  const caretDesiredTop = caretTopInTextarea - lineHeight * 0.5
  const caretDesiredBottom = caretTopInTextarea + lineHeight * 1.5
  if (caretDesiredBottom > viewBottom)
    el.scrollTop = Math.min(caretDesiredBottom - el.clientHeight, el.scrollHeight - el.clientHeight)
  else if (caretDesiredTop < viewTop)
    el.scrollTop = Math.max(caretDesiredTop, 0)

  // 2. 校准外部页面滚动
  const scrollable = getScrollableAncestor(el)
  const caretAbsTop = el.getBoundingClientRect().top + (caretTopInTextarea - el.scrollTop)
  const visibleBottom = scrollable
    ? Math.min(scrollable.getBoundingClientRect().bottom, getSafeViewportBottom())
    : getSafeViewportBottom()
  const visibleTop = scrollable ? scrollable.getBoundingClientRect().top : 0
  const padding = 8
  const caretAbsBottom = caretAbsTop + lineHeight * 1.2

  if (caretAbsBottom > visibleBottom) {
    const deltaDown = (caretAbsBottom - visibleBottom) + padding
    if (scrollable)
      scrollable.scrollTop += deltaDown

    else
      window.scrollBy({ top: deltaDown, left: 0, behavior: 'auto' })
  }
  else if (caretAbsTop < visibleTop) {
    const deltaUp = (visibleTop - caretAbsTop) + padding
    if (scrollable)
      scrollable.scrollTop -= deltaUp

    else
      window.scrollBy({ top: -deltaUp, left: 0, behavior: 'auto' })
  }
}

// ============== 布局总管 (The One Ring) ==============
function updateLayout() {
  applyDynamicMaxHeight()
  nextTick(() => {
    triggerResize()
    nextTick(() => {
      ensureCaretVisible()
    })
  })
}

// ============== 事件处理 ==============
function handleFocus() {
  emit('focus')
  scheduleLayoutUpdate()
}

function onBlur() {
  emit('blur')
  if (suppressNextBlur.value) {
    suppressNextBlur.value = false
    return
  }
  blurTimeoutId = window.setTimeout(() => {
    showTagSuggestions.value = false
  }, 200)
}

function handleViewportChange() {
  scheduleLayoutUpdate()
}

function handleTap() {
  scheduleLayoutUpdate()
}

function handleInput(event: Event) {
  const el = event.target as HTMLTextAreaElement
  const cursorPos = el.selectionStart
  const textBeforeCursor = el.value.substring(0, cursorPos)
  const lastHashIndex = textBeforeCursor.lastIndexOf('#')

  if (lastHashIndex === -1 || /\s/.test(textBeforeCursor.substring(lastHashIndex + 1))) {
    showTagSuggestions.value = false
  }
  else {
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
      measure.style.cssText = 'position: absolute; visibility: hidden; font: inherit; white-space: pre;'
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
}

// ============== 文本与工具栏操作 ==============
function updateTextarea(newText: string, newCursorPos?: number) {
  input.value = newText
  nextTick(() => {
    const el = textarea.value
    if (el) {
      el.focus()
      if (newCursorPos !== undefined)
        el.setSelectionRange(newCursorPos, newCursorPos)
    }
  })
}

function selectTag(tag: string) {
  const el = textarea.value
  if (!el)
    return
  const cursorPos = el.selectionStart
  const textBeforeCursor = el.value.substring(0, cursorPos)
  const lastHashIndex = textBeforeCursor.lastIndexOf('#')
  const textAfterCursor = el.value.substring(cursorPos)
  const newText = `${el.value.substring(0, lastHashIndex)}${tag} ${textAfterCursor}`
  const newCursorPos = lastHashIndex + tag.length + 1
  showTagSuggestions.value = false
  updateTextarea(newText, newCursorPos)
}

function insertText(prefix: string, suffix = '') {
  const el = textarea.value
  if (!el)
    return
  const start = el.selectionStart
  const end = el.selectionEnd
  const selectedText = el.value.substring(start, end)
  const newTextFragment = `${prefix}${selectedText}${suffix}`
  const finalFullText = el.value.substring(0, start) + newTextFragment + el.value.substring(end)
  const newCursorPos = selectedText ? start + newTextFragment.length : start + prefix.length
  if (blurTimeoutId) {
    clearTimeout(blurTimeoutId)
    blurTimeoutId = null
  }
  updateTextarea(finalFullText, newCursorPos)
}

function runToolbarAction(fn: () => void) {
  fn()
  nextTick(() => {
    textarea.value?.focus()
  })
}

function addHeading() {
  insertText('## ', '')
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
  const textToInsert = '- [ ] '
  const finalFullText = el.value.substring(0, currentLineStart) + textToInsert + el.value.substring(currentLineStart)
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
  const finalFullText = el.value.substring(0, currentLineStart) + textToInsert + el.value.substring(currentLineStart)
  const newCursorPos = start + textToInsert.length
  updateTextarea(finalFullText, newCursorPos)
}

function handleEnterKey(event: KeyboardEvent) {
  if (event.key !== 'Enter' || isComposing.value)
    return
  const el = textarea.value
  if (!el)
    return

  const start = el.selectionStart
  const end = el.selectionEnd
  const currentLineStart = el.value.lastIndexOf('\n', start - 1) + 1
  const currentLine = el.value.substring(currentLineStart, start)
  const listRegex = /^(\d+)\.\s+/
  const match = currentLine.match(listRegex)
  if (!match)
    return

  if (currentLine.trim() === match[0].trim()) {
    event.preventDefault()
    const before = el.value.substring(0, currentLineStart - 1)
    const after = el.value.substring(end)
    updateTextarea(before + after, currentLineStart - 1)
    return
  }

  event.preventDefault()
  const currentNumber = Number.parseInt(match[1], 10)
  const nextPrefix = `\n${currentNumber + 1}. `
  const before2 = el.value.substring(0, start)
  const after2 = el.value.substring(end)
  updateTextarea(before2 + nextPrefix + after2, start + nextPrefix.length)
}

// ============== 生命周期与 Watchers ==============
onMounted(() => {
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportChange)
    window.visualViewport.addEventListener('scroll', handleViewportChange)
  }
  const ro = new ResizeObserver(scheduleLayoutUpdate)
  if (editorFooterRef.value)
    ro.observe(editorFooterRef.value)

  ;(editorFooterRef as any)._ro = ro
})

onUnmounted(() => {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', handleViewportChange)
    window.visualViewport.removeEventListener('scroll', handleViewportChange)
  }
  const ro = (editorFooterRef as any)._ro
  if (ro && editorFooterRef.value)
    ro.unobserve(editorFooterRef.value)
})

watch(() => props.modelValue, (newValue) => {
  if (newValue === '') {
    nextTick(() => {
      triggerResize()
      applyDynamicMaxHeight()
    })
  }
})

// ============== 标签菜单 ==============
const { t } = useI18n()
const allTagsRef = computed(() => props.allTags)

function handleSelectFromMenu(tag: string) {
  selectTag(tag)
}

const {
  mainMenuVisible: tagMenuVisible,
  tagMenuChildren,
} = useTagMenu(allTagsRef as unknown as any, handleSelectFromMenu, t)

const dropdownMaxHeight = ref(320)
type Opt = any
function injectClickHandlers(opts: Opt[]): Opt[] {
  return opts.map((o) => {
    if (!o)
      return o
    if (o.type === 'group' && Array.isArray(o.children))
      return { ...o, children: injectClickHandlers(o.children) }
    if (o.type === 'render')
      return o
    if (typeof o.key === 'string' && o.key.startsWith('#')) {
      const click = (_e: MouseEvent) => {
        handleSelectFromMenu(o.key)
        tagMenuVisible.value = false
      }
      const mergedProps = { ...(o.props || {}), onClick: click }
      const wrappedLabel = typeof o.label === 'function' ? () => h('div', { class: 'tag-row', onClick: click }, [o.label()]) : o.label
      return { ...o, props: mergedProps, label: wrappedLabel }
    }
    return o
  })
}

function openTagMenu() {
  suppressNextBlur.value = true
  tagMenuVisible.value = true
}

const tagDropdownOptions = computed(() => injectClickHandlers(tagMenuChildren.value))

defineExpose({ reset: triggerResize })
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
        @focus="handleFocus"
        @blur="onBlur"
        @click="handleTap"
        @pointerup="handleTap"
        @keydown.enter="handleEnterKey"
        @compositionstart="isComposing = true"
        @compositionend="isComposing = false"
        @input="handleInput"
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

    <div ref="editorFooterRef" class="editor-footer">
      <div class="footer-left">
        <div class="editor-toolbar">
          <NDropdown
            v-model:show="tagMenuVisible"
            trigger="manual"
            placement="top-start"
            :options="tagDropdownOptions"
            :show-arrow="false"
            :width="260"
            :scrollable="true"
            :max-height="dropdownMaxHeight"
          >
            <span class="toolbar-trigger">
              <button
                type="button"
                class="toolbar-btn"
                title="添加标签"
                @click.stop="openTagMenu"
              >
                #
              </button>
            </span>
          </NDropdown>

          <button
            type="button"
            class="toolbar-btn"
            title="待办事项"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addTodo)"
          >
            ✓
          </button>

          <button
            type="button"
            class="toolbar-btn"
            title="加粗"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addBold)"
          >
            B
          </button>

          <button
            type="button"
            class="toolbar-btn"
            title="数字列表"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addOrderedList)"
          >
            1.
          </button>

          <button
            type="button"
            class="toolbar-btn"
            title="添加标题"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addHeading)"
          >
            H
          </button>

          <button
            type="button"
            class="toolbar-btn"
            title="斜体"
            @mousedown.prevent
            @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addItalic)"
          >
            I
          </button>
        </div>
        <span class="char-counter">
          {{ charCount }}/{{ maxNoteLength }}
        </span>
      </div>
      <div class="actions">
        <button v-if="isEditing" type="button" class="btn-secondary" @click="emit('cancel')">
          取消
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="isLoading || !contentModel"
          @click="emit('save', contentModel)"
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
  overflow-anchor: none;
}

.editor-textarea {
  width: 100%;
  min-height: 40px;
  /* 运行时由 JS 动态设置像素 max-height 覆盖它 */
  max-height: 50vh;
  overflow-y: auto;
  padding: 16px 16px 8px 16px;
  border: none;
  background-color: transparent;
  color: inherit;
  line-height: 1.6;
  resize: none;
  outline: 0;
  box-sizing: border-box;
  font-family: inherit;
  caret-color: currentColor;
  scrollbar-gutter: stable both-edges;
}

.editor-textarea.font-size-small { font-size: 14px; }
.editor-textarea.font-size-medium { font-size: 16px; }
.editor-textarea.font-size-large { font-size: 20px; }
.editor-textarea.font-size-extra-large { font-size: 22px; }

.char-counter {
  font-size: 12px;
  color: #6b7280;
}
.dark .char-counter { color: #9ca3af; }

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
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
.btn-primary:hover { background-color: #009a74; }
.btn-primary:disabled { background-color: #a5a5a5; cursor: not-allowed; opacity: 0.7; }

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
.btn-secondary:hover { background-color: #e0e0e0; }
.dark .btn-secondary { background-color: #4b5563; color: #fff; border-color: #555; }
.dark .btn-secondary:hover { background-color: #5a6676; }

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
.dark .tag-suggestions { background-color: #2c2c2e; border-color: #48484a; }
.tag-suggestions ul { list-style: none; margin: 0; padding: 4px 0; }
.tag-suggestions li { padding: 6px 12px; cursor: pointer; font-size: 14px; }
.tag-suggestions li:hover { background-color: #f0f0f0; }
.dark .tag-suggestions li:hover { background-color: #404040; }

.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  border-top: none;
  background-color: transparent;
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 1px;
  border: none;
  background: none;
  padding: 0;
}
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
.toolbar-btn:hover { background-color: #f0f0f0; color: #333; }
.dark .toolbar-btn { color: #9ca3af; }
.dark .toolbar-btn:hover { background-color: #404040; color: #f0f0f0; }

.toolbar-trigger {
  display: inline-flex;
  align-items: center;
}

:global(.n-dropdown-menu) {
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
</style>

<style>
.n-dropdown-menu.n-dropdown-menu--scrollable {
  max-height: min(60vh, 360px) !important;
  overflow-y: auto !important;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
</style>
