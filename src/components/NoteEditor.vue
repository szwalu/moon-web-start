<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'

import { useSettingStore } from '@/stores/setting'

const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as () => any | null, default: null },
  isLoading: { type: Boolean, default: false },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave'])
const { t } = useI18n()
const settingsStore = useSettingStore()

// --- Refs for the new layout ---
const editorFooterRef = ref<HTMLDivElement | null>(null)
const footerBottomOffset = ref(0) // Used to lift the footer above the keyboard

// --- New, simpler viewport handler for sticky footer ---
function handleViewportResize() {
  if (!window.visualViewport)
    return
  const keyboardHeight = window.innerHeight - window.visualViewport.height
  footerBottomOffset.value = keyboardHeight
}

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
  ],
  onUpdate: ({ editor }) => {
    emit('update:modelValue', editor.getHTML())
    emit('triggerAutoSave')
  },
  editorProps: {
    attributes: {
      class: 'prose dark:prose-invert prose-sm sm:prose-base focus:outline-none',
    },
  },
})

// --- Computed property for character count ---
const charCount = computed(() => {
  return editor.value?.storage.characterCount.characters() ?? 0
})

// --- Font size reactivity ---
const editorFontSizeClass = computed(() => `font-size-${settingsStore.noteFontSize}`)

// --- Sync parent changes to the editor ---
watch(() => props.modelValue, (value) => {
  if (editor.value && editor.value.getHTML() !== value)
    editor.value.commands.setContent(value, false)
})

// --- Final cursor positioning when switching notes ---
watch(() => props.editingNote, (newNote, oldNote) => {
  if (newNote?.id !== oldNote?.id)
    editor.value?.commands.focus('end')
})

// --- Weather fetching logic (Please ensure you have your full function) ---
async function fetchWeather() {
  // This is a placeholder, please use your full fetchWeather function.
  const now = new Date()
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  return Promise.resolve(`Fullerton/${time} 26°C Clear ☀️`)
}

onMounted(async () => {
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportResize)
    handleViewportResize() // Initial check
  }

  if (!props.editingNote && !props.modelValue) {
    const weatherString = await fetchWeather()
    if (weatherString && editor.value) {
      const initialContent = `<p>${weatherString}</p><p></p>`
      editor.value.commands.setContent(initialContent)
      editor.value.commands.focus('end')
      emit('update:modelValue', initialContent)
    }
  }
  if (props.editingNote)
    editor.value?.commands.focus('end')
})

onBeforeUnmount(() => {
  if (window.visualViewport)
    window.visualViewport.removeEventListener('resize', handleViewportResize)

  editor.value?.destroy()
})

function handleSubmit() {
  emit('submit')
}
</script>

<template>
  <div class="editor-layout-container">
    <form class="editor-form" @submit.prevent="handleSubmit">
      <div v-if="editor" class="editor-toolbar">
        <button type="button" :class="{ 'is-active': editor.isActive('bold') }" @click="editor.chain().focus().toggleBold().run()">B</button>
        <button type="button" :class="{ 'is-active': editor.isActive('italic') }" @click="editor.chain().focus().toggleItalic().run()">I</button>
        <button type="button" :class="{ 'is-active': editor.isActive('strike') }" @click="editor.chain().focus().toggleStrike().run()">S</button>
        <button type="button" :class="{ 'is-active': editor.isActive('heading', { level: 2 }) }" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()">H2</button>
        <button type="button" :class="{ 'is-active': editor.isActive('bulletList') }" @click="editor.chain().focus().toggleBulletList().run()">●</button>
        <button type="button" :class="{ 'is-active': editor.isActive('orderedList') }" @click="editor.chain().focus().toggleOrderedList().run()">1.</button>
      </div>
      <div class="editor-content-wrapper" :class="[editorFontSizeClass]">
        <EditorContent :editor="editor" />
      </div>
    </form>

    <div
      ref="editorFooterRef"
      class="editor-footer"
      :style="{ bottom: `${footerBottomOffset}px` }"
    >
      <div class="status-bar">
        <span class="char-counter">
          {{ t('notes.char_count') }}: {{ charCount }}/{{ maxNoteLength }}
        </span>
        <span v-if="lastSavedTime" class="char-counter ml-4">
          💾 {{ t('notes.auto_saved_at') }}: {{ lastSavedTime }}
        </span>
      </div>
      <div class="emoji-bar">
        <button
          type="button"
          class="form-button"
          :disabled="isLoading || charCount === 0"
          @click="handleSubmit"
        >
          💾 {{ isLoading ? $t('notes.saving') : editingNote ? $t('notes.update_note') : $t('notes.save_note') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style>
/* --- New Layout Styles --- */
.editor-layout-container {
  display: flex;
  flex-direction: column;
  /* Make it take the full height of the viewport */
  height: 100vh;
  /* iOS Safari full height fix to account for bottom bar */
  height: -webkit-fill-available;
}

.editor-form {
  flex-grow: 1; /* Allow the form to take up all available space */
  display: flex;
  flex-direction: column;
  min-height: 0; /* Important for flex children scrolling */
  /* Add padding at the bottom to ensure last line of text is not hidden by the footer */
  padding-bottom: 90px;
  -webkit-overflow-scrolling: touch; /* Momentum scrolling on iOS */
  overflow-y: auto; /* The entire form scrolls */
}

.editor-content-wrapper {
  flex-grow: 1; /* Make the editor content wrapper grow */
  display: flex; /* Use flexbox to make ProseMirror fill it */
  flex-direction: column;
  border: 1px solid #ccc;
  border-top: none;
  border-radius: 0 0 6px 6px;
}

.dark .editor-content-wrapper {
  border-color: #48484a;
}

.ProseMirror {
  flex-grow: 1; /* Make the editor itself take all space in its wrapper */
  padding: 0.5rem;
  outline: none;
}

/* --- Fixed Footer Styling --- */
.editor-footer {
  position: fixed;
  left: 0;
  right: 0;
  z-index: 100;
  background-color: #f8f8f8;
  padding: 8px 12px;
  border-top: 1px solid #ccc;
  /* Smooth transition for when keyboard appears/disappears */
  transition: bottom 0.25s ease-out;
}

.dark .editor-footer {
  background-color: #2c2c2e;
  border-top-color: #48484a;
}

/* --- Dynamic Font Size Styling --- */
.font-size-small .ProseMirror { font-size: 14px; }
.font-size-medium .ProseMirror { font-size: 16px; }
.font-size-large .ProseMirror { font-size: 20px; }

/* --- Toolbar Styling --- */
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background-color: #f8f8f8;
  position: sticky; /* Make toolbar sticky to the top of the scrollable form */
  top: 0;
  z-index: 10;
}
.dark .editor-toolbar {
  background-color: #2c2c2e;
  border-color: #48484a;
}
.editor-toolbar button {
  font-weight: bold;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  background: none;
}
.dark .editor-toolbar button {
    color: #e0e0e0;
}
.editor-toolbar button:hover {
  background-color: #e0e0e0;
}
.dark .editor-toolbar button:hover {
  background-color: #404040;
}
.editor-toolbar button.is-active {
  background-color: #d0d0d0;
  color: #000;
}
.dark .editor-toolbar button.is-active {
  background-color: #555;
  color: #fff;
}

/* --- Other styles --- */
.status-bar{display:flex;justify-content:flex-start;align-items:center;}.char-counter{font-size:12px;color:#999}.dark .char-counter{color:#aaa}.ml-4{margin-left:1rem}.emoji-bar{margin-top:4px;}.form-button{width:100%;padding:.5rem;font-size:14px;border-radius:6px;border:1px solid #ccc;cursor:pointer;background:#d3d3d3;color:#111}.dark .form-button{background-color:#404040;color:#fff;border-color:#555}.form-button:disabled{opacity:.6;cursor:not-allowed}
</style>
