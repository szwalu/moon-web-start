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
const cardRef = ref<HTMLDivElement | null>(null)
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

/** 用“镜像 div”获取 textarea 光标在页面上的 Y 坐标（像素） */
function getCaretPageY(ta: HTMLTextAreaElement): number | null {
  const cs = getComputedStyle(ta)
  const mirror = document.createElement('div')

  // 尽量还原样式环境
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

  // 放到与 textarea 相同的位置
  const taRect = ta.getBoundingClientRect()
  mirror.style.left = `${window.scrollX + taRect.left}px`
  mirror.style.top = `${window.scrollY + taRect.top}px`

  // 组装到光标处的文本（使用安全转义，避免不可见字符）
  const value = ta.value
  const selEnd = ta.selectionEnd ?? value.length
  const before = value
    .slice(0, selEnd)
    .replace(/\n$/g, '\n ') // 尾部换行占位
    .replace(/ /g, '\u00A0') // 空格 -> 不换行空格
    .replace(/\n/g, '<br/>') // 换行 -> <br/>
  const after = value
    .slice(selEnd)
    .replace(/ /g, '\u00A0')
    .replace(/\n/g, '<br/>')

  // ✅ 这里不再插入零宽空白，避免 no-irregular-whitespace
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

/** 让页面滚动以保证“光标行”可见（考虑保存栏 + IME + 安全区） */
function ensureCaretVisible() {
  const ta = textareaRef.value
  const card = cardRef.value
  if (!ta || !card)
    return

  // 保存栏视觉高度（与样式一致）
  const ACTIONS_HEIGHT = 56

  // 从 visualViewport 推断键盘高度
  const vv = (window as any).visualViewport
  const safeFromVV = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0
  const bottomReserve = Math.max(imeBottomOffset.value, safeFromVV) + ACTIONS_HEIGHT + 16

  const caretPageY = getCaretPageY(ta)
  if (caretPageY == null)
    return

  const viewportTop = window.scrollY
  const viewportBottom = viewportTop + window.innerHeight
  const targetBottom = caretPageY + bottomReserve
  const lineHeight = Number.parseFloat(getComputedStyle(ta).lineHeight || '24')

  if (targetBottom > viewportBottom - 4) {
    const newTop = targetBottom - window.innerHeight
    window.scrollTo({ top: Math.max(newTop, 0), behavior: 'auto' })
  }
  else if (caretPageY - lineHeight < viewportTop + 4) {
    const newTop = caretPageY - lineHeight - 8
    window.scrollTo({ top: Math.max(newTop, 0), behavior: 'auto' })
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
    ensureCaretVisible()
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
    ensureCaretVisible()
  })
}

let resizeObserver: ResizeObserver | null = null

// 计算 IME 高度；onUnmounted 时移除
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
  const el = textareaRef.value
  if (el) {
    autosize(el)

    if (!isEditingInline.value) {
      el.focus()
    }
    else {
      const len = el.value.length
      el.focus()
      el.setSelectionRange(len, len)
    }

    // autosize 导致高度变化时，保持光标可见
    resizeObserver = new ResizeObserver(() => {
      if (document.activeElement === el)
        ensureCaretVisible()
    })
    resizeObserver.observe(el)

    // 初次确保可见
    nextTick(() => ensureCaretVisible())
  }

  updateImeOffsetFn()
  const vv = (window as any).visualViewport
  if (vv) {
    vv.addEventListener('resize', updateImeOffsetFn)
    vv.addEventListener('scroll', updateImeOffsetFn)
  }

  // iOS/Safari 在滚动后再次校正
  window.addEventListener('scroll', onWindowScroll, { passive: true })
})

function onWindowScroll() {
  const el = textareaRef.value
  if (!el || document.activeElement !== el)
    return
  requestAnimationFrame(() => ensureCaretVisible())
}

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
  window.removeEventListener('scroll', onWindowScroll)
})

watch(
  () => props.editingNote?.id,
  (newId, oldId) => {
    if (newId !== oldId && textareaRef.value) {
      nextTick(() => {
        const el = textareaRef.value!
        autosize.update(el)
        el.focus()
        ensureCaretVisible()
      })
    }
  },
)
</script>

<template>
  <div
    ref="cardRef"
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
        @keyup="ensureCaretVisible"
        @click="ensureCaretVisible"
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
  display: block;               /* 允许随内容自然增高 */
  overflow: visible;
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

/* 不做内部滚动，随内容增长；由页面滚动 */
.editor-main {
  padding: 12px 16px 8px;
  overflow: visible;
}

/* 文本域：只自适应高度（autosize），不滚自己，不设 max-height */
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
  overflow: hidden;
  display: block;
  min-height: 3.2em; /* 3行左右起始高度 */
}

.dark .editor-textarea { color: #f0f0f0; }
.editor-textarea::placeholder { color: #999; }
.dark .editor-textarea::placeholder { color: #777; }

.editor-textarea.font-size-small { font-size: 14px; }
.editor-textarea.font-size-medium { font-size: 16px; }
.editor-textarea.font-size-large { font-size: 20px; }
.editor-textarea.font-size-extra-large { font-size: 22px; }

/* 操作区 sticky 到视窗底部（跟随页面滚动），不与键盘打架 */
.editor-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-top: 1px solid #eee;
  min-height: 56px;          /* 与脚本常量保持一致 */
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
