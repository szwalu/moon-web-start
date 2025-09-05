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

// —— 输入法/键盘底部偏移（px）
const imeBottomOffset = ref(0)

// content 双向绑定
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

/** 让页面滚动以保证“光标行”可见（不是滚容器、不滚 textarea） */
function ensureCaretVisible() {
  const ta = textareaRef.value
  const card = cardRef.value
  if (!ta || !card)
    return

  const ACTIONS_HEIGHT = 56 // 与样式里 .editor-actions 的 min-height/padding 综合一致
  const SAFE = (window as any).visualViewport
    ? Math.max(0, window.innerHeight - (window as any).visualViewport.height - (window as any).visualViewport.offsetTop)
    : 0
  // 需要在视窗底部预留的空间：保存栏 + IME + 安全区 + 额外 16px
  const bottomReserve = Math.max(imeBottomOffset.value, SAFE) + ACTIONS_HEIGHT + 16

  // 用行高估算光标相对 textarea 顶部的 Y
  const lineHeight = Number.parseFloat(getComputedStyle(ta).lineHeight || '24')
  const caretPos = ta.selectionEnd || 0
  const textUptoCaret = ta.value.slice(0, caretPos)
  const caretLines = (textUptoCaret.match(/\n/g)?.length ?? 0) + 1
  const caretYInTextarea = (caretLines - 1) * lineHeight + lineHeight

  // 把 caret 转成页面坐标（绝对位置）
  const taRect = ta.getBoundingClientRect()
  const caretPageY = window.scrollY + taRect.top + caretYInTextarea

  const viewportTop = window.scrollY
  const viewportBottom = viewportTop + window.innerHeight
  const targetBottom = caretPageY + bottomReserve

  // 如果光标（含预留）超出视窗底部 → 往下滚
  if (targetBottom > viewportBottom - 4) {
    const newTop = targetBottom - window.innerHeight
    window.scrollTo({ top: Math.max(newTop, 0), behavior: 'smooth' })
  }
  // 如果光标行在视窗上方 → 往上滚
  else if (caretPageY - lineHeight < viewportTop + 4) {
    const newTop = caretPageY - lineHeight - 8
    window.scrollTo({ top: Math.max(newTop, 0), behavior: 'smooth' })
  }
}

function handleSubmit() {
  if (props.isLoading || !contentModel.value.trim())
    return
  emit('submit')
}

function insertTag() {
  if (!textareaRef.value)
    return
  const cursor = textareaRef.value.selectionStart
  const text = contentModel.value
  contentModel.value = `${text.slice(0, cursor)}#${text.slice(cursor)}`
  nextTick(() => {
    const el = textareaRef.value!
    el.selectionStart = el.selectionEnd = cursor + 1
    el.focus()
    ensureCaretVisible()
  })
}

function insertCheckbox() {
  if (!textareaRef.value)
    return
  const cursor = textareaRef.value.selectionStart
  const text = contentModel.value
  const lineStart = text.lastIndexOf('\n', cursor - 1) + 1
  contentModel.value = `${text.slice(0, lineStart)}- [ ] ${text.slice(lineStart)}`
  nextTick(() => {
    const el = textareaRef.value!
    const newCursor = cursor + 6
    el.selectionStart = el.selectionEnd = newCursor
    el.focus()
    ensureCaretVisible()
  })
}

let resizeObserver: ResizeObserver | null = null

// —— 计算 IME 高度；onUnmounted 记得移除
function updateImeOffsetFn() {
  const vv = (window as any).visualViewport
  if (!vv) {
    imeBottomOffset.value = 0
    return
  }
  const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  // 只有明显弹起（>80px）时才认定为键盘高度
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
    // 监听 textarea 高度变化（autosize 导致），以便输入时校正滚动
    resizeObserver = new ResizeObserver(() => {
      if (document.activeElement === el)
        ensureCaretVisible()
    })
    resizeObserver.observe(el)
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
  display: block;               /* 让卡片成为普通块级元素，随内容增高 */
  overflow: visible;            /* 不截断内部溢出 */
  margin-bottom: 1.5rem;

  /* iOS 安全区，避免底部被系统条遮挡 */
  padding-bottom: env(safe-area-inset-bottom);
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

/* 让容器不再内部滚动，随内容自然增高 */
.editor-main {
  padding: 12px 16px 8px;
  overflow: visible;
}

/* 文本域：只自适应高度，不滚动自身，不设置 max-height */
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
  overflow: hidden; /* 不出现内部滚动条 */
  display: block;

  /* 适度最小高度（约 3 行），其余交给 autosize */
  min-height: 3.2em;
}

.dark .editor-textarea { color: #f0f0f0; }
.editor-textarea::placeholder { color: #999; }
.dark .editor-textarea::placeholder { color: #777; }

.editor-textarea.font-size-small { font-size: 14px; }
.editor-textarea.font-size-medium { font-size: 16px; }
.editor-textarea.font-size-large { font-size: 20px; }
.editor-textarea.font-size-extra-large { font-size: 22px; }

/* 操作区 sticky 在页面可视底部（相对文档滚动），避免被键盘遮挡 */
.editor-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-top: 1px solid #eee;
  min-height: 56px;            /* 与脚本中的 ACTIONS_HEIGHT 对齐（略加上 padding） */
  position: sticky;
  bottom: 0;                   /* 贴近视窗底部 */
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
