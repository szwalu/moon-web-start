<script setup lang="ts">
import { onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

// --- Milkdown Imports ---
import { Editor, defaultValueCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/core'
import { VueEditor, useEditor } from '@milkdown/vue'
import { nord } from '@milkdown/theme-nord'
import { commonmark, toggleEmphasisCommand, toggleStrongCommand, wrapInBulletListCommand, wrapInHeadingCommand, wrapInOrderedListCommand } from '@milkdown/preset-commonmark'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { replaceAll } from '@milkdown/utils'

// Import Milkdown's theme CSS
import '@milkdown/theme-nord/style.css'

const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as () => any | null, default: null },
  isLoading: { type: Boolean, default: false },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave'])
const { t } = useI18n()

const charCount = ref(0)
const editorReady = ref(false)

// using shallowRef to avoid deep reactivity on the editor instance
const editor = shallowRef<Editor | undefined>()

const { get } = useEditor((root) => {
  editor.value = Editor.make()
    .enableInspector()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, props.modelValue) // Set initial content
      ctx.update(editorViewOptionsCtx, prev => ({
        ...prev,
        attributes: {
          class: 'milkdown-editor-area',
        },
      }))
      // Listen for content changes
      ctx.get(listenerCtx).markdownUpdated$((_, markdown) => {
        // Avoid emitting the initial empty value on load
        if (!editorReady.value) {
          editorReady.value = true
          charCount.value = markdown.length
          // Only emit if initial value is not empty
          if (markdown.length > 0)
            emit('update:modelValue', markdown)
          return
        }

        // Update v-model and char count
        emit('update:modelValue', markdown)
        emit('triggerAutoSave')
        charCount.value = markdown.length
      })
    })
    .use(nord)
    .use(commonmark)
    .use(listener)

  return editor.value
})

// --- Toolbar Commands ---
function exec(command: any, payload?: any) {
  get()?.action(command(payload))
}

// --- Sync parent changes to the editor ---
watch(() => props.modelValue, (newValue) => {
  const editorInst = get()
  if (editorInst && editorInst.ctx.get(defaultValueCtx) !== newValue)
    editorInst.action(replaceAll(newValue))
})

// --- Other component logic ---
function handleSubmit() {
  emit('submit')
}

// Ensure you have your weather fetching logic if needed
// For simplicity, it's omitted here but can be added back in onMounted
onMounted(() => {
  // Logic to fetch weather and set initial content can go here
  // For example:
  // const weather = await fetchWeather();
  // get()?.action(replaceAll(weather));
})
</script>

<template>
  <div class="editor-layout-container">
    <div class="editor-form-container">
      <div class="editor-toolbar">
        <button type="button" @click="exec(toggleStrongCommand)">B</button>
        <button type="button" @click="exec(toggleEmphasisCommand)">I</button>
        <button type="button" @click="exec(wrapInHeadingCommand, 2)">H2</button>
        <button type="button" @click="exec(wrapInBulletListCommand)">●</button>
        <button type="button" @click="exec(wrapInOrderedListCommand)">1.</button>
      </div>

      <div class="editor-content-wrapper">
        <VueEditor :editor="editor" />
      </div>
    </div>

    <div class="editor-footer">
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
/* --- Milkdown Editor Layout --- */
.editor-layout-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: -webkit-fill-available;
  overflow: hidden;
  background: #2E3440; /* Nord theme background */
}

.editor-form-container {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.editor-content-wrapper {
  flex-grow: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* Milkdown uses a .milkdown CSS class wrapper */
.milkdown {
  height: 100%;
}
.milkdown-editor-area.prose {
  height: 100%;
  padding: 1rem;
  padding-bottom: 100px; /* Ensure space for footer */
}

/* Custom Placeholder */
.milkdown-editor-area.prose:empty::before {
  content: '有什么新鲜事...'; /* Your placeholder text */
  position: absolute;
  color: #4c566a; /* Nord theme placeholder color */
  pointer-events: none;
}

/* --- Toolbar & Footer Styling --- */
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid #4c566a; /* Nord theme border */
  background-color: #3b4252; /* Nord theme slightly lighter bg */
}
.editor-toolbar button {
  font-weight: bold;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  background: none;
  color: #d8dee9; /* Nord theme text color */
}
.editor-toolbar button:hover {
  background-color: #4c566a;
}

.editor-footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0; /* Keyboard handling will be added if needed */
  z-index: 100;
  background-color: #3b4252;
  padding: 8px 12px;
  border-top: 1px solid #4c566a;
}
.status-bar, .emoji-bar {
  color: #d8dee9;
}
.char-counter { font-size: 12px; color: #d8dee9; }
.ml-4 { margin-left: 1rem; }
.emoji-bar { margin-top: 4px; }
.form-button {
  width: 100%;
  padding: .5rem;
  font-size: 14px;
  border-radius: 6px;
  border: 1px solid #4c566a;
  cursor: pointer;
  background-color: #434c5e;
  color: #eceff4;
}
.form-button:disabled {
  opacity: .6;
  cursor: not-allowed;
}
</style>
