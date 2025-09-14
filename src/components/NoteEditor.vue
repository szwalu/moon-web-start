<script setup lang="ts">
import { computed, defineExpose, h, nextTick, onMounted, onUnmounted, ref } from 'vue'
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

// ============== 状态与响应式变量 ==============
const isComposing = ref(false)
const suppressNextBlur = ref(false)
let blurTimeoutId: number | null = null
const showTagSuggestions = ref(false)
const tagSuggestions = ref<string[]>([])
const suggestionsStyle = ref({ top: '0px', left: '0px' })

// 根节点 + 光标缓存
const rootRef = ref<HTMLElement | null>(null)
const lastSelectionStart = ref<number>(0)
function captureCaret() {
  const el = textarea.value
  if (el && typeof el.selectionStart === 'number')
    lastSelectionStart.value = el.selectionStart
}

// === 键盘模式下把“底部”固定在 48vh ===
const TYPING_BOTTOM_VH = 48 // 你想改别的值也可以
const isTypingViewport = ref(false) // NEW

function getVhPx(vh: number) { // NEW
  return Math.round(window.innerHeight * (vh / 100))
}

// ============== 滚动校准 ==============
function ensureCaretVisibleInTextarea() {
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

  const viewTop = el.scrollTop

  // ★ 关键：打字（聚焦）时，视窗底部按 min(实际高度, 48vh) 计算
  const typingLimitPx = isTypingViewport.value ? getVhPx(TYPING_BOTTOM_VH) : el.clientHeight
  const effectiveViewportHeight = Math.min(el.clientHeight, typingLimitPx)
  const viewBottom = viewTop + effectiveViewportHeight

  const caretDesiredTop = caretTopInTextarea - lineHeight * 0.5
  const caretDesiredBottom = caretTopInTextarea + lineHeight * 1.5

  if (caretDesiredBottom > viewBottom) {
    el.scrollTop = Math.min(
      caretDesiredBottom - effectiveViewportHeight,
      el.scrollHeight - el.clientHeight,
    )
  }
  else if (caretDesiredTop < viewTop) {
    el.scrollTop = Math.max(caretDesiredTop, 0)
  }
}

function forceEditingTextareaFullHeight() {
  const el = textarea.value
  if (!el)
    return
  // 最高优先级：内联 + !important（第三个参数）
  el.style.setProperty('height', '100%', 'important')
  el.style.setProperty('max-height', 'none', 'important')
}

// ============== 基础事件 ==============
function handleFocus() {
  emit('focus')
  isTypingViewport.value = true // NEW：进入“打字视窗”模式
  forceEditingTextareaFullHeight()
  captureCaret()
  requestAnimationFrame(ensureCaretVisibleInTextarea)
}

function onBlur() {
  emit('blur')
  isTypingViewport.value = false // NEW：退出“打字视窗”模式

  if (suppressNextBlur.value) {
    suppressNextBlur.value = false
    return
  }
  // 原有的 tag 建议关闭逻辑…
  blurTimeoutId = window.setTimeout(() => {
    showTagSuggestions.value = false
  }, 200)

  // NEW：键盘收起后自动把内容下拉（展示 70% 视口下剩余内容）
  const el = textarea.value
  if (el) {
    requestAnimationFrame(() => {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
    })
  }
}

function handleClick() {
  captureCaret()
  requestAnimationFrame(ensureCaretVisibleInTextarea)
}

function handleInput(event: Event) {
  const el = event.target as HTMLTextAreaElement
  captureCaret()

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

// ============== 文本与工具栏 ==============
function updateTextarea(newText: string, newCursorPos?: number) {
  input.value = newText
  nextTick(() => {
    const el = textarea.value
    if (el) {
      el.focus()
      if (newCursorPos !== undefined)
        el.setSelectionRange(newCursorPos, newCursorPos)

      captureCaret()
      ensureCaretVisibleInTextarea()
    }
  })
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
    const el = textarea.value
    if (el)
      el.focus()

    captureCaret()
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

// ============== 标签菜单（顺序很关键） ==============
const { t } = useI18n()
const allTagsRef = computed(() => props.allTags)

// 先声明（函数声明可提升），用于传入 useTagMenu
function handleSelectFromMenu(tag: string) {
  selectTag(tag)
}

// 先解构，避免 “used before it was defined”
const {
  mainMenuVisible: tagMenuVisible,
  tagMenuChildren,
} = useTagMenu(allTagsRef as unknown as any, handleSelectFromMenu, t)

const dropdownMaxHeight = ref(320)

// 选择标签：使用 lastSelectionStart，稳定替换“#片段”
function selectTag(tag: string) {
  const el = textarea.value
  if (!el)
    return

  const value = el.value
  const cursorPos = Number.isFinite(lastSelectionStart.value)
    ? Math.min(Math.max(lastSelectionStart.value, 0), value.length)
    : value.length

  const hashIndex = value.lastIndexOf('#', Math.max(cursorPos - 1, 0))

  let replaceFrom = -1
  if (hashIndex >= 0) {
    const between = value.slice(hashIndex + 1, cursorPos)
    if (!/\s/.test(between))
      replaceFrom = hashIndex
  }

  let newText = ''
  let newCursorPos = 0
  const textAfterCursor = value.slice(cursorPos)

  if (replaceFrom >= 0) {
    newText = `${value.slice(0, replaceFrom) + tag} ${textAfterCursor}`
    newCursorPos = replaceFrom + tag.length + 1
  }
  else {
    newText = `${value.slice(0, cursorPos) + tag} ${value.slice(cursorPos)}`
    newCursorPos = cursorPos + tag.length + 1
  }

  updateTextarea(newText, newCursorPos)
  tagMenuVisible.value = false
}

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
      const wrappedLabel = typeof o.label === 'function'
        ? () => h('div', { class: 'tag-row', onClick: click }, [o.label()])
        : o.label
      return { ...o, props: mergedProps, label: wrappedLabel }
    }
    return o
  })
}

function openTagMenu() {
  captureCaret()
  suppressNextBlur.value = true
  tagMenuVisible.value = true
}

const tagDropdownOptions = computed(() => injectClickHandlers(tagMenuChildren.value))

// ===== 全局：点外/ESC 关闭（适配 trigger="manual"） =====
function shouldKeepOpenByTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null
  if (!node)
    return false

  if (node.closest('.n-dropdown'))
    return true

  if (rootRef.value && node.closest('.toolbar-trigger') && rootRef.value.contains(node))
    return true

  return false
}

function handleGlobalPointerDown(e: PointerEvent) {
  if (!tagMenuVisible.value)
    return

  if (shouldKeepOpenByTarget(e.target))
    return

  tagMenuVisible.value = false
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && tagMenuVisible.value)
    tagMenuVisible.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', handleGlobalPointerDown, true)
  window.addEventListener('keydown', handleGlobalKeydown)

  // NEW：iOS/Android 键盘弹出会触发 visualViewport.resize
  const vv = (window as any).visualViewport
  if (vv) {
    const onVV = () => {
      if (isTypingViewport.value)
        requestAnimationFrame(ensureCaretVisibleInTextarea)
    }
    vv.addEventListener('resize', onVV)
    vv.addEventListener('scroll', onVV)
    // 存一下，卸载时移除
    ;(onMounted as any)._vvOff = () => {
      vv.removeEventListener('resize', onVV)
      vv.removeEventListener('scroll', onVV)
    }
  }
  if (props.isEditing)
    nextTick(() => forceEditingTextareaFullHeight())
})

watch(() => props.isEditing, (v) => {
  if (v)
    nextTick(() => forceEditingTextareaFullHeight())
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', handleGlobalPointerDown, true)
  window.removeEventListener('keydown', handleGlobalKeydown)

  const off = (onMounted as any)._vvOff
  if (off)
    off()
})

defineExpose({ reset: triggerResize })
</script>

<template>
  <div
    ref="rootRef"
    class="note-editor-reborn" :class="[isEditing ? 'editing-viewport' : '']"
  >
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
        @click="handleClick"
        @keydown="captureCaret"
        @keyup="captureCaret"
        @mouseup="captureCaret"
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

    <div class="editor-footer">
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

/* 编辑态容器 = 70% 屏高 */
.note-editor-reborn.editing-viewport {
  height: 70dvh;
  min-height: 70dvh;
  max-height: 70dvh;
  display: flex;
  flex-direction: column;
}
@supports not (height: 1dvh) {
  .note-editor-reborn.editing-viewport {
    height: 70vh;
    min-height: 70vh;
    max-height: 70vh;
  }
}

/* 编辑态内容区填满容器 */
.note-editor-reborn.editing-viewport .editor-wrapper {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 🔥 关键覆盖：无论有无内联高度，编辑态 textarea 一定拉满 70vh */
.note-editor-reborn.editing-viewport .editor-textarea {
  flex: 1 1 auto;
  min-height: 0;
  height: 100% !important;     /* 盖掉 autosize 写入的内联高度 */
  max-height: none !important; /* 盖掉任何残余上限（包括别处的 48vh） */
  overflow-y: auto;
}
</style>

<style>
.n-dropdown-menu.n-dropdown-menu--scrollable {
  max-height: min(60vh, 360px) !important;
  overflow-y: auto !important;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.n-dropdown-menu .tag-row {
  display: flex;
  align-items: center;
}

/* 统一命中所有 Naive 下拉菜单（不依赖 --scrollable 修饰） */
.n-dropdown-menu .tag-row {
  display: flex;
  align-items: center;
  width: 100%;         /* 关键：让这一行占满，右侧才能被自动推开 */
  min-width: 0;        /* 防止文本撑爆 */
}

/* 标签文本可选：允许截断，避免挤压星标 */
.n-dropdown-menu .tag-row .tag-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 星标推到最右，并加点内边距提升点击手感 */
.n-dropdown-menu .tag-row .pin-btn {
  margin-left: auto;   /* 关键：自动把星标推到最右 */
  padding-left: 12px;
  display: inline-flex;
  align-items: center;
  background: none;
  border: 0;
  cursor: pointer;
}
</style>
