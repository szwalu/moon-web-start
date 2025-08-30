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

const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave'])
const { t } = useI18n()
const settingsStore = useSettingStore()

const showTagDropdown = ref(false)
const tagDropdownContainerRef = ref<HTMLDivElement | null>(null)

const editor = useEditor({
  content: props.modelValue,
  extensions: [
    StarterKit,
    Placeholder.configure({
      placeholder: t('现在的想法是...'),
    }),
    CharacterCount.configure({
      limit: props.maxNoteLength,
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    Focus.configure({
      className: 'has-focus',
    }),
  ],
  onUpdate: ({ editor: currentEditor }) => {
    emit('update:modelValue', currentEditor.getHTML())
    emit('triggerAutoSave')
  },
  editorProps: {
    attributes: {
      class: 'prose dark:prose-invert prose-sm sm:prose-base focus:outline-none',
    },
  },
})

const charCount = computed(() => {
  return editor.value?.storage.characterCount.characters() ?? 0
})

const editorFontSizeClass = computed(() => `font-size-${settingsStore.noteFontSize}`)

watch(() => props.modelValue, (value) => {
  if (editor.value && editor.value.getHTML() !== value)
    editor.value.commands.setContent(value, false)
})

watch(() => props.editingNote, (newNote, oldNote) => {
  if (newNote?.id !== oldNote?.id)
    editor.value?.commands.focus('end')
})

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

onMounted(() => {
  editor.value?.commands.focus('end')
})

onBeforeUnmount(() => {
  editor.value?.destroy()
  document.removeEventListener('click', closeDropdownOnClickOutside)
})

function handleSubmit() {
  emit('submit')
}
</script>

<template>
  <div class="editor-wrapper-flomo">
    <div class="editor-scroll-container" :class="[editorFontSizeClass]">
      <EditorContent :editor="editor" />
    </div>

    <div v-if="editor" class="editor-toolbar-flomo">
      <div class="toolbar-left">
        <div ref="tagDropdownContainerRef" class="tag-dropdown-container">
          <button type="button" :title="t('notes.insert_tag')" @click="showTagDropdown = !showTagDropdown">
            #
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
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M1.5 2.25a.75.75 0 0 0 0 1.5h13a.75.75 0 0 0 0-1.5zM1.5 7.5a.75.75 0 0 0 0 1.5h13a.75.75 0 0 0 0-1.5zM1.5 12a.75.75 0 0 0 0 1.5h13a.75.75 0 0 0 0-1.5z" clip-rule="evenodd" /></svg>
        </button>
        <button type="button" :class="{ 'is-active': editor.isActive('bold') }" @click="editor.chain().focus().toggleBold().run()">
          <b>B</b>
        </button>
      </div>
      <div class="toolbar-right">
        <button type="button" class="submit-button" :disabled="isLoading || charCount === 0" @click="handleSubmit">
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M3 20v-6l8-2l-8-2V4l19 8z" /></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style>
/* 新的 Flomo 风格样式 */
.editor-wrapper-flomo {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.editor-scroll-container {
  overflow-y: auto;
  min-height: 100px;
  max-height: 55vh;
  padding: 1rem;
  padding-bottom: 2rem;
}

.editor-scroll-container .ProseMirror {
  line-height: 1.6 !important;
  outline: none;
}
.editor-scroll-container .ProseMirror p {
  margin-top: 0.5em !important;
  margin-bottom: 0.5em !important;
}

.editor-toolbar-flomo {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-top: 1px solid #f0f0f0;
}
.dark .editor-toolbar-flomo {
  border-top-color: #333;
}

.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.editor-toolbar-flomo button {
  background: none;
  border: none;
  cursor: pointer;
  color: #888;
  font-size: 18px;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dark .editor-toolbar-flomo button {
  color: #aaa;
}
.editor-toolbar-flomo button.is-active {
  color: #18a058;
}
.dark .editor-toolbar-flomo button.is-active {
  color: #63e2b7;
}

/* 调整保存按钮的样式，使其更醒目 */
.editor-toolbar-flomo .submit-button {
  font-size: 22px;
  color: #18a058; /* 给予主题色 */
}
.dark .editor-toolbar-flomo .submit-button {
  color: #63e2b7;
}

.editor-toolbar-flomo button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 标签下拉菜单样式 */
.tag-dropdown-container {
  position: relative;
}
.tag-dropdown-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  background-color: #fff;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  border: 1px solid #eee;
  z-index: 110;
  width: 150px;
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 8px;
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

/* 之前 Tiptap task list 等全局样式可以保留 */
ul[data-type="taskList"] {
  list-style: none;
  padding: 0;
}
ul[data-type="taskList"] li {
  display: flex;
  align-items: center;
}
ul[data-type="taskList"] li > label {
  flex: 0 0 auto;
  margin-right: 0.5rem;
}
ul[data-type="taskList"] li > div {
  flex: 1 1 auto;
}
</style>
