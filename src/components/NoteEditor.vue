<script setup lang="ts">
import { computed, defineExpose, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTextareaAutosize } from '@vueuse/core'
import { NDropdown } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingStore } from '@/stores/setting'
import { useTagMenu } from '@/composables/useTagMenu'

/* ============== Props & Emits ============== */
const props = defineProps({
  modelValue: { type: String, required: true },
  isEditing: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  maxNoteLength: { type: Number, default: 5000 },
  placeholder: { type: String, default: '写点什么...' },
  allTags: { type: Array as () => string[], default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'save', 'cancel', 'focus', 'blur', 'heightChange'])

/* ============== Store ============== */
const settingsStore = useSettingStore()

/* ============== v-model（外层值） ============== */
const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
  },
})

/* ============== Autosize ============== */
const { textarea, input, triggerResize } = useTextareaAutosize({ input: contentModel })
const charCount = computed(() => contentModel.value.length)

/* ============== Tag 提示 ============== */
const showTagSuggestions = ref(false)
const tagSuggestions = ref<string[]>([])
const suggestionsStyle = ref({ top: '0px', left: '0px' })
let blurTimeoutId: number | null = null

/* ============== 标签下拉（useTagMenu 接入） ============== */
const { t } = useI18n()
const allTagsRef = computed(() => props.allTags)

// 菜单最大高度：随屏幕/键盘动态调整
const dropdownMaxHeight = ref(320)
function calcDropdownMaxHeight() {
  const vv = window.visualViewport
  const vh = vv ? vv.height : window.innerHeight
  dropdownMaxHeight.value = Math.round(Math.min(vh * 0.6, 360))
}

// 抑制“打开标签下拉时”的那一次 blur 外发
const suppressNextBlur = ref(false)

// 稳妥回焦（双 rAF）
function refocusEditorAndAnnounce() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      textarea.value?.focus()
      emit('focus')
    })
  })
}

function handleSelectFromMenu(tag: string) {
  const el = textarea.value
  if (!el)
    return

  const cursorPos = el.selectionStart
  const before = el.value.substring(0, cursorPos)
  const lastHashIndex = before.lastIndexOf('#')
  const after = el.value.substring(cursorPos)

  if (lastHashIndex !== -1 && !/\s/.test(before.substring(lastHashIndex + 1))) {
    selectTag(tag)
    refocusEditorAndAnnounce()
    return
  }

  const textToInsert = `${tag} `
  const newText = `${before}${textToInsert}${after}`
  const newPos = cursorPos + textToInsert.length
  updateTextarea(newText, newPos)
  refocusEditorAndAnnounce()
}

const {
  mainMenuVisible: tagMenuVisible,
  tagMenuChildren,
} = useTagMenu(allTagsRef as unknown as any, handleSelectFromMenu, t)

type Opt = any
function injectClickHandlers(opts: Opt[]): Opt[] {
  return opts.map((o: any) => {
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
      const wrappedLabel
        = typeof o.label === 'function'
          ? () => h('div', { class: 'tag-row', onClick: click }, [o.label()])
          : o.label
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

/* ============== IME 组合输入支持 ============== */
const isComposing = ref(false)
function onCompositionStart() {
  isComposing.value = true
}
function onCompositionEnd() {
  isComposing.value = false
  nextTick(() => {
    ensureCaretVisible()
  })
}

/* ============== 可滚动祖先容器 ============== */
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

/* ============== 视觉视口（键盘弹出占用） ============== */
function getSafeViewportBottom(): number {
  const vv = window.visualViewport
  const SAFE_PADDING = 10
  if (vv)
    return vv.offsetTop + vv.height - SAFE_PADDING
  return window.innerHeight - SAFE_PADDING
}

/* ============== 确保光标可见 ============== */
function ensureCaretVisible() {
  const el = textarea.value
  if (!el)
    return

  const style = getComputedStyle(el)
  const mirror = document.createElement('div')
  mirror.style.cssText = `
    position:absolute; visibility:hidden; white-space:pre-wrap; word-wrap:break-word;
    box-sizing:border-box; top:0; left:-9999px; width:${el.clientWidth}px;
    font:${style.font}; line-height:${style.lineHeight};
    padding:${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft};
    border:${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth} solid transparent;
  `
  document.body.appendChild(mirror)

  const val = el.value
  const selEnd = el.selectionEnd ?? val.length
  const before = val.slice(0, selEnd).replace(/\n$/, '\n ').replace(/ /g, '\u00A0')
  mirror.textContent = before

  const lineHeight = Number.parseFloat(style.lineHeight || '20')
  const caretTopInTextarea = mirror.scrollHeight - Number.parseFloat(style.paddingBottom || '0')
  document.body.removeChild(mirror)

  const viewTop = el.scrollTop
  const viewBottom = el.scrollTop + el.clientHeight
  const caretDesiredTop = caretTopInTextarea - lineHeight * 0.5
  const caretDesiredBottom = caretTopInTextarea + lineHeight * 1.5

  if (caretDesiredBottom > viewBottom) {
    const newTop = Math.min(caretDesiredBottom - el.clientHeight, el.scrollHeight - el.clientHeight)
    el.scrollTop = newTop
  }
  else if (caretDesiredTop < viewTop) {
    el.scrollTop = Math.max(caretDesiredTop, 0)
  }

  const scrollable = getScrollableAncestor(el)
  if (scrollable) {
    const caretAbsTop = el.getBoundingClientRect().top + (caretTopInTextarea - el.scrollTop)
    const ancRect = scrollable.getBoundingClientRect()
    const visibleBottom = Math.min(ancRect.bottom, getSafeViewportBottom())
    const visibleTop = ancRect.top
    const padding = 8

    if (caretAbsTop + lineHeight * 1.5 > visibleBottom) {
      const deltaDown = (caretAbsTop + lineHeight * 1.5) - visibleBottom + padding
      scrollable.scrollTop += deltaDown
    }
    else if (caretAbsTop - lineHeight * 0.5 < visibleTop) {
      const deltaUp = visibleTop - (caretAbsTop - lineHeight * 0.5) + padding
      scrollable.scrollTop -= deltaUp
    }
  }
  else {
    const caretAbsTop2 = el.getBoundingClientRect().top + (caretTopInTextarea - el.scrollTop)
    const safeBottom = getSafeViewportBottom()
    const delta = (caretAbsTop2 + lineHeight * 1.8) - safeBottom
    if (delta > 0)
      window.scrollBy({ top: delta + 8, left: 0, behavior: 'smooth' })
  }
}

function handleViewportChange() {
  requestAnimationFrame(() => {
    nextTick(() => {
      ensureCaretVisible()
      calcDropdownMaxHeight()
    })
  })
}

/* ============== 移动端浮动工具条（Teleport 版） ============== */
const isMobile = ref(false)
const isKeyboardOpen = ref(false)
const focused = ref(false)
const keyboardHeight = ref(0)

function updateIsMobile() {
  // 更稳妥：触摸或较窄视口任一成立
  isMobile.value = window.matchMedia('(pointer: coarse), (max-width: 900px)').matches
}

function updateKeyboardState() {
  const vv = window.visualViewport
  if (!vv) {
    isKeyboardOpen.value = false
    keyboardHeight.value = 0
    return
  }
  const shrink = window.innerHeight - (vv.height + vv.offsetTop)
  keyboardHeight.value = Math.max(0, shrink)
  isKeyboardOpen.value = keyboardHeight.value > 80 // 阈值可微调
}

const showFloating = computed(() => isMobile.value && (focused.value || isKeyboardOpen.value))
const footerPadPx = computed(() => (showFloating.value ? 64 : 0))

function handleFocus() {
  focused.value = true
  emit('focus')
}
function handleBlur() {
  if (suppressNextBlur.value) {
    suppressNextBlur.value = false
    return
  }
  blurTimeoutId = window.setTimeout(() => {
    showTagSuggestions.value = false
  }, 200)
  focused.value = false
  emit('blur')
}

/* ============== 生命周期 & 事件 ============== */
function onDocFocusIn(e: FocusEvent) {
  const target = e.target as HTMLElement | null
  const el = textarea.value
  focused.value = !!(el && target && (target === el || el.contains(target)))
}
function onDocFocusOut(_e: FocusEvent) {
  // 让真正的 blur 里处理，避免与 suppressNextBlur 冲突
}

onMounted(() => {
  calcDropdownMaxHeight()
  window.addEventListener('resize', calcDropdownMaxHeight)

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportChange)
    window.visualViewport.addEventListener('scroll', handleViewportChange)
  }

  updateIsMobile()
  updateKeyboardState()
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateKeyboardState)
    window.visualViewport.addEventListener('scroll', updateKeyboardState)
  }
  window.addEventListener('resize', updateIsMobile)
  window.addEventListener('orientationchange', updateIsMobile)

  document.addEventListener('focusin', onDocFocusIn)
  document.addEventListener('focusout', onDocFocusOut)
})

onUnmounted(() => {
  window.removeEventListener('resize', calcDropdownMaxHeight)
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', handleViewportChange)
    window.visualViewport.removeEventListener('scroll', handleViewportChange)
    window.visualViewport.removeEventListener('resize', updateKeyboardState)
    window.visualViewport.removeEventListener('scroll', updateKeyboardState)
  }
  window.removeEventListener('resize', updateIsMobile)
  window.removeEventListener('orientationchange', updateIsMobile)

  document.removeEventListener('focusin', onDocFocusIn)
  document.removeEventListener('focusout', onDocFocusOut)
})

// 打开下拉瞬间再算一次，确保精准
watch(() => tagMenuVisible.value, (v) => {
  if (v)
    calcDropdownMaxHeight()
})

/* ============== 文本与插入工具 ============== */
function updateTextarea(newText: string, newCursorPos: number) {
  const el = textarea.value
  if (!el)
    return

  const originalScrollTop = el.scrollTop
  input.value = newText
  nextTick(() => {
    el.focus()
    el.setSelectionRange(newCursorPos, newCursorPos)
    el.scrollTop = Math.min(originalScrollTop, el.scrollHeight - el.clientHeight)
    ensureCaretVisible()
  })
}

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

      const host = el as HTMLElement
      suggestionsStyle.value = {
        top: `${host.offsetTop + topOffset + lineHeight}px`,
        left: `${host.offsetLeft + leftOffset}px`,
      }
      showTagSuggestions.value = true
    }
    else {
      showTagSuggestions.value = false
    }
  }

  if (!isComposing.value) {
    nextTick(() => {
      ensureCaretVisible()
    })
  }
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

  input.value = newText
  showTagSuggestions.value = false

  nextTick(() => {
    const newCursorPos = lastHashIndex + tag.length + 1
    el.focus()
    el.setSelectionRange(newCursorPos, newCursorPos)
    ensureCaretVisible()
  })
}

function reset() {
  triggerResize()
}
defineExpose({ reset })

function insertText(prefix: string, suffix: string = '') {
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

// 备用：通过按钮触发插入 #（以下划线前缀避免未使用报错）
function _addTag() {
  insertText('#')
  nextTick(() => {
    const el = textarea.value
    if (el)
      el.dispatchEvent(new Event('input'))
    ensureCaretVisible()
  })
}

function runToolbarAction(fn: () => void) {
  fn()
  nextTick(() => {
    textarea.value?.focus()
    ensureCaretVisible()
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
  if (event.key !== 'Enter')
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
    input.value = before + after
    nextTick(() => {
      el.focus()
      const pos = currentLineStart - 1
      el.setSelectionRange(pos, pos)
      ensureCaretVisible()
    })
    return
  }

  event.preventDefault()
  const currentNumber = Number.parseInt(match[1], 10)
  const nextPrefix = `\n${currentNumber + 1}. `
  const before = el.value.substring(0, start)
  const after = el.value.substring(end)
  input.value = before + nextPrefix + after
  nextTick(() => {
    el.focus()
    const newCursorPos = start + nextPrefix.length
    el.setSelectionRange(newCursorPos, newCursorPos)
    ensureCaretVisible()
  })
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
  const newLineContent = headingRegex.test(currentLine) ? currentLine.replace(headingRegex, '') : `## ${currentLine}`
  const finalFullText = el.value.substring(0, lineStart) + newLineContent + el.value.substring(lineEnd)
  const newCursorPos = lineStart + newLineContent.length
  updateTextarea(finalFullText, newCursorPos)
}

/* ============== Watchers（尽量精简） ============== */
watch(() => props.modelValue, (newValue) => {
  if (newValue === '') {
    nextTick(() => {
      triggerResize()
    })
  }
})

// 高度变化 -> 通知父组件重新布局
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
  <div class="note-editor-reborn" :style="{ paddingBottom: `${footerPadPx}px` }">
    <div class="editor-wrapper">
      <textarea
        ref="textarea"
        v-model="input"
        class="editor-textarea"
        :class="`font-size-${settingsStore.noteFontSize}`"
        :placeholder="placeholder"
        :maxlength="maxNoteLength"
        @focus="handleFocus"
        @blur="handleBlur"
        @keydown="handleEnterKey"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
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

    <!-- 桌面端：普通版工具条（组件内，非浮动） -->
    <div
      v-show="!isMobile"
      class="editor-footer"
    >
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
              <button type="button" class="toolbar-btn" title="添加标签" @click.stop="openTagMenu">#</button>
            </span>
          </NDropdown>

          <button
            type="button" class="toolbar-btn" title="待办事项"
            @mousedown.prevent @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addTodo)"
            @keydown.enter.prevent="runToolbarAction(addTodo)"
            @keydown.space.prevent="runToolbarAction(addTodo)"
          >
            ✓
          </button>

          <button
            type="button" class="toolbar-btn" title="加粗"
            @mousedown.prevent @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addBold)"
            @keydown.enter.prevent="runToolbarAction(addBold)"
            @keydown.space.prevent="runToolbarAction(addBold)"
          >
            B
          </button>

          <button
            type="button" class="toolbar-btn" title="数字列表"
            @mousedown.prevent @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addOrderedList)"
            @keydown.enter.prevent="runToolbarAction(addOrderedList)"
            @keydown.space.prevent="runToolbarAction(addOrderedList)"
          >
            1.
          </button>

          <button
            type="button" class="toolbar-btn" title="添加标题"
            @mousedown.prevent @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addHeading)"
            @keydown.enter.prevent="runToolbarAction(addHeading)"
            @keydown.space.prevent="runToolbarAction(addHeading)"
          >
            H
          </button>

          <button
            type="button" class="toolbar-btn" title="斜体"
            @mousedown.prevent @touchstart.prevent
            @pointerdown.prevent="runToolbarAction(addItalic)"
            @keydown.enter.prevent="runToolbarAction(addItalic)"
            @keydown.space.prevent="runToolbarAction(addItalic)"
          >
            I
          </button>
        </div>
        <span class="char-counter">{{ charCount }}/{{ maxNoteLength }}</span>
      </div>
      <div class="actions">
        <button v-if="isEditing" type="button" class="btn-secondary" @click="handleCancel">取消</button>
        <button type="button" class="btn-primary" :disabled="isLoading || !contentModel" @click="handleSave">保存</button>
      </div>
    </div>

    <!-- 移动端：浮动版工具条（Teleport 到 body，确保贴着键盘上沿） -->
    <teleport to="body">
      <div
        v-show="isMobile && showFloating"
        class="editor-footer floating"
        role="toolbar"
        aria-label="编辑工具"
      >
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
                <button type="button" class="toolbar-btn" title="添加标签" @click.stop="openTagMenu">#</button>
              </span>
            </NDropdown>

            <button
              type="button" class="toolbar-btn" title="待办事项"
              @mousedown.prevent @touchstart.prevent
              @pointerdown.prevent="runToolbarAction(addTodo)"
              @keydown.enter.prevent="runToolbarAction(addTodo)"
              @keydown.space.prevent="runToolbarAction(addTodo)"
            >
              ✓
            </button>

            <button
              type="button" class="toolbar-btn" title="加粗"
              @mousedown.prevent @touchstart.prevent
              @pointerdown.prevent="runToolbarAction(addBold)"
              @keydown.enter.prevent="runToolbarAction(addBold)"
              @keydown.space.prevent="runToolbarAction(addBold)"
            >
              B
            </button>

            <button
              type="button" class="toolbar-btn" title="数字列表"
              @mousedown.prevent @touchstart.prevent
              @pointerdown.prevent="runToolbarAction(addOrderedList)"
              @keydown.enter.prevent="runToolbarAction(addOrderedList)"
              @keydown.space.prevent="runToolbarAction(addOrderedList)"
            >
              1.
            </button>

            <button
              type="button" class="toolbar-btn" title="添加标题"
              @mousedown.prevent @touchstart.prevent
              @pointerdown.prevent="runToolbarAction(addHeading)"
              @keydown.enter.prevent="runToolbarAction(addHeading)"
              @keydown.space.prevent="runToolbarAction(addHeading)"
            >
              H
            </button>

            <button
              type="button" class="toolbar-btn" title="斜体"
              @mousedown.prevent @touchstart.prevent
              @pointerdown.prevent="runToolbarAction(addItalic)"
              @keydown.enter.prevent="runToolbarAction(addItalic)"
              @keydown.space.prevent="runToolbarAction(addItalic)"
            >
              I
            </button>
          </div>
          <span class="char-counter">{{ charCount }}/{{ maxNoteLength }}</span>
        </div>

        <div class="actions">
          <button v-if="isEditing" type="button" class="btn-secondary" @click="handleCancel">取消</button>
          <button type="button" class="btn-primary" :disabled="isLoading || !contentModel" @click="handleSave">保存</button>
        </div>
      </div>
    </teleport>
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

.char-counter { font-size: 12px; color: #6b7280; }
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

/* 提示浮层（输入 # 的联想） */
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

/* --- Toolbar / Footer（普通版） --- */
.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  border-top: none;
  background-color: transparent;
}
.dark .editor-footer { background-color: transparent; border-top: none; }

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

.toolbar-trigger { display: inline-flex; align-items: center; }

/* --- 移动端浮动工具条（Teleport 到 body） --- */
.editor-footer.floating {
  position: fixed;
  left: 0;
  right: 0;
  bottom: max(8px, env(safe-area-inset-bottom));
  z-index: 2147483647; /* 顶层，避免被上层布局覆盖 */
  margin: 0 12px;
  padding: 6px 12px;
  border-radius: 10px;
  backdrop-filter: saturate(180%) blur(10px);
  background-color: rgba(250,250,250,0.96);
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  border: 1px solid rgba(0,0,0,0.06);
}
.dark .editor-footer.floating {
  background-color: rgba(44,44,46,0.92);
  border-color: rgba(255,255,255,0.08);
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.editor-footer.floating .btn-primary,
.editor-footer.floating .btn-secondary {
  padding: 6px 10px;
  font-size: 14px;
}
.editor-footer.floating .char-counter { font-size: 12px; }

/* Naive UI 下拉增强 */
:global(.n-dropdown-menu) {
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
</style>

<!-- 只针对“可滚动”的 Naive UI 下拉，恢复高度与滚动（不会影响主页一级菜单） -->
<style>
.n-dropdown-menu.n-dropdown-menu--scrollable {
  max-height: min(60vh, 360px) !important;
  overflow-y: auto !important;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
</style>
