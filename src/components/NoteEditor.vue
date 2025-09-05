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
const editorMainRef = ref<HTMLDivElement | null>(null)
const isComposing = ref(false)
const isEditingInline = computed(() => !!props.editingNote)

// 输入法/键盘底部偏移（px）
const imeBottomOffset = ref(0)

const contentModel = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const editorFontSizeClass = computed(() => {
  const sizeMap: Record<string, string> = {
    'small': 'font-size-small',
    'medium': 'font-size-medium',
    'large': 'font-size-large',
    'extra-large': 'font-size-extra-large',
  }
  return sizeMap[settingsStore.noteFontSize] || 'font-size-medium'
})

/** mirror div：获取光标相对页面的 Y（像素） */
function getCaretPageY(ta: HTMLTextAreaElement): number | null {
  const cs = getComputedStyle(ta)
  const mirror = document.createElement('div')

  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordWrap = 'break-word'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.boxSizing = cs.boxSizing
  mirror.style.fontFamily = cs.fontFamily
  mirror.style.fontSize = cs.fontSize
  mirror.style.fontWeight = cs.fontWeight
  mirror.style.lineHeight = cs.lineHeight
  mirror.style.letterSpacing = cs.letterSpacing
  mirror.style.padding = cs.padding
  mirror.style.border = cs.border
  mirror.style.width = `${ta.clientWidth}px`

  const taRect = ta.getBoundingClientRect()
  mirror.style.left = `${window.scrollX + taRect.left}px`
  mirror.style.top = `${window.scrollY + taRect.top}px`

  const value = ta.value
  const selEnd = ta.selectionEnd ?? value.length
  const before = value.slice(0, selEnd).replace(/\n$/g, '\n ').replace(/ /g, '\u00A0').replace(/\n/g, '<br/>')
  const after = value.slice(selEnd).replace(/ /g, '\u00A0').replace(/\n/g, '<br/>')

  mirror.innerHTML = `${before}<span data-caret></span>${after}`
  document.body.appendChild(mirror)

  const caretSpan = mirror.querySelector('span[data-caret]') as HTMLSpanElement | null
  let caretY: number | null = null
  if (caretSpan) {
    const caretRect = caretSpan.getBoundingClientRect()
    caretY = window.scrollY + caretRect.top
  }
  document.body.removeChild(mirror)
  return caretY
}

/** 让 .editor-main 容器滚动，保证“光标行”可见（考虑保存栏 + IME + 安全区） */
function ensureCaretVisibleInContainer() {
  const ta = textareaRef.value
  const container = editorMainRef.value
  if (!ta || !container)
    return

  const ACTIONS_HEIGHT = 56
  const vv = (window as any).visualViewport
  const safeFromVV = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0
  const bottomReserve = Math.max(imeBottomOffset.value, safeFromVV) + ACTIONS_HEIGHT + 16

  const caretPageY = getCaretPageY(ta)
  if (caretPageY == null)
    return

  const containerRect = container.getBoundingClientRect()
  const containerPageTop = window.scrollY + containerRect.top

  // 光标相对容器内容起点的 Y 坐标（不随容器滚动）
  const caretInContainer = caretPageY - containerPageTop

  const viewTop = container.scrollTop
  const viewHeight = container.clientHeight
  const viewBottom = viewTop + viewHeight
  const targetBottom = caretInContainer + bottomReserve

  const lineHeight = Number.parseFloat(getComputedStyle(ta).lineHeight || '24')

  if (targetBottom > viewBottom - 2) {
    const newTop = targetBottom - viewHeight
    container.scrollTop = Math.min(newTop, container.scrollHeight - viewHeight)
  }
  else if (caretInContainer - lineHeight < viewTop + 2) {
    const newTop = Math.max(caretInContainer - lineHeight - 8, 0)
    container.scrollTop = newTop
  }
}

function handleSubmit() {
  if (props.isLoading || !contentModel.value.trim())
    return
  emit('submit')
}

function insertTag() {
  const el = textareaRef.value
  if (!el)
    return
  const cursor = el.selectionStart
  const text = contentModel.value
  contentModel.value = `${text.slice(0, cursor)}#${text.slice(cursor)}`
  nextTick(() => {
    const ta = textareaRef.value!
    ta.selectionStart = ta.selectionEnd = cursor + 1
    ta.focus()
    ensureCaretVisibleInContainer()
  })
}

function insertCheckbox() {
  const el = textareaRef.value
  if (!el)
    return
  const cursor = el.selectionStart
  const text = contentModel.value
  const lineStart = text.lastIndexOf('\n', cursor - 1) + 1
  contentModel.value = `${text.slice(0, lineStart)}- [ ] ${text.slice(lineStart)}`
  nextTick(() => {
    const ta = textareaRef.value!
    const newCursor = cursor + 6
    ta.selectionStart = ta.selectionEnd = newCursor
    ta.focus()
    ensureCaretVisibleInContainer()
  })
}

let resizeObserver: ResizeObserver | null = null

// IME 高度更新函数
function updateImeOffsetFn() {
  const vv = (window as any).visualViewport
  if (!vv) {
    imeBottomOffset.value = 0
    return
  }
  const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  imeBottomOffset.value = keyboard > 80 ? Math.round(keyboard) : 0
}

onMounted(() => {
  const ta = textareaRef.value
  if (ta) {
    autosize(ta)

    if (!isEditingInline.value) {
      ta.focus()
    }
    else {
      const len = ta.value.length
      ta.focus()
      ta.setSelectionRange(len, len)
    }

    // textarea 自身高度变化（autosize）时，保持光标可见
    resizeObserver = new ResizeObserver(() => {
      if (document.activeElement === ta)
        ensureCaretVisibleInContainer()
    })
    resizeObserver.observe(ta)

    // 初次也校正一次
    nextTick(() => ensureCaretVisibleInContainer())
  }

  updateImeOffsetFn()
  const vv = (window as any).visualViewport
  if (vv) {
    vv.addEventListener('resize', updateImeOffsetFn)
    vv.addEventListener('scroll', updateImeOffsetFn)
  }
})

onUnmounted(() => {
  if (textareaRef.value && resizeObserver)
    resizeObserver.unobserve(textareaRef.value)

  if (textareaRef.value)
    autosize.destroy(textareaRef.value)

  const vv = (window as any).visualViewport
  if (vv) {
    vv.removeEventListener('resize', updateImeOffsetFn)
    vv.removeEventListener('scroll', updateImeOffsetFn)
  }
})

watch(
  () => props.editingNote?.id,
  (newId, oldId) => {
    if (newId !== oldId && textareaRef.value) {
      nextTick(() => {
        const el = textareaRef.value!
        autosize.update(el)
        el.focus()
        ensureCaretVisibleInContainer()
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
    <div ref="editorMainRef" class="editor-main">
      <textarea
        ref="textareaRef"
        v-model="contentModel"
        :placeholder="t('notes.content_placeholder', '写点什么...')"
        class="editor-textarea"
        :class="editorFontSizeClass"
        rows="3"
        @compositionstart="isComposing = true"
        @compositionend="() => { isComposing = false; ensureCaretVisibleInContainer() }"
        @input="ensureCaretVisibleInContainer"
        @keyup="ensureCaretVisibleInContainer"
        @click="ensureCaretVisibleInContainer"
        @focus="ensureCaretVisibleInContainer"
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
  padding-bottom: env(safe-area-inset-bottom); /* iOS 安全区 */
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

/* 👇 核心：固定为“半屏多一点”的高度，由容器滚动 */
.editor-main {
  padding: 12px 16px 8px;
  flex: 0 0 auto;
  max-height: 58dvh; /* 你要的：页面的一半多一点；可按需改 56~60dvh */
  overflow-y: auto;

  /* 为底部操作区 + IME + 安全区预留空间（滚动缓冲 & 视觉留白） */
  padding-bottom: calc(16px + var(--ime-bottom, 0px) + env(safe-area-inset-bottom) + 56px);
  scroll-padding-bottom: calc(16px + var(--ime-bottom, 0px) + env(safe-area-inset-bottom) + 56px);
}

/* 文本域：只自适应高度（autosize），不滚自己 */
.editor-textarea {
  width: 100%;
  border: none;
  background-color: transparent;
  resize: none;     /* autosize 控制高度 */
  outline: none;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.6;
  color: #333;
  box-sizing: border-box;
  overflow: hidden;
  display: block;
  min-height: 3.2em;
}

.dark .editor-textarea { color: #f0f0f0; }
.editor-textarea::placeholder { color: #999; }
.dark .editor-textarea::placeholder { color: #777; }

.editor-textarea.font-size-small { font-size: 14px; }
.editor-textarea.font-size-medium { font-size: 16px; }
.editor-textarea.font-size-large { font-size: 20px; }
.editor-textarea.font-size-extra-large { font-size: 22px; }

/* 操作区 sticky 在卡片内部底部，与滚动容器独立 */
.editor-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-top: 1px solid #eee;
  min-height: 56px;  /* 与脚本 ACTIONS_HEIGHT 一致 */
  position: sticky;
  bottom: 0;
  background: inherit;
  z-index: 1;
}
.dark .editor-actions { border-top-color: #444; }

.action-buttons { display: flex; gap: 8px; }
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
.action-btn:hover { background-color: #e0e0e0; }
.dark .action-btn { color: #aaa; }
.dark .action-btn:hover { background-color: #555; }

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
.submit-btn:hover { background-color: #000; }
.submit-btn:disabled {
  background-color: #a5a5a5;
  cursor: not-allowed;
  opacity: 0.7;
}
.dark .submit-btn { background-color: #f0f0f0; color: #1a1a1a; }
.dark .submit-btn:hover { background-color: #fff; }
.dark .submit-btn:disabled { background-color: #4b5563; color: #999; }
</style>
