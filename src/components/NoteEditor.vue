<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EasyMDE from 'easymde'
import { useSettingStore } from '@/stores/setting'
import 'easymde/dist/easymde.min.css'

// ============= Props & Emits（与父组件保持一致） =============
const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as () => any | null, default: null },
  isLoading: { type: Boolean, default: false },
  allTags: { type: Array as () => string[], default: () => [] },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave', 'close'])

// ============= 状态 =============
const { t } = useI18n()
const settingsStore = useSettingStore()

const rootRef = ref<HTMLDivElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const easymde = ref<EasyMDE | null>(null)
const isReadyForAutoSave = ref(false)
// 新增：底部状态区引用，用于测量高度
const footerEl = ref<HTMLElement | null>(null)

// 标签联想 / 面板
const showTagSuggestions = ref(false)
const tagSuggestions = ref<string[]>([])
const suggestionsStyle = ref<{ top: string; left: string }>({ top: '0px', left: '0px' })
const highlightedSuggestionIndex = ref(-1)
const showAllTagsPanel = ref(false)

// 双向内容
const contentModel = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
})
const charCount = computed(() => contentModel.value.length)

// ============= 软键盘/状态栏适配：计算底部占用并写入 CSS 变量 =============
function updateViewportInsets() {
  const vv = window.visualViewport
  const host = rootRef.value
  if (!vv || !host)
    return

  // 键盘高度（包含 viewport 缩小和顶部偏移带来的可视高度损失）
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  host.style.setProperty('--kb', `${kb}px`)

  // 底部状态条/保存区高度
  const footerH = (footerEl.value?.offsetHeight ?? 0)
  host.style.setProperty('--footer', `${footerH}px`)

  // 方向变化或键盘高度变化后，下一帧校正光标
  if (easymde.value) {
    const cm = easymde.value.codemirror
    requestAnimationFrame(() => ensureCaretVisible(cm))
  }
}

// ============= 核心：保证光标永远可见（考虑键盘与底栏占用） =============
function ensureCaretVisible(cm: any) {
  if (!cm)
    return
  const scroller: HTMLElement = cm.getScrollerElement()
  const coords = cm.cursorCoords(null, 'local') // 相对滚动容器的坐标

  // 读取根元素上的 CSS 变量
  const host = rootRef.value
  let kb = 0
  let footer = 0
  if (host) {
    const cs = getComputedStyle(host)
    kb = Number.parseInt(cs.getPropertyValue('--kb')) || 0
    footer = Number.parseInt(cs.getPropertyValue('--footer')) || 0
  }
  const bottomInset = kb + footer + 8 // 额外留 8px 缓冲
  const margin = 10

  const viewTop = scroller.scrollTop
  const viewBottomAdj = viewTop + scroller.clientHeight - bottomInset
  const caretTop = coords.top
  const caretBottom = coords.bottom

  if (caretBottom + margin > viewBottomAdj)
    scroller.scrollTop = (caretBottom + margin) - (scroller.clientHeight - bottomInset)

  else if (caretTop - margin < viewTop)
    scroller.scrollTop = Math.max(0, caretTop - margin)
}

// ============= 初始化 EasyMDE（非固定布局，内滚动封顶） =============
function initializeEasyMDE(initialValue = '') {
  if (!textareaRef.value || easymde.value)
    return
  isReadyForAutoSave.value = false

  const toolbar: (EasyMDE.ToolbarIcon | string)[] = [
    {
      name: 'tags',
      action: () => (showAllTagsPanel.value = !showAllTagsPanel.value),
      className: 'fa fa-tags',
      title: 'Tags',
    },
    'bold',
    'italic',
    'unordered-list',
    'ordered-list',
    {
      name: 'taskList',
      action: (editor: EasyMDE) => {
        const cm = editor.codemirror
        cm.getDoc().replaceSelection('- [ ] ', cm.getDoc().getCursor())
        cm.focus()
      },
      className: 'fa fa-check-square-o',
      title: 'Task List',
    },
    'link',
    'image',
    'quote',
    '|',
    {
      name: 'close',
      action: handleClose,
      className: 'fa fa-times custom-close-button',
      title: 'Close',
    },
  ]

  easymde.value = new EasyMDE({
    element: textareaRef.value,
    initialValue,
    spellChecker: false,
    placeholder: t('notes.content_placeholder'),
    toolbar,
    status: false,
    lineWrapping: true,
    // 显式禁用 EasyMDE 内置 autosave，使用我们自己的
    autosave: undefined as any,
  })

  applyEditorFontSize()

  const cm = easymde.value.codemirror

  // 每次编辑都确保光标可见
  cm.on('change', (instance: any) => {
    const editorContent = easymde.value?.value() ?? ''
    if (contentModel.value !== editorContent)
      contentModel.value = editorContent

    if (!isReadyForAutoSave.value)
      isReadyForAutoSave.value = true
    else emit('triggerAutoSave')

    handleTagSuggestions(instance)
    nextTick(() => ensureCaretVisible(instance))
  })

  cm.on('cursorActivity', (instance: any) => {
    nextTick(() => ensureCaretVisible(instance))
  })

  // 中文/日文等输入法合成结束后再校正一次
  cm.getInputField().addEventListener('compositionend', () => {
    requestAnimationFrame(() => ensureCaretVisible(cm))
  })

  cm.on('keydown', (instance: any, event: KeyboardEvent) => {
    if (showTagSuggestions.value && tagSuggestions.value.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveSuggestionSelection(1)
      }
      else if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveSuggestionSelection(-1)
      }
      else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        selectTag(tagSuggestions.value[highlightedSuggestionIndex.value])
      }
      else if (event.key === 'Escape') {
        event.preventDefault()
        showTagSuggestions.value = false
      }
    }
  })

  // 初始聚焦到末尾
  focusEditor()
}

function destroyEasyMDE() {
  if (easymde.value) {
    easymde.value.toTextArea()
    easymde.value = null
  }
}

function applyEditorFontSize() {
  if (!easymde.value)
    return
  const cmWrapper = easymde.value.codemirror.getWrapperElement()
  cmWrapper.classList.remove('font-size-small', 'font-size-medium', 'font-size-large', 'font-size-extra-large')
  cmWrapper.classList.add(`font-size-${settingsStore.noteFontSize}`)
}

function focusEditor() {
  if (!easymde.value)
    return
  nextTick(() => {
    const cm = easymde.value!.codemirror
    cm.focus()
    const doc = cm.getDoc()
    doc.setCursor(doc.lastLine(), doc.getLine(doc.lastLine()).length)
  })
}

// ============= 标签联想 =============
function handleTagSuggestions(cm: any) {
  const cursor = cm.getDoc().getCursor()
  const line = cm.getDoc().getLine(cursor.line)
  const before = line.substring(0, cursor.ch)
  const lastHash = before.lastIndexOf('#')
  if (lastHash === -1 || /\s/.test(before.substring(lastHash + 1))) {
    showTagSuggestions.value = false
    return
  }
  const term = before.substring(lastHash + 1)
  tagSuggestions.value = props.allTags.filter(tag => tag.toLowerCase().startsWith(`#${term.toLowerCase()}`))
  if (tagSuggestions.value.length > 0) {
    const coords = cm.cursorCoords()
    suggestionsStyle.value = { top: `${coords.bottom + 5}px`, left: `${coords.left}px` }
    showTagSuggestions.value = true
    highlightedSuggestionIndex.value = 0
  }
  else {
    showTagSuggestions.value = false
  }
}

function selectTag(tag: string) {
  if (!easymde.value)
    return
  const cm = easymde.value.codemirror
  const doc = cm.getDoc()
  const cursor = doc.getCursor()
  const line = doc.getLine(cursor.line)
  const before = line.substring(0, cursor.ch)
  const lastHash = before.lastIndexOf('#')
  if (lastHash !== -1) {
    const start = { line: cursor.line, ch: lastHash }
    doc.replaceRange(`${tag} `, start, cursor)
  }
  showTagSuggestions.value = false
  cm.focus()
}

function insertTag(tag: string) {
  if (!easymde.value)
    return
  const cm = easymde.value.codemirror
  cm.getDoc().replaceSelection(`${tag} `)
  showAllTagsPanel.value = false
  cm.focus()
}

function moveSuggestionSelection(offset: number) {
  const count = tagSuggestions.value.length
  highlightedSuggestionIndex.value = (highlightedSuggestionIndex.value + offset + count) % count
}

// ============= 其他事件 =============
function handleSubmit() {
  emit('submit')
}

function handleClose() {
  emit('close')
}

// ============= 生命周期 =============
onMounted(async () => {
  const initialContent = props.modelValue
  initializeEasyMDE(initialContent)

  // 绑定 viewport 监听，适配软键盘
  updateViewportInsets()
  window.visualViewport?.addEventListener('resize', updateViewportInsets)
  window.visualViewport?.addEventListener('scroll', updateViewportInsets)
  window.addEventListener('orientationchange', updateViewportInsets)
})

onUnmounted(() => {
  destroyEasyMDE()
  window.visualViewport?.removeEventListener('resize', updateViewportInsets)
  window.visualViewport?.removeEventListener('scroll', updateViewportInsets)
  window.removeEventListener('orientationchange', updateViewportInsets)
})

// 父级变更内容 → 同步到编辑器
watch(() => props.modelValue, (v) => {
  if (easymde.value && v !== easymde.value.value())
    easymde.value.value(v)
})

// 字号跟随
watch(() => settingsStore.noteFontSize, applyEditorFontSize)

// 切换编辑对象时，销毁重建，保证焦点与光标正确
watch(() => props.editingNote?.id, () => {
  destroyEasyMDE()
  nextTick(() => initializeEasyMDE(props.modelValue))
})
</script>

<template>
  <!-- 顶部内嵌卡片，非 fixed。用于“新建”或“就地编辑”皆可复用 -->
  <div ref="rootRef" class="composer-card" :class="{ 'is-inline': !!editingNote }">
    <div class="composer-header">
      <div class="left">
        <span class="dot" />
        <span class="hint">{{ editingNote ? t('notes.editing') : t('notes.new_note') }}</span>
      </div>
      <div class="right">
        <span v-if="lastSavedTime" class="save-status">💾 {{ lastSavedTime }}</span>
        <button type="button" class="save-btn" :disabled="isLoading || !contentModel" @click="handleSubmit">
          {{ isLoading ? $t('notes.saving') : $t('notes.save_note') }}
        </button>
      </div>
    </div>

    <!-- 真正的编辑区（EasyMDE 会接管这个 textarea） -->
    <form class="editor-form" autocomplete="off" @submit.prevent="handleSubmit">
      <textarea ref="textareaRef" style="display:none" />
      <!-- 所有标签弹层 -->
      <div v-if="showAllTagsPanel" class="all-tags-panel">
        <ul>
          <li v-for="tag in allTags" :key="tag" @mousedown.prevent="insertTag(tag)">{{ tag }}</li>
        </ul>
      </div>
      <!-- 联想弹层 -->
      <div v-if="showTagSuggestions && tagSuggestions.length" class="tag-suggestions" :style="suggestionsStyle">
        <ul>
          <li
            v-for="(tag, i) in tagSuggestions"
            :key="tag"
            :class="{ highlighted: i === highlightedSuggestionIndex }"
            @mousedown.prevent="selectTag(tag)"
          >
            {{ tag }}
          </li>
        </ul>
      </div>
    </form>

    <div ref="footerEl" class="composer-footer">
      <span class="counter">{{ charCount }}/{{ maxNoteLength }}</span>
    </div>
  </div>
</template>

<style scoped>
/* ====== 外层卡片（仿 Memos 顶部样式） ====== */
.composer-card {
  --editor-max-width: 680px;
  --editor-max-height: clamp(180px, 45vh, 420px); /* 达到上限后内部滚动，确保光标露出 */
  --radius: 12px;

  /* 动态占位：软键盘 + 底栏（供内部 CSS 变量读取） */
  --kb: 0px;
  --footer: 0px;

  width: 100%;
  max-width: var(--editor-max-width);
  margin: 0 auto 16px;
  background: var(--bg, #fff);
  border: 1px solid #e5e7eb;
  border-radius: var(--radius);
  box-shadow: 0 4px 20px rgba(0,0,0,.05);
  overflow: hidden;
  padding-bottom: env(safe-area-inset-bottom);
}
.dark .composer-card {
  --bg: #1e1e1e;
  border-color: #333;
}

.composer-card.is-inline {
  /* 当在列表中“就地编辑”时，去掉外部阴影以更贴合列表卡片 */
  box-shadow: none;
  margin-bottom: 12px;
}

/* 顶部栏 */
.composer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #e5e7eb;
}
.dark .composer-header { border-bottom-color: #333; }

.composer-header .left { display: flex; align-items: center; gap: 8px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #00b386; }
.hint { font-size: 12px; color: #6b7280; }
.dark .hint { color: #9ca3af; }

.right { display: flex; align-items: center; gap: 10px; }
.save-status { font-size: 12px; color: #6b7280; }
.dark .save-status { color: #9ca3af; }

.save-btn {
  background: #00b386; color: #fff; border: 0;
  padding: 6px 12px; border-radius: 8px; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: filter .15s ease;
}
.save-btn:disabled { opacity: .6; cursor: not-allowed; }
.save-btn:not(:disabled):hover { filter: brightness(.95); }

/* 编辑区容器（交给 EasyMDE 接管） */
.editor-form {
  position: relative;
  display: flex;
  flex-direction: column;
}

/* 底部计数栏 */
.composer-footer {
  display: flex; justify-content: flex-end; align-items: center;
  padding: 8px 12px; border-top: 1px solid #e5e7eb;
}
.dark .composer-footer { border-top-color: #333; }
.counter { font-size: 12px; color: #6b7280; }
.dark .counter { color: #9ca3af; }

/* 标签弹层 */
.tag-suggestions,
.all-tags-panel {
  position: absolute;
  z-index: 20;
  background: var(--bg, #fff);
  border: 1px solid #ccc;
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0,0,0,.12);
  max-height: 160px; overflow: auto; min-width: 140px;
}
.dark .tag-suggestions, .dark .all-tags-panel { border-color: #48484a; }

.tag-suggestions ul, .all-tags-panel ul { margin: 0; padding: 4px 0; list-style: none; }
.tag-suggestions li, .all-tags-panel li { padding: 6px 12px; font-size: 14px; cursor: pointer; }
.tag-suggestions li:hover, .tag-suggestions li.highlighted,
.all-tags-panel li:hover { background: rgba(0,0,0,.06); }
.dark .tag-suggestions li:hover, .dark .tag-suggestions li.highlighted,
.dark .all-tags-panel li:hover { background: rgba(255,255,255,.08); }
</style>

<!-- ====== 覆盖 EasyMDE / CodeMirror（非 scoped，影响内部结构） ====== -->
<style>
/* 让编辑器像文本域一样“长高”，触顶后内部滚动 */
.composer-card .EasyMDEContainer { border: none !important; }
.composer-card .editor-toolbar {
  border: none !important;
  border-bottom: 1px solid #e5e7eb !important;
  background: transparent;
  padding: 4px 8px !important;
  display: flex !important; align-items: center; gap: 2px;
  min-height: auto !important; overflow-x: auto;
}
.dark .composer-card .editor-toolbar { border-bottom-color: #333 !important; }
.composer-card .editor-toolbar a i,
.composer-card .editor-toolbar button i { font-size: 15px !important; }
.composer-card .editor-toolbar a.custom-close-button { font-size: 1.1em; }

.composer-card .CodeMirror {
  height: auto !important;            /* 关键1：随内容增高 */
  border: none !important;
  border-radius: 0 !important;
  padding: 12px !important;
  font-size: 16px !important;
  line-height: 1.6 !important;
  white-space: pre-wrap !important;
  word-break: break-word !important;
  overflow: hidden !important;        /* 由内部滚动承担滚动条 */
}
.dark .composer-card .CodeMirror { background: transparent !important; color: #f3f4f6 !important; }
.dark .composer-card .CodeMirror-cursor { border-left-color: #f3f4f6 !important; }

/* 关键2：滚动容器限制最大高度，超出时内部滚动 */
.composer-card .CodeMirror-scroll {
  max-height: var(--editor-max-height) !important;
  min-height: 120px !important;
  overflow-y: auto !important;
  /* 关键3：为键盘与底部栏留出可滚动空间，避免光标被遮挡 */
  padding-bottom: calc(var(--kb, 0px) + var(--footer, 0px) + 16px) !important;
}

/* 字号映射（跟随 settingsStore.noteFontSize） */
.CodeMirror.font-size-small { font-size: 14px !important; }
.CodeMirror.font-size-medium { font-size: 16px !important; }
.CodeMirror.font-size-large { font-size: 20px !important; }
.CodeMirror.font-size-extra-large { font-size: 22px !important; }
</style>
