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

/* ============== 容器 refs（用于动态测量） ============== */
const editorWrapperRef = ref<HTMLElement | null>(null)
const editorFooterRef = ref<HTMLElement | null>(null)

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
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight
  const kb = getKeyboardHeight()
  const effective = Math.max(200, Math.min(vh - 64, 360 - Math.min(kb, 200) * 0.25))
  dropdownMaxHeight.value = Math.round(effective)
}

// 抑制“打开标签下拉时”的那一次 blur 外发
const suppressNextBlur = ref(false)

// 稳妥回焦（双 rAF）
function refocusEditorAndAnnounce() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (textarea.value)
        textarea.value.focus()

      emit('focus')
      ensureCaretVisible()
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

// 连接 useTagMenu
const {
  mainMenuVisible: tagMenuVisible,
  tagMenuChildren,
} = useTagMenu(allTagsRef as unknown as any, handleSelectFromMenu, t)

// 为“叶子标签项”注入 onClick
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
    applyDynamicMaxHeight()
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

/* ============== 键盘高度与安全可见区（双保险） ============== */
function getVKRect(): DOMRect | null {
  const vk = (navigator as any).virtualKeyboard
  if (vk && vk.boundingRect && typeof vk.boundingRect === 'object') {
    const rect: DOMRect = vk.boundingRect
    if (rect && rect.height >= 1)
      return rect
  }
  return null
}

function getKeyboardHeight(): number {
  const vkRect = getVKRect()
  if (vkRect)
    return Math.round(vkRect.height)

  const vv = window.visualViewport
  if (vv) {
    const keyboardTop = vv.offsetTop + vv.height
    const h = Math.max(0, Math.round(window.innerHeight - keyboardTop))
    return h
  }
  return 0
}

/** 返回“安全可见底边”的 Y 坐标（键盘上沿 - padding） */
function getSafeViewportBottom(): number {
  const SAFE_PADDING = 10
  const vkRect = getVKRect()
  if (vkRect) {
    const keyboardTop = Math.min(window.innerHeight, Math.max(0, vkRect.top))
    return keyboardTop - SAFE_PADDING
  }
  const vv = window.visualViewport
  if (vv)
    return vv.offsetTop + vv.height - SAFE_PADDING

  return window.innerHeight - SAFE_PADDING
}

/* ============== 动态 max-height：基于安全底边精确限制 ============== */
function getFooterHeight(): number {
  const el = editorFooterRef.value
  if (!el)
    return 0

  return el.offsetHeight || 0
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
  // 不在此处直接滚动，滚动统一由 ensureCaretVisible 处理
}

/** 把光标移动到文本末尾，并确保滚到可见（键盘上沿之上） */
function moveCaretToEndAndReveal() {
  const el = textarea.value
  if (!el)
    return

  // 双 rAF + nextTick：等待键盘动画/视觉视口稳定后再定位
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      nextTick(() => {
        const len = el.value.length
        el.focus()
        el.setSelectionRange(len, len)
        // 先尽量把 textarea 内部滚到底（避免先前位置影响）
        el.scrollTop = el.scrollHeight

        // 动态限制高度，再确保可见
        applyDynamicMaxHeight()
        ensureCaretVisible()
      })
    })
  })
}

/** 焦点回调：外发 focus 事件 + 移至末尾并滚动到安全区 */
function onFocus() {
  emit('focus')
  moveCaretToEndAndReveal()
}

/* ============== 确保光标可见 ============== */
function ensureCaretVisible() {
  const el = textarea.value
  if (!el)
    return

  const style = getComputedStyle(el)

  // mirror 估算 caret 垂直位置
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

  // 先在 textarea 内部滚到可见
  const viewTop = el.scrollTop
  const viewBottom = el.scrollTop + el.clientHeight
  const caretDesiredTop = caretTopInTextarea - lineHeight * 0.5
  const caretDesiredBottom = caretTopInTextarea + lineHeight * 1.5

  if (caretDesiredBottom > viewBottom)
    el.scrollTop = Math.min(caretDesiredBottom - el.clientHeight, el.scrollHeight - el.clientHeight)
  else if (caretDesiredTop < viewTop)
    el.scrollTop = Math.max(caretDesiredTop, 0)

  // 再保证外层滚动容器/窗口不被键盘遮挡
  const scrollable = getScrollableAncestor(el)
  const caretAbsTop = el.getBoundingClientRect().top + (caretTopInTextarea - el.scrollTop)
  const visibleBottom = scrollable
    ? Math.min(scrollable.getBoundingClientRect().bottom, getSafeViewportBottom())
    : getSafeViewportBottom()
  const visibleTop = scrollable ? scrollable.getBoundingClientRect().top : 0
  const padding = 8

  const caretAbsBottom = caretAbsTop + lineHeight * 1.2
  if (caretAbsBottom > visibleBottom) {
    const delta = (caretAbsBottom - visibleBottom) + padding
    if (scrollable)
      scrollable.scrollTop += delta
    else
      window.scrollBy({ top: delta, left: 0, behavior: 'smooth' })
  }
  else if (caretAbsTop < visibleTop) {
    const delta = (visibleTop - caretAbsTop) + padding
    if (scrollable)
      scrollable.scrollTop -= delta
    else
      window.scrollBy({ top: -delta, left: 0, behavior: 'smooth' })
  }
}

/* ============== 监听键盘/可视区域几何变化（双保险） ============== */
function handleViewportChange() {
  requestAnimationFrame(() => {
    nextTick(() => {
      applyDynamicMaxHeight()
      ensureCaretVisible()
      calcDropdownMaxHeight()

      // 如果当前正在编辑（textarea 有焦点），再贴边一次更保险
      const el = textarea.value
      if (el && document.activeElement === el) {
        // 不改变选区（如果用户手动选中间就尊重），只做可见性校正
        // 但如果你希望“始终到末尾”，可以改为 moveCaretToEndAndReveal()
        ensureCaretVisible()
      }
    })
  })
}

onMounted(() => {
  // 初始计算
  calcDropdownMaxHeight()
  applyDynamicMaxHeight()
  window.addEventListener('resize', calcDropdownMaxHeight)

  // Android/Chrome：Virtual Keyboard API
  const vk = (navigator as any).virtualKeyboard
  if (vk && typeof vk.addEventListener === 'function') {
    try {
      vk.overlaysContent = true
    }
    catch (_e) {
      // ignore
    }
    vk.addEventListener('geometrychange', handleViewportChange)
  }

  // 其它浏览器：visualViewport
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportChange)
    window.visualViewport.addEventListener('scroll', handleViewportChange)
  }

  // 监听 footer 高度变化（按钮显隐、文字换行等）
  const ro = new ResizeObserver(() => {
    applyDynamicMaxHeight()
  })
  if (editorFooterRef.value)
    ro.observe(editorFooterRef.value)

  ;(editorFooterRef as any)._ro = ro
})

onUnmounted(() => {
  window.removeEventListener('resize', calcDropdownMaxHeight)

  const vk = (navigator as any).virtualKeyboard
  if (vk && typeof vk.removeEventListener === 'function') {
    try {
      vk.overlaysContent = true
    }
    catch (_e) {
      // ignore
    }
    vk.removeEventListener('geometrychange', handleViewportChange)
  }
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', handleViewportChange)
    window.visualViewport.removeEventListener('scroll', handleViewportChange)
  }

  const ro: ResizeObserver | undefined = (editorFooterRef as any)._ro
  if (ro && editorFooterRef.value)
    ro.unobserve(editorFooterRef.value)
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
    applyDynamicMaxHeight()
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

// 抽出单独 onBlur，避免模板中一行两语句
function onBlur() {
  handleBlur()
  emit('blur')
}

function handleBlur() {
  if (suppressNextBlur.value) {
    suppressNextBlur.value = false
    return
  }
  blurTimeoutId = window.setTimeout(() => {
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
      applyDynamicMaxHeight()
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
    applyDynamicMaxHeight()
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

function _addTag() {
  insertText('#')
  nextTick(() => {
    const el = textarea.value
    if (el)
      el.dispatchEvent(new Event('input'))

    applyDynamicMaxHeight()
    ensureCaretVisible()
  })
}

function runToolbarAction(fn: () => void) {
  fn()
  nextTick(() => {
    if (textarea.value)
      textarea.value.focus()

    applyDynamicMaxHeight()
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

  // 情况 1：空的列表项 -> 取消列表并换行
  if (currentLine.trim() === match[0].trim()) {
    event.preventDefault()
    const before = el.value.substring(0, currentLineStart - 1)
    const after = el.value.substring(end)
    input.value = before + after

    nextTick(() => {
      el.focus()
      const pos = currentLineStart - 1
      el.setSelectionRange(pos, pos)
      applyDynamicMaxHeight()
      ensureCaretVisible()
    })
    return
  }

  // 情况 2：普通列表项 -> 插入换行并续号
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
    applyDynamicMaxHeight()
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
  const newLineContent = headingRegex.test(currentLine)
    ? currentLine.replace(headingRegex, '')
    : `## ${currentLine}`

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
  <div class="note-editor-reborn">
    <div ref="editorWrapperRef" class="editor-wrapper">
      <textarea
        ref="textarea"
        v-model="input"
        class="editor-textarea"
        :class="`font-size-${settingsStore.noteFontSize}`"
        :placeholder="placeholder"
        :maxlength="maxNoteLength"
        @focus="onFocus"
        @blur="onBlur"
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

    <div ref="editorFooterRef" class="editor-footer">
      <div class="footer-left">
        <div class="editor-toolbar">
          <!-- 用标签下拉替换原按钮（默认插槽仅一个子节点） -->
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
            @keydown.enter.prevent="runToolbarAction(addTodo)"
            @keydown.space.prevent="runToolbarAction(addTodo)"
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
            @keydown.enter.prevent="runToolbarAction(addBold)"
            @keydown.space.prevent="runToolbarAction(addBold)"
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
            @keydown.enter.prevent="runToolbarAction(addOrderedList)"
            @keydown.space.prevent="runToolbarAction(addOrderedList)"
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
            @keydown.enter.prevent="runToolbarAction(addHeading)"
            @keydown.space.prevent="runToolbarAction(addHeading)"
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
            @keydown.enter.prevent="runToolbarAction(addItalic)"
            @keydown.space.prevent="runToolbarAction(addItalic)"
          >
            I
          </button>
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
  overflow-anchor: none; /* 避免锚定抖动 */
}

.editor-textarea {
  width: 100%;
  min-height: 40px;
  /* 下面这行仅作兜底；运行时由 JS 动态设置像素 max-height 覆盖它 */
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
  scrollbar-gutter: stable both-edges; /* 滚动条出现不抖动 */
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

/* --- Toolbar --- */
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

/* 触发器包裹，确保 NDropdown 默认插槽只有一个子节点 */
.toolbar-trigger {
  display: inline-flex;
  align-items: center;
}

/* 这里不要再强行设定高度，交给 props 控制；滚动增强 */
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
