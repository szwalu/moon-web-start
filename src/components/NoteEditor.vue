<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Focus from '@tiptap/extension-focus'
import { useSettingStore } from '@/stores/setting'

const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as () => any | null, default: null },
  isLoading: { type: Boolean, default: false },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
  allTags: { type: Array as () => string[], default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave', 'close'])
const { t } = useI18n()
const settingsStore = useSettingStore()

// UI refs
const showTagDropdown = ref(false)
const tagDropdownContainerRef = ref<HTMLDivElement | null>(null)
const editorFooterRef = ref<HTMLElement | null>(null)
const editorScrollContainerRef = ref<HTMLElement | null>(null)
const editorToolbarRef = ref<HTMLElement | null>(null)

// 底部偏移 (键盘高度)
const footerBottomOffset = ref(0)
// 实际 footer 高度（mounted 时会取）
const baseFooterHeight = ref(70)
// toolbar 高度
const toolbarHeight = ref(0)
// 动态计算编辑区最大高度（像素）
const maxEditorHeight = ref<number | null>(null)

const scrollContainerPaddingBottom = computed(() => {
  return footerBottomOffset.value + baseFooterHeight.value
})

const editor = useEditor({
  content: props.modelValue,
  extensions: [
    StarterKit,
    Placeholder.configure({
      placeholder: t('notes.content_placeholder'),
    }),
    CharacterCount.configure({
      limit: props.maxNoteLength,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Focus.configure({ className: 'has-focus' }),
  ],
  onUpdate: ({ editor: currentEditor }) => {
    emit('update:modelValue', currentEditor.getHTML())
    emit('triggerAutoSave')
    nextTick(() => ensureCaretVisible())
  },
  onFocus() {
    handleViewportResize()
    nextTick(() => ensureCaretVisible())
  },
  editorProps: {
    attributes: {
      class: 'prose dark:prose-invert prose-sm sm:prose-base focus:outline-none',
    },
  },
})

function handleViewportResize() {
  if (!window.visualViewport) {
    footerBottomOffset.value = 0
    return
  }
  const keyboardHeight = Math.max(0, window.innerHeight - window.visualViewport.height)
  footerBottomOffset.value = keyboardHeight
  updateSizes()
}

// 根据 toolbar/footer/viewport 动态计算编辑区最大高度
function updateSizes() {
  if (editorFooterRef.value)
    baseFooterHeight.value = editorFooterRef.value.offsetHeight || baseFooterHeight.value
  if (editorToolbarRef.value)
    toolbarHeight.value = editorToolbarRef.value.offsetHeight || toolbarHeight.value

  const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight
  const buffer = 20
  const candidate = Math.max(120, viewportHeight - toolbarHeight.value - baseFooterHeight.value - buffer)
  maxEditorHeight.value = candidate
}

// 确保光标/选区在编辑容器可视区内（上方留 12px 缓冲）
function ensureCaretVisible() {
  if (!editor.value || !editorScrollContainerRef.value)
    return
  try {
    const sel = editor.value.state.selection
    const pos = Math.max(0, sel.from)
    const coords = (editor.value.view as any).coordsAtPos(pos)
    if (!coords)
      throw new Error('no coords')

    const containerRect = editorScrollContainerRef.value.getBoundingClientRect()
    const padding = 12
    const containerBottomLimit = containerRect.bottom - baseFooterHeight.value - 4

    if (coords.bottom > containerBottomLimit - padding) {
      const delta = coords.bottom - (containerBottomLimit - padding)
      editorScrollContainerRef.value.scrollTop += Math.ceil(delta)
    }
    else if (coords.top < containerRect.top + padding) {
      const delta = (containerRect.top + padding) - coords.top
      editorScrollContainerRef.value.scrollTop -= Math.ceil(delta)
    }
  }
  catch (err) {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (!rect)
        return
      const containerRect = editorScrollContainerRef.value.getBoundingClientRect()
      const padding = 12
      const containerBottomLimit = containerRect.bottom - baseFooterHeight.value - 4

      if (rect.bottom > containerBottomLimit - padding)
        editorScrollContainerRef.value.scrollTop += Math.ceil(rect.bottom - (containerBottomLimit - padding))
      else if (rect.top < containerRect.top + padding)
        editorScrollContainerRef.value.scrollTop -= Math.ceil((containerRect.top + padding) - rect.top)
    }
  }
}

const charCount = computed(() => editor.value?.storage.characterCount.characters() ?? 0)
const editorFontSizeClass = computed(() => `font-size-${settingsStore.noteFontSize}`)

watch(() => props.modelValue, (value) => {
  if (editor.value && editor.value.getHTML() !== value)
    editor.value.commands.setContent(value, false)
})

watch(() => props.editingNote, (newNote, oldNote) => {
  if (newNote?.id !== oldNote?.id)
    editor.value?.commands.focus('end')
})

async function fetchWeather() {
  const now = new Date()
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  return Promise.resolve(`Fullerton/${time} 26°C Clear ☀️`)
}

function insertTag(tag: string) {
  editor.value?.chain().focus().insertContent(`${tag} `).run()
  showTagDropdown.value = false
}

function closeDropdownOnClickOutside(event: MouseEvent) {
  if (tagDropdownContainerRef.value && !tagDropdownContainerRef.value.contains(event.target as Node))
    showTagDropdown.value = false
}

watch(showTagDropdown, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      document.addEventListener('click', closeDropdownOnClickOutside)
    })
  }
  else {
    document.removeEventListener('click', closeDropdownOnClickOutside)
  }
})

let editorDomListenersAdded = false
function addEditorDomListeners() {
  nextTick(() => {
    const dom = editor.value?.view?.dom as HTMLElement | undefined
    if (!dom || editorDomListenersAdded)
      return
    dom.addEventListener('keyup', ensureCaretVisible)
    dom.addEventListener('input', ensureCaretVisible)
    dom.addEventListener('click', ensureCaretVisible)
    dom.addEventListener('touchend', () => setTimeout(ensureCaretVisible, 60))
    editorDomListenersAdded = true
  })
}

function removeEditorDomListeners() {
  const dom = editor.value?.view?.dom as HTMLElement | undefined
  if (!dom || !editorDomListenersAdded)
    return
  dom.removeEventListener('keyup', ensureCaretVisible)
  dom.removeEventListener('input', ensureCaretVisible)
  dom.removeEventListener('click', ensureCaretVisible)
  editorDomListenersAdded = false
}

onMounted(async () => {
  if (editorFooterRef.value)
    baseFooterHeight.value = editorFooterRef.value.offsetHeight || baseFooterHeight.value
  if (editorToolbarRef.value)
    toolbarHeight.value = editorToolbarRef.value.offsetHeight || toolbarHeight.value

  updateSizes()

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      handleViewportResize()
      updateSizes()
      nextTick(() => ensureCaretVisible())
    })
  }
  else {
    window.addEventListener('resize', () => {
      handleViewportResize()
      updateSizes()
      nextTick(() => ensureCaretVisible())
    })
  }

  addEditorDomListeners()

  if (!props.editingNote && !props.modelValue) {
    const weatherString = await fetchWeather()
    if (weatherString && editor.value) {
      const initialContent = `<p>${weatherString}</p><p></p>`
      editor.value.commands.setContent(initialContent)
      editor.value.commands.focus('end')
      emit('update:modelValue', initialContent)
      nextTick(() => ensureCaretVisible())
    }
  }
  else {
    editor.value?.commands.focus('end')
    nextTick(() => ensureCaretVisible())
  }
})

onBeforeUnmount(() => {
  if (window.visualViewport)
    window.visualViewport.removeEventListener('resize', handleViewportResize)
  else
    window.removeEventListener('resize', handleViewportResize)

  removeEditorDomListeners()
  editor.value?.destroy()
  document.removeEventListener('click', closeDropdownOnClickOutside)
})

function handleSubmit() {
  emit('submit')
}

function handleClose() {
  emit('close')
}
</script>

<template>
  <div class="editor-wrapper">
    <form class="editor-form" @submit.prevent="handleSubmit">
      <!-- toolbar: 增加 ref 用于计算 toolbarHeight -->
      <div v-if="editor" ref="editorToolbarRef" class="editor-toolbar">
        <div ref="tagDropdownContainerRef" class="tag-dropdown-container">
          <button type="button" :title="t('notes.insert_tag')" @click="showTagDropdown = !showTagDropdown">
            <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M5.5 7A1.5 1.5 0 1 0 4 5.5A1.5 1.5 0 0 0 5.5 7m15.41 9.41l-9.05-9.05a1 1 0 0 0-.7-.29H4a2 2 0 0 0-2 2v7.16a1 1 0 0 0 .29.7l9.05 9.05a1 1 0 0 0 1.41 0l7.16-7.16a1 1 0 0 0 0-1.41" /></svg>
          </button>
          <div v-if="showTagDropdown" class="tag-dropdown-menu">
            <div v-if="!allTags || allTags.length === 0" class="dropdown-item-disabled">
              {{ t('notes.no_tags_found') }}
            </div>
            <div v-for="tag in allTags" :key="tag" class="dropdown-item" @click="insertTag(tag)">
              {{ tag }}
            </div>
          </div>
        </div>

        <button type="button" :title="t('notes.task_list')" :class="{ 'is-active': editor.isActive('taskList') }" @click="editor.chain().focus().toggleTaskList().run()">
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 12l2 2l4-4m-5 8h-2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5m-8 6h5m-5 2h5" /></svg>
        </button>

        <div class="divider" />
        <button type="button" :class="{ 'is-active': editor.isActive('bold') }" @click="editor.chain().focus().toggleBold().run()">B</button>
        <button type="button" :class="{ 'is-active': editor.isActive('italic') }" @click="editor.chain().focus().toggleItalic().run()">I</button>
        <button type="button" :class="{ 'is-active': editor.isActive('strike') }" @click="editor.chain().focus().toggleStrike().run()">S</button>
        <button type="button" :class="{ 'is-active': editor.isActive('heading', { level: 2 }) }" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()">H2</button>
        <button type="button" :class="{ 'is-active': editor.isActive('bulletList') }" @click="editor.chain().focus().toggleBulletList().run()">●</button>
        <button type="button" :class="{ 'is-active': editor.isActive('orderedList') }" @click="editor.chain().focus().toggleOrderedList().run()">1.</button>
      </div>

      <!-- 编辑容器：加 ref、动态 maxHeight、以及 paddingBottom -->
      <div
        ref="editorScrollContainerRef"
        class="editor-scroll-container"
        :class="[editorFontSizeClass]"
        :style="{
          paddingBottom: `${scrollContainerPaddingBottom}px`,
          maxHeight: maxEditorHeight ? `${maxEditorHeight}px` : '',
        }"
      >
        <EditorContent :editor="editor" />
      </div>
    </form>

    <!-- footer 使用 transform 上移 -->
    <div
      ref="editorFooterRef"
      class="editor-footer"
      :style="{ transform: `translateY(-${footerBottomOffset}px)` }"
    >
      <div class="status-bar">
        <span class="char-counter">
          {{ t('notes.char_count') }}: {{ charCount }}/{{ maxNoteLength }}
        </span>
        <span v-if="lastSavedTime" class="char-counter">
          💾 {{ t('notes.auto_saved_at') }}: {{ lastSavedTime }}
        </span>
      </div>
      <div class="action-bar">
        <button type="button" class="form-button form-button-cancel" @click="handleClose">
          取消
        </button>
        <button type="button" class="form-button" :disabled="isLoading || charCount === 0" @click="handleSubmit">
          💾 {{ isLoading ? $t('notes.saving') : editingNote ? $t('notes.update_note') : $t('notes.save_note') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style>
/* 编辑区不再强制填满：使用 max-height + 内部滚动 */
.editor-scroll-container {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid #ccc;
  border-top: none;
  border-radius: 0 0 6px 6px;
  transition: padding-bottom 0.2s ease-out;
  min-height: 120px; /* 最小高度 */
}

/* 编辑器内容区域让高度由内容决定，避免一开始撑满 */
.editor-scroll-container .ProseMirror {
  padding: 0.5rem;
  min-height: 120px;
  outline: none;
}

/* toolbar / tag dropdown / divider / buttons */
.editor-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background-color: #f8f8f8;
}
.editor-toolbar .divider {
  width: 1px;
  height: 16px;
  background-color: #ccc;
  margin: 0 4px;
}
.dark .editor-toolbar .divider {
  background-color: #48484a;
}
.editor-toolbar button svg {
  width: 1.25em;
  height: 1.25em;
}
.tag-dropdown-container {
  position: relative;
}
.tag-dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  background-color: #fff;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  border: 1px solid #eee;
  z-index: 110;
  width: 150px;
  max-height: 200px;
  overflow-y: auto;
  margin-top: 8px;
}
.dark .tag-dropdown-menu {
  background-color: #2c2c2e;
  border-color: #444;
}
.tag-dropdown-menu .dropdown-item {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s ease;
}
.tag-dropdown-menu .dropdown-item:hover {
  background-color: #f0f0f0;
}
.dark .tag-dropdown-menu .dropdown-item:hover {
  background-color: #3a3a3c;
}
.tag-dropdown-menu .dropdown-item-disabled {
  padding: 8px 12px;
  font-size: 14px;
  color: #999;
}
.dark .tag-dropdown-menu .dropdown-item-disabled {
  color: #aaa;
}

/* wrapper */
.editor-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  height: -webkit-fill-available;
  z-index: 1000;
  background-color: #fff;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
.dark .editor-wrapper { background-color: #1c1c1e; }

/* footer 使用 absolute + transform 上移 */
.editor-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background-color: #f8f8f8;
  padding: 8px 12px;
  border-top: 1px solid #ccc;
  transition: transform 0.25s ease-out;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: nowrap;
}

.status-bar {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  flex-grow: 1;
  flex-shrink: 1;
  min-width: 0;
}
.status-bar .char-counter {
  line-height: 1.3;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.action-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.dark .editor-footer {
  background-color: #2c2c2e;
  border-top-color: #48484a;
}
.action-bar .form-button {
  padding: .5rem 1rem;
}
.form-button-cancel {
  background-color: #e9e9eb;
  border-color: #dcdfe6;
  color: #606266;
}
.dark .form-button-cancel {
  background-color: #48484a;
  border-color: #58585a;
  color: #fff;
}
.dark .editor-toolbar { background-color: #2c2c2e; border-color: #48484a; }
.editor-toolbar button { font-weight: bold; padding: 4px 8px; border: 1px solid transparent; border-radius: 4px; cursor: pointer; background: none; display:flex; align-items:center; justify-content:center; }
.dark .editor-toolbar button { color: #e0e0e0; }
.editor-toolbar button:hover { background-color: #e0e0e0; }
.dark .editor-toolbar button:hover { background-color: #404040; }
.editor-toolbar button.is-active { background-color: #d0d0d0; color: #000; }
.dark .editor-toolbar button.is-active { background-color: #555; color: #fff; }
.char-counter{font-size:12px;color:#999}.dark .char-counter{color:#aaa}
.form-button{font-size:14px;border-radius:6px;border:1px solid #ccc;cursor:pointer;background:#d3d3d3;color:#111}.dark .form-button{background-color:#404040;color:#fff;border-color:#555}.form-button:disabled{opacity:.6;cursor:not-allowed}
.font-size-small .ProseMirror { font-size: 14px; }
.font-size-medium .ProseMirror { font-size: 16px; }
.font-size-large .ProseMirror { font-size: 20px; }
.dark .editor-scroll-container { border-color: #48484a; }
</style>
