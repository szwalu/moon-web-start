<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
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

// --- Tiptap editor instance ---
const editor = useEditor({
  // Use v-html for modelValue, as Tiptap works with HTML content
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
  // This function is called every time the content changes
  onUpdate: ({ editor }) => {
    // Emit the HTML to the parent to update v-model
    emit('update:modelValue', editor.getHTML())
    emit('triggerAutoSave')
  },
  // Apply custom classes to the editor
  editorProps: {
    attributes: {
      class: 'prose dark:prose-invert prose-sm sm:prose-base lg:prose-lg xl:prose-2xl m-2 focus:outline-none',
    },
  },
})

// --- Computed property for character count ---
const charCount = computed(() => {
  return editor.value?.storage.characterCount.characters() ?? 0
})

// --- Font size reactivity ---
const editorFontSizeClass = computed(() => `font-size-${settingsStore.noteFontSize}`)

watch(() => settingsStore.noteFontSize, () => {
  // Tiptap doesn't need a special function, we can just use a computed class
  // The change will be reactive in the template
})

// --- Sync parent changes to the editor ---
watch(() => props.modelValue, (value) => {
  if (editor.value && editor.value.getHTML() !== value)
    editor.value.commands.setContent(value, false)
})

// --- Final cursor positioning ---
watch(() => props.editingNote, (newNote, oldNote) => {
  if (newNote?.id !== oldNote?.id) {
    // When note changes, focus and move cursor to the end
    editor.value?.commands.focus('end')
  }
})

// --- Weather fetching logic (adapted for Tiptap) ---
async function fetchWeather() {
  // (The actual fetch logic is the same, so it's omitted for brevity)
  // ... copy the full fetchWeather function from your old file here ...
  // For demonstration, let's assume it returns a string:
  return `${getMappedCityName('Fullerton')}/24°C 晴朗 ☀️`
}

onMounted(async () => {
  if (!props.editingNote && !props.modelValue) {
    const weatherString = await fetchWeather() // Assuming fetchWeather is copied
    if (weatherString && editor.value) {
      // Set initial content with weather and place cursor after it
      const initialContent = `<p>${weatherString}</p><p></p>`
      editor.value.commands.setContent(initialContent)
      editor.value.commands.focus('end')
      // Manually update the v-model as setContent doesn't trigger onUpdate
      emit('update:modelValue', initialContent)
    }
  }
  // Focus the editor when it mounts for an existing note
  if (props.editingNote)
    editor.value?.commands.focus('end')
})

// Destroy the editor instance to prevent memory leaks
onBeforeUnmount(() => {
  editor.value?.destroy()
})

function handleSubmit() {
  emit('submit')
}

// (You can copy your full fetchWeather and other helper functions here from the old file)
// For simplicity, a placeholder is used here.
function getMappedCityName(city: string): string {
  return city
}
</script>

<template>
  <div>
    <form class="mb-6" autocomplete="off" @submit.prevent="handleSubmit">
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
/* --- Basic Tiptap Editor Styling --- */
.editor-content-wrapper {
  border: 1px solid #ccc;
  border-top: none;
  border-radius: 0 0 6px 6px;
  background-color: #fff;
}

.dark .editor-content-wrapper {
  border-color: #48484a;
  background-color: #2c2c2e;
}

.ProseMirror {
  min-height: 150px;
  max-height: 60vh; /* 新增：设置一个最大高度，例如视窗高度的60% */
  overflow-y: auto; /* 新增：当内容超出时，自动显示内部滚动条 */
  padding: 0.5rem;
  outline: none;
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
