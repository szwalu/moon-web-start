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

const emit = defineEmits([
  'update:modelValue',
  'save',
  'cancel',
  'focus',
  'blur',
  'heightChange',
])

/* ============== 极简 throttle（需先定义，供后续使用） ============== */
function throttle<T extends (...args: any[]) => void>(fn: T, wait = 200, leading = true) {
  let last = 0
  let timer: number | null = null

  return function (this: unknown, ...args: Parameters<T>) {
    const now = Date.now()
    const remaining = wait - (now - last)

    const invoke = () => {
      last = Date.now()
      fn.apply(this, args)
    }

    if (remaining <= 0 || (last === 0 && leading)) {
      if (timer !== null)
        window.clearTimeout(timer)

      timer = null
      invoke()
      return
    }

    if (timer === null) {
      timer = window.setTimeout(() => {
        timer = null
        last = Date.now()
        fn.apply(this, args)
      }, remaining)
    }
  }
}

/* ============== Store & v-model ============== */
const settingsStore = useSettingStore()

const contentModel = computed({
  get: () => {
    return props.modelValue
  },
  set: (value) => {
    emit('update:modelValue', value)
  },
})

/* ============== Autosize ============== */
const { textarea, input, triggerResize } = useTextareaAutosize({ input: contentModel })

const charCount = computed(() => {
  return contentModel.value.length
})

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
const allTagsRef = computed(() => {
  return props.allTags
})

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

/* ============== 键盘高度推断 & 安全底边 ============== */
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

/* ============== 动态 max-height（基于安全底边） ============== */
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
}

/* ============== 两阶段策略的状态 + 兜底函数（放在最前，供所有调用） ============== */
let inFocusPhase = false
let userIsTouchScrolling = false

const ensureCaretVisibleOnce = throttle(() => {
  if (!inFocusPhase)
    return

  const el = textarea.value
  const vv = window.visualViewport

  if (!el)
    return

  if (!vv)
    return

  const rect = el.getBoundingClientRect()
  const kbVar = getComputedStyle(document.documentElement).getPropertyValue('--kb')
  const kb = Number.parseFloat(kbVar) || 0
  const visibleBottom = vv.height - kb

  if (rect.bottom > visibleBottom) {
    el.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    })
  }
}, 200, true)

/* ============== IME 组合输入（在 ensure 之后声明） ============== */
const isComposing = ref(false)

function onCompositionStart() {
  isComposing.value = true
}

function onCompositionEnd() {
  isComposing.value = false
  nextTick(() => {
    applyDynamicMaxHeight()
    ensureCaretVisibleOnce()
  })
}

/* ============== Focus / Touch 事件（使用 ensure） ============== */
function onFocus() {
  inFocusPhase = true
  emit('focus')

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!userIsTouchScrolling && !isComposing.value)
        ensureCaretVisibleOnce()

      window.setTimeout(() => {
        inFocusPhase = false
      }, 600)
    })
  })
}

function onTouchStart() {
  userIsTouchScrolling = true
}

function onTouchEnd() {
  window.setTimeout(() => {
    userIsTouchScrolling = false
  }, 200)
}

/* ============== 键盘安全区监听（写入 --kb，并在变化时兜底） ============== */
function useKeyboardSafeArea(onChange?: () => void) {
  const apply = (px: number) => {
    const safe = Math.max(0, Math.min(px, 500))
    document.documentElement.style.setProperty('--kb', `${safe}px`)
  }

  let vv: VisualViewport | null = null
  let last = 0

  const handle = () => {
    if (!vv)
      return

    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)

    if (Math.abs(kb - last) > 2) {
      last = kb
      apply(kb)
      if (onChange)
        onChange()
    }
  }

  const vk = (navigator as any).virtualKeyboard

  onMounted(() => {
    vv = window.visualViewport ?? null

    if (vv) {
      vv.addEventListener('resize', handle)
      vv.addEventListener('scroll', handle)
      handle()
    }
    else {
      apply(0)
    }

    if (vk && typeof vk.addEventListener === 'function') {
      try {
        vk.overlaysContent = true
      }
      catch (_e) {
        // ignore
      }
      vk.addEventListener('geometrychange', handle)
    }
  })

  onUnmounted(() => {
    if (vv) {
      vv.removeEventListener('resize', handle)
      vv.removeEventListener('scroll', handle)
    }

    if (vk && typeof vk.removeEventListener === 'function')
      vk.removeEventListener('geometrychange', handle)
  })
}

useKeyboardSafeArea(() => {
  applyDynamicMaxHeight()

  if (!userIsTouchScrolling && !isComposing.value)
    ensureCaretVisibleOnce()

  calcDropdownMaxHeight()
})

/* ============== 稳妥回焦（双 rAF，使用 ensure） ============== */
function refocusEditorAndAnnounce() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = textarea.value
      if (el)
        el.focus()

      emit('focus')
      ensureCaretVisibleOnce()
    })
  })
}

/* ============== 选择标签（使用 ensure） ============== */
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

    if (o.type === 'group' && Array.isArray(o.children)) {
      return {
        ...o,
        children: injectClickHandlers(o.children),
      }
    }

    if (o.type === 'render')
      return o

    if (typeof o.key === 'string' && o.key.startsWith('#')) {
      const click = (_e: MouseEvent) => {
        handleSelectFromMenu(o.key)
        tagMenuVisible.value = false
      }

      const mergedProps = { ...(o.props || {}), onClick: click }

      const wrappedLabel = typeof o.label === 'function'
        ? () => {
            return h('div', { class: 'tag-row', onClick: click }, [o.label()])
          }
        : o.label

      return {
        ...o,
        props: mergedProps,
        label: wrappedLabel,
      }
    }

    return o
  })
}

function openTagMenu() {
  suppressNextBlur.value = true
  tagMenuVisible.value = true
}

const tagDropdownOptions = computed(() => {
  return injectClickHandlers(tagMenuChildren.value)
})

/* ============== 文本与插入工具（使用 ensure） ============== */
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
    ensureCaretVisibleOnce()
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

    tagSuggestions.value = props.allTags.filter((tag) => {
      return tag.toLowerCase().startsWith(`#${searchTerm.toLowerCase()}`)
    })

    if (tagSuggestions.value.length > 0) {
      const textLines = textBeforeCursor.split('\n')
      const currentLine = textLines.length - 1
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight)
      const topOffset = currentLine * lineHeight

      const measure = document.createElement('span')
      measure.style.cssText = [
        'position: absolute;',
        'visibility: hidden;',
        'font: inherit;',
        'white-space: pre;',
      ].join(' ')
      measure.textContent = textLines[currentLine].substring(0, textLines[currentLine].length)

      const parent = el.parentNode
      if (parent)
        parent.appendChild(measure)

      const leftOffset = measure.offsetWidth

      if (parent)
        parent.removeChild(measure)

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
      // 编辑阶段不主动滚动外层，只有 inFocusPhase 时兜一次
      ensureCaretVisibleOnce()
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
    ensureCaretVisibleOnce()
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

  const finalFullText = el.value.substring(0, start) + newTextFragment + el.value.substring(end)

  let newCursorPos = start + prefix.length
  if (selectedText)
    newCursorPos = start + newTextFragment.length

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
    if (el) {
      const ev = new Event('input')
      el.dispatchEvent(ev)
    }
    applyDynamicMaxHeight()
    ensureCaretVisibleOnce()
  })
}

function runToolbarAction(fn: () => void) {
  fn()

  nextTick(() => {
    const el = textarea.value
    if (el)
      el.focus()

    applyDynamicMaxHeight()
    ensureCaretVisibleOnce()
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
      ensureCaretVisibleOnce()
    })

    return
  }

  // 情况 2：普通列表项 -> 插入换行并续号
  event.preventDefault()

  const currentNumber = Number.parseInt(match[1], 10)
  const nextPrefix = `\n${currentNumber + 1}. `
  const before2 = el.value.substring(0, start)
  const after2 = el.value.substring(end)

  input.value = before2 + nextPrefix + after2

  nextTick(() => {
    el.focus()
    const newCursorPos = start + nextPrefix.length
    el.setSelectionRange(newCursorPos, newCursorPos)
    applyDynamicMaxHeight()
    ensureCaretVisibleOnce()
  })
}

/* ============== Watchers ============== */
watch(() => {
  return props.modelValue
}, (newValue) => {
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

/* ============== 初始挂载：尺寸与 Footer 观察 ============== */
onMounted(() => {
  calcDropdownMaxHeight()
  applyDynamicMaxHeight()

  const ro = new ResizeObserver(() => {
    applyDynamicMaxHeight()
  })

  const footer = editorFooterRef.value
  if (footer)
    ro.observe(footer)

  ;(editorFooterRef as any)._ro = ro
})

onUnmounted(() => {
  const ro: ResizeObserver | undefined = (editorFooterRef as any)._ro
  const footer = editorFooterRef.value

  if (ro && footer)
    ro.unobserve(footer)
})

// 打开下拉瞬间再算一次，确保精准
watch(() => {
  return tagMenuVisible.value
}, (v) => {
  if (v)
    calcDropdownMaxHeight()
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
        @touchstart="onTouchStart"
        @touchend="onTouchEnd"
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
        <button
          v-if="isEditing"
          type="button"
          class="btn-secondary"
          @click="handleCancel"
        >
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
  padding-bottom: var(--kb);
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
  scroll-padding-bottom: var(--kb);
  padding-bottom: var(--kb);
  overscroll-behavior: contain;
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
  scroll-margin-bottom: var(--kb);
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

<!-- 全局变量 --kb 放在非 scoped，确保能命中根节点 -->
<style>
:root { --kb: 0px; }

/* 只针对“可滚动”的 Naive UI 下拉，恢复高度与滚动（不会影响主页一级菜单） */
.n-dropdown-menu.n-dropdown-menu--scrollable {
  max-height: min(60vh, 360px) !important;
  overflow-y: auto !important;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
</style>
