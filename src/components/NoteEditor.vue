<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

// --- Tiptap an related imports ---
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'

// (天气和 Store 相关的引入保持不变)
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

// --- Refs for layout calculation ---
const editorWrapperRef = ref<HTMLDivElement | null>(null)
const minEditorHeight = 150
const maxEditorHeight = ref(400) // Default value, will be calculated dynamically

// --- The definitive viewport resize handler ---
function handleViewportResize() {
  // This function now runs every time the keyboard appears or disappears.
  if (!editorWrapperRef.value || !window.visualViewport)
    return

  nextTick(() => {
    const isSmallScreen = window.innerWidth < 768
    if (isSmallScreen) {
      const viewport = window.visualViewport
      const editorTopOffset = editorWrapperRef.value?.getBoundingClientRect().top ?? 0
      const bottomChromeHeight = 85 // Space for save button, status bar, etc.

      const newMaxHeight = viewport.height - editorTopOffset - bottomChromeHeight
      maxEditorHeight.value = Math.max(minEditorHeight, newMaxHeight)

      // --- 🔴 THE FINAL FIX START ---
      // After the keyboard is up and we've set our max-height,
      // the browser's own scrolling might have put us in a weird state.
      // We now explicitly command the browser to scroll the entire component
      // into view to ensure the save button is visible.
      // A small delay ensures the keyboard animation is fully complete.
      setTimeout(() => {
        editorWrapperRef.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      }, 300) // 300ms delay to wait for keyboard animation
      // --- 🔴 THE FINAL FIX END ---
    }
    else {
      // Desktop logic
      maxEditorHeight.value = Math.min(window.innerHeight * 0.75, 800)
    }
  })
}

// --- Tiptap editor instance ---
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

// --- Final cursor positioning ---
watch(() => props.editingNote, (newNote, oldNote) => {
  if (newNote?.id !== oldNote?.id)
    editor.value?.commands.focus('end')
})

// --- Weather fetching logic (Please ensure you have your full function here) ---
function fetchWeather() {
  // This is a placeholder, please use your full fetchWeather function.
  // Using the current location and time for a more dynamic placeholder.
  const now = new Date()
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  return Promise.resolve(`Fullerton/${time} 25°C Clear ☀️`)
}

onMounted(async () => {
  // Add resize listener
  window.addEventListener('resize', handleViewportResize)
  if (window.visualViewport)
    window.visualViewport.addEventListener('resize', handleViewportResize)

  // Initial calculation
  handleViewportResize()

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

// Clean up listeners to prevent memory leaks
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleViewportResize)
  if (window.visualViewport)
    window.visualViewport.removeEventListener('resize', handleViewportResize)

  editor.value?.destroy()
})

function handleSubmit() {
  emit('submit')
}
</script>

<template>
  <div ref="editorWrapperRef">
    <form class="mb-6" autocomplete="off" @submit.prevent="handleSubmit">
      <div v-if="editor" class="editor-toolbar">
        <button type="button" :class="{ 'is-active': editor.isActive('bold') }" @click="editor.chain().focus().toggleBold().run()">B</button>
        <button type="button" :class="{ 'is-active': editor.isActive('italic') }" @click="editor.chain().focus().toggleItalic().run()">I</button>
        <button type="button" :class="{ 'is-active': editor.isActive('strike') }" @click="editor.chain().focus().toggleStrike().run()">S</button>
        <button type="button" :class="{ 'is-active': editor.isActive('heading', { level: 2 }) }" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()">H2</button>
        <button type="button" :class="{ 'is-active': editor.isActive('bulletList') }" @click="editor.chain().focus().toggleBulletList().run()">●</button>
        <button type="button" :class="{ 'is-active': editor.isActive('orderedList') }" @click="editor.chain().focus().toggleOrderedList().run()">1.</button>
      </div>

      <div
        class="editor-content-wrapper"
        :class="[editorFontSizeClass]"
        :style="{ maxHeight: `${maxEditorHeight}px` }"
      >
        <EditorContent :editor="editor" />
      </div>

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
          type="submit"
          class="form-button"
          :disabled="isLoading || charCount === 0"
        >
          💾 {{ isLoading ? $t('notes.saving') : editingNote ? $t('notes.update_note') : $t('notes.save_note') }}
        </button>
      </div>
    </form>
  </div>
</template>

<style>
/* --- Tiptap Editor Styling --- */
.editor-content-wrapper {
  border: 1px solid #ccc;
  border-top: none;
  border-radius: 0 0 6px 6px;
  background-color: #fff;
  /* This is the key for internal scrolling */
  overflow-y: auto;
  /* The max-height is now controlled by JavaScript via inline style */
}

.dark .editor-content-wrapper {
  border-color: #48484a;
  background-color: #2c2c2e;
}

.ProseMirror {
  min-height: 150px;
  padding: 0.5rem;
  outline: none;
}
/* This makes the editor grow naturally inside the scrolling wrapper */
.ProseMirror > * {
  min-height: 1.2em; /* Ensures empty paragraphs are clickable */
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

/* --- Re-using your old styles that are still relevant --- */
.status-bar{display:flex;justify-content:flex-start;align-items:center;margin-top:4px}.char-counter{font-size:12px;color:#999}.dark .char-counter{color:#aaa}.ml-4{margin-left:1rem}.emoji-bar{margin-top:.2rem}.form-button{width:100%;padding:.5rem;font-size:14px;border-radius:6px;border:1px solid #ccc;cursor:pointer;background:#d3d3d3;color:#111}.dark .form-button{background-color:#404040;color:#fff;border-color:#555}.form-button:disabled{opacity:.6;cursor:not-allowed}
</style>
