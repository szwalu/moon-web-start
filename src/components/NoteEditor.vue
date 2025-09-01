<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EasyMDE from 'easymde'
import 'easymde/dist/easymde.min.css'

// 1. Directly import weather data mapping files
import { cityMap, weatherMap } from '@/utils/weatherMap'

// --- Import Settings Store ---
import { useSettingStore } from '@/stores/setting'

// --- Props & Emits Definition ---
const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as () => any | null, default: null },
  isLoading: { type: Boolean, default: false },
  allTags: { type: Array as () => string[], default: () => [] },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave'])

// --- Core State Definition (Refs, Computed, etc.) ---
const { t } = useI18n()
const settingsStore = useSettingStore()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const easymde = ref<EasyMDE | null>(null)
const editorWrapperRef = ref<HTMLDivElement | null>(null)
const isReadyForAutoSave = ref(false)

const showEditorTagSuggestions = ref(false)
const editorTagSuggestions = ref<string[]>([])
const editorSuggestionsStyle = ref({ top: '0px', left: '0px' })
const highlightedEditorIndex = ref(-1)
const editorSuggestionsRef = ref<HTMLDivElement | null>(null)

const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => { emit('update:modelValue', value) },
})
const charCount = computed(() => contentModel.value.length)

/*
 * REMOVED: handleViewportResize
 * This JS-based viewport handling is complex and conflicts with a pure CSS approach.
 * The parent overlay in auth.vue and the new CSS will now handle this implicitly.
 */

// Weather related logic functions
function getCachedWeather() {
  const cached = localStorage.getItem('weatherData_notes_app')
  if (!cached)
    return null

  const { data, timestamp } = JSON.parse(cached)
  const isExpired = Date.now() - timestamp > 6 * 60 * 60 * 1000
  return isExpired ? null : data
}

function setCachedWeather(data: object) {
  const cache = {
    data,
    timestamp: Date.now(),
  }
  localStorage.setItem('weatherData_notes_app', JSON.stringify(cache))
}

function getMappedCityName(enCity: string): string {
  if (!enCity)
    return '未知地点'
  const cityLower = enCity.trim().toLowerCase()
  for (const [key, value] of Object.entries(cityMap)) {
    const keyLower = key.toLowerCase()
    if (
      cityLower === keyLower
      || cityLower.startsWith(keyLower)
    )
      return value
  }
  return cityLower.charAt(0).toUpperCase() + cityLower.slice(1)
}

function getWeatherText(code: number): { text: string; icon: string } {
  return weatherMap[code] || { text: '未知天气', icon: '❓' }
}

async function fetchWeather() {
  const cached = getCachedWeather()
  if (cached)
    return cached.formattedString

  try {
    let locData
    try {
      const locRes = await fetch('https://ipapi.co/json/')
      if (!locRes.ok)
        throw new Error(`ipapi.co service responded with status: ${locRes.status}`)
      locData = await locRes.json()
      if (locData.error)
        throw new Error(`ipapi.co service error: ${locData.reason}`)
    }
    catch (ipapiError: any) {
      console.warn('ipapi.co failed, trying backup service ip-api.com...', ipapiError.message)
      const backupRes = await fetch('https://ip-api.com/json/')
      if (!backupRes.ok)
        throw new Error(`ip-api.com service responded with status: ${backupRes.status}`)
      locData = await backupRes.json()
      if (locData.status === 'fail')
        throw new Error(`ip-api.com service error: ${locData.message}`)

      locData.city = locData.city || locData.regionName
      locData.latitude = locData.lat
      locData.longitude = locData.lon
    }

    if (!locData?.latitude || !locData?.longitude)
      throw new Error('Failed to get location from both services.')

    const lat = locData.latitude
    const lon = locData.longitude
    const city = getMappedCityName(locData.city)

    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&timezone=auto`)
    if (!res.ok)
      throw new Error(`open-meteo weather service responded with status: ${res.status}`)
    const data = await res.json()
    if (data.error)
      throw new Error(`open-meteo weather service error: ${data.reason}`)

    const temp = data.current.temperature_2m
    const code = data.current.weathercode
    const { text, icon } = getWeatherText(code)

    const formattedString = `${city}/${temp}°C ${text} ${icon}`
    setCachedWeather({ formattedString })

    return formattedString
  }
  catch (e: any) {
    console.error('A critical error occurred while fetching weather information:', e)
    return null
  }
}

// Editor related logic functions
/*
 * REMOVED: updateEditorHeight
 * This was the primary source of the problem. We will let Flexbox handle the
 * editor's height automatically and robustly.
 */

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
  cmWrapper.classList.remove('font-size-small', 'font-size-medium', 'font-size-large')
  const fontSizeClass = `font-size-${settingsStore.noteFontSize}`
  cmWrapper.classList.add(fontSizeClass)
}

function selectEditorTag(tag: string) {
  if (!easymde.value)
    return
  const cm = easymde.value.codemirror
  const doc = cm.getDoc()
  const cursor = doc.getCursor()
  const line = doc.getLine(cursor.line)
  const textBeforeCursor = line.substring(0, cursor.ch)
  const lastHashIndex = textBeforeCursor.lastIndexOf('#')
  if (lastHashIndex !== -1) {
    const start = { line: cursor.line, ch: lastHashIndex }
    const end = cursor
    doc.replaceRange(`${tag} `, start, end)
  }
  showEditorTagSuggestions.value = false
  cm.focus()
}

function moveEditorSelection(offset: number) {
  if (showEditorTagSuggestions.value)
    highlightedEditorIndex.value = (highlightedEditorIndex.value + offset + editorTagSuggestions.value.length) % editorTagSuggestions.value.length
}

function handleEditorKeyDown(cm: any, event: KeyboardEvent) {
  if (showEditorTagSuggestions.value && editorTagSuggestions.value.length > 0) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveEditorSelection(1)
    }
    else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveEditorSelection(-1)
    }
    else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      selectEditorTag(editorTagSuggestions.value[highlightedEditorIndex.value])
    }
    else if (event.key === 'Escape') {
      event.preventDefault()
      showEditorTagSuggestions.value = false
    }
  }
}

function initializeEasyMDE(initialValue = '') {
  isReadyForAutoSave.value = false
  const newEl = textareaRef.value
  if (!newEl || easymde.value)
    return
  const customToolbar = [
    {
      name: 'tag',
      action: (editor: any) => {
        const cm = editor.codemirror
        cm.getDoc().replaceSelection('#')
        cm.focus()
        editorTagSuggestions.value = props.allTags
        if (editorTagSuggestions.value.length > 0) {
          const coords = cm.cursorCoords()
          editorSuggestionsStyle.value = { top: `${coords.bottom + 5}px`, left: `${coords.left}px` }
          showEditorTagSuggestions.value = true
          highlightedEditorIndex.value = 0
        }
      },
      className: 'fa fa-tag',
      title: 'Insert Tag',
    },
    '|',
    'bold',
    'italic',
    'heading',
    '|',
    'quote',
    'unordered-list',
    'ordered-list',
    {
      name: 'taskList',
      action: (editor: any) => {
        editor.codemirror.getDoc().replaceRange('- [ ] ', editor.codemirror.getDoc().getCursor())
        editor.codemirror.focus()
      },
      className: 'fa fa-check-square-o',
      title: 'Task List',
    },
    '|',
    'link',
    'image',
    'table',
    '|',
    'preview',
    'side-by-side',
    'fullscreen',
  ]
  easymde.value = new EasyMDE({
    element: newEl,
    initialValue,
    spellChecker: false,
    placeholder: t('notes.content_placeholder'),
    toolbar: customToolbar,
    status: false,
  })

  nextTick(() => {
    applyEditorFontSize()
  })

  const cm = easymde.value.codemirror

  cm.on('change', (instance: any) => {
    const editorContent = easymde.value?.value() ?? ''
    if (contentModel.value !== editorContent)
      contentModel.value = editorContent

    if (!isReadyForAutoSave.value)
      isReadyForAutoSave.value = true
    else
      emit('triggerAutoSave')

    /*
     * REMOVED: Call to updateEditorHeight().
     * Flexbox will now handle height changes automatically on content change.
     */

    const cursor = instance.getDoc().getCursor()
    const line = instance.getDoc().getLine(cursor.line)
    const textBefore = line.substring(0, cursor.ch)
    const lastHashIndex = textBefore.lastIndexOf('#')
    if (lastHashIndex === -1 || (textBefore[lastHashIndex - 1] && /\w/.test(textBefore[lastHashIndex - 1]))) {
      showEditorTagSuggestions.value = false
      return
    }
    const potentialTag = textBefore.substring(lastHashIndex)
    if (potentialTag[1] === ' ' || potentialTag.includes('#', 1) || /\s/.test(potentialTag)) {
      showEditorTagSuggestions.value = false
      return
    }
    const term = potentialTag.substring(1)
    editorTagSuggestions.value = props.allTags.filter(tag => tag.toLowerCase().includes(term.toLowerCase()))
    if (editorTagSuggestions.value.length > 0) {
      const coords = instance.cursorCoords()
      editorSuggestionsStyle.value = { top: `${coords.bottom + 5}px`, left: `${coords.left}px` }
      showEditorTagSuggestions.value = true
      highlightedEditorIndex.value = 0
    }
    else {
      showEditorTagSuggestions.value = false
    }
  })

  cm.on('keydown', handleEditorKeyDown)
}

function handleSubmit() {
  emit('submit')
}

// --- Lifecycle Hooks & Watchers ---
onMounted(async () => {
  // --- 新增代码：开始 ---
  // 激活对虚拟键盘遮挡的手动控制。
  // 这允许我们使用 CSS 变量 `keyboard-inset-height` 来获取键盘的实际高度。
  if (navigator.virtualKeyboard)
    navigator.virtualKeyboard.overlaysContent = true

  // --- 新增代码：结束 ---

  let initialContent = props.modelValue

  if (!props.editingNote && !props.modelValue) {
    const weatherString = await fetchWeather()
    if (weatherString) {
      initialContent = `${weatherString}\n`
      emit('update:modelValue', initialContent)
    }
  }

  initializeEasyMDE(initialContent)

  if (!props.editingNote && initialContent.includes('°C')) {
    await nextTick()
    if (easymde.value) {
      const cm = easymde.value.codemirror
      const doc = cm.getDoc()
      doc.setCursor(doc.lastLine(), doc.getLine(doc.lastLine()).length)
      cm.focus()
    }
  }
})

onUnmounted(() => {
  destroyEasyMDE()

  // --- 新增代码：开始 ---
  // 在组件销毁时，恢复浏览器的默认行为，这是一个良好的编程习惯。
  if (navigator.virtualKeyboard)
    navigator.virtualKeyboard.overlaysContent = false

  // --- 新增代码：结束 ---
})

watch(() => props.modelValue, (newValue) => {
  if (easymde.value && newValue !== easymde.value.value())
    easymde.value.value(newValue)
})

watch(() => props.editingNote, (newNote, oldNote) => {
  if (newNote?.id !== oldNote?.id) {
    destroyEasyMDE()
    nextTick(() => {
      initializeEasyMDE(props.modelValue)
      if (easymde.value) {
        const cm = easymde.value.codemirror
        const doc = cm.getDoc()
        const lastLine = doc.lastLine()
        doc.setCursor(lastLine, doc.getLine(lastLine).length)
        cm.focus()
      }
    })
  }
}, { deep: true })

watch(() => settingsStore.noteFontSize, () => {
  applyEditorFontSize()
})

watch(easymde, (newEditorInstance) => {
  if (newEditorInstance) {
    if (props.editingNote) {
      const cm = newEditorInstance.codemirror

      // Using a short delay to ensure the editor has fully rendered the initial long content
      setTimeout(() => {
        // 1. Get the doc and move the cursor to the end
        const doc = cm.getDoc()
        const lastLine = doc.lastLine()
        doc.setCursor(lastLine, doc.getLine(lastLine).length)

        // 2. Force focus on the editor
        cm.focus()

        // 3. Scroll the cursor into view, this is key for layout correction
        cm.scrollIntoView(cm.getCursor(), 60)

        /*
         * REMOVED: Call to updateEditorHeight().
         * This is no longer necessary as Flexbox handles the height.
         */
      }, 150)
    }
  }
})
</script>

<template>
  <div ref="editorWrapperRef" class="note-editor-wrapper" :class="{ 'editing-mode': editingNote }">
    <form class="note-editor-form" autocomplete="off" @submit.prevent="handleSubmit">
      <textarea
        ref="textareaRef"
        v-model="contentModel"
        :placeholder="$t('notes.content_placeholder')"
        class="mb-2 w-full border rounded p-2"
        required
        :disabled="isLoading"
        :maxlength="maxNoteLength"
        autocomplete="off"
      />
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
            type="submit"
            class="form-button flex-2"
            :disabled="isLoading || !contentModel"
          >
            💾 {{ isLoading ? $t('notes.saving') : editingNote ? $t('notes.update_note') : $t('notes.save_note') }}
          </button>
        </div>
      </div>
    </form>
    <div
      v-if="showEditorTagSuggestions && editorTagSuggestions.length"
      ref="editorSuggestionsRef"
      class="tag-suggestions editor-suggestions"
      :style="editorSuggestionsStyle"
    >
      <ul>
        <li
          v-for="(tag, index) in editorTagSuggestions"
          :key="tag"
          :class="{ highlighted: index === highlightedEditorIndex }"
          @mousedown.prevent="selectEditorTag(tag)"
        >
          {{ tag }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* --- A NEW, SIMPLIFIED FLEXBOX LAYOUT --- */
.note-editor-wrapper {
  /* 1. Let the parent overlay handle positioning. This component just defines its size. */
  width: 100%;

  /* 2. Set a flexible height.
     On mobile, it can grow up to 85% of the dynamic viewport height.
     'dvh' unit is crucial as it adapts to the visible area when the keyboard appears. */
  max-height: 85dvh;

  /* 3. Basic styling */
  background-color: #fff;
  border-top: 1px solid #e0e0e0;

  /* 4. CRUCIAL: This is the main flex container for the editor. */
  display: flex;
  flex-direction: column;
  z-index: 1002;
}

.dark .note-editor-wrapper {
  background-color: #2c2c2e;
  border-top: 1px solid #48484a;
}

.note-editor-form {
  /* 1. Make the form a flex container for its children (the editor and the footer) */
  display: flex;
  flex-direction: column;

  /* 2. Make the form fill its parent wrapper */
  flex: 1;

  /* 3. A key property for nested flexbox scrolling.
     Prevents the form from overflowing its parent when the editor grows. */
  min-height: 0;
  overflow: hidden; /* Prevent children from overflowing */
}

.editor-footer {
  /* This element should NOT grow or shrink. It has a fixed height. */
  flex-shrink: 0;
  padding: 0.5rem 0.75rem;
  z-index: 10; /* Ensure footer is above the editor text */
  background-color: #fff; /* Give it a background to hide text scrolling behind it */
}
.dark .editor-footer {
  background-color: #2c2c2e;
}

.status-bar{display:flex;justify-content:flex-start;align-items:center;margin:0}
.char-counter{font-size:12px;color:#999}
.dark .char-counter{color:#aaa}
.ml-4{margin-left:1rem}
.emoji-bar{margin-top:.5rem;display:flex;justify-content:space-between;gap:.5rem}
.form-button{width:100%;flex:1;padding:.5rem;font-size:14px;border-radius:6px;border:1px solid #ccc;cursor:pointer;background:#d3d3d3;color:#111}
.dark .form-button{background-color:#404040;color:#fff;border-color:#555}
.form-button:disabled{opacity:.6;cursor:not-allowed}

.tag-suggestions{position:absolute;background-color:#fff;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 12px #00000026;z-index:1000;max-height:200px;overflow-y:auto;min-width:150px}
.dark .tag-suggestions{background-color:#2c2c2e;border-color:#48484a}
.tag-suggestions ul{list-style:none;margin:0;padding:4px 0}
.tag-suggestions li{padding:6px 12px;cursor:pointer;font-size:14px;white-space:nowrap}
.tag-suggestions li:hover,.tag-suggestions li.highlighted{background-color:#f0f0f0}
.dark .tag-suggestions li:hover,.dark .tag-suggestions li.highlighted{background-color:#404040}
.editor-suggestions{position:absolute}
</style>

<style>
/* Global styles for EasyMDE */

/* The EasyMDE container that replaces the textarea */
.note-editor-form > .EasyMDEContainer {
    /* 1. Allow the editor container to grow and fill available space */
    flex: 1;
    /* 2. A crucial property for nested flexbox scrolling */
    min-height: 0;
    /* 3. Make it a flex container to manage the toolbar and CodeMirror area */
    display: flex;
    flex-direction: column;
}

.editor-toolbar {
  /* The toolbar should have a fixed height */
  flex-shrink: 0;
  padding: 1px 3px !important;
  min-height: 0 !important;
  border: 1px solid #ccc;
  border-top: none !important;
  border-bottom: none !important;
  border-radius: 6px 6px 0 0;
  position: -webkit-sticky;
  position: sticky;
  top: 0;
  z-index: 1001;
  background-color: #fff;
}
.CodeMirror {
  border: 1px solid #ccc!important;
  border-top: none!important;
  border-radius: 0!important; /* Remove border-radius as it's now the middle part */
  font-size: 16px!important;
  line-height: 1.6!important;

  /* --- KEY CHANGES --- */
  /* 1. CRUCIAL: Let flexbox handle the height instead of JS. */
  height: 100% !important;

  /* 2. It will now correctly fill the space given by its flex parent. */
  flex-grow: 1;

  /* 3. The internal scroller will work perfectly within this container. */
  overflow-y: auto!important;
}
.editor-toolbar a,.editor-toolbar button{padding-left:2px!important;padding-right:2px!important;padding-top:1px!important;padding-bottom:1px!important;line-height:1!important;height:auto!important;min-height:0!important;display:inline-flex!important;align-items:center!important}.editor-toolbar a i,.editor-toolbar button i{font-size:15px!important;vertical-align:middle}.editor-toolbar i.separator{margin:1px 3px!important;border-width:0 1px 0 0!important;height:8px!important}.dark .editor-toolbar{background-color:#2c2c2e!important;border-color:#48484a!important}.dark .CodeMirror{background-color:#2c2c2e!important;border-color:#48484a!important;color:#fff!important}.dark .editor-toolbar a{color:#e0e0e0!important}.dark .editor-toolbar a.active{background:#404040!important}@media (max-width:480px){.editor-toolbar{overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch}.editor-toolbar::-webkit-scrollbar{display:none;height:0}}

/* Heading font size fix in editor */
.CodeMirror .cm-header { font-weight: bold; }
.CodeMirror .cm-header-1 { font-size: 1.6em; }
.CodeMirror .cm-header-2 { font-size: 1.4em; }
.CodeMirror .cm-header-3 { font-size: 1.2em; }
.CodeMirror .cm-header-4 { font-size: 1.1em; }
.CodeMirror .cm-header-5 { font-size: 1.0em; }
.CodeMirror .cm-header-6 { font-size: 1.0em; color: #777; }

/* --- CSS rules for dynamically changing editor font size based on settings --- */
.CodeMirror.font-size-small { font-size: 14px !important; }
.CodeMirror.font-size-medium { font-size: 16px !important; }
.CodeMirror.font-size-large { font-size: 20px !important; }

/* --- [MODIFIED] PC Layout Correction --- */
@media (min-width: 768px) {
  .note-editor-wrapper {
    /* Give it a more stable height on desktop */
    height: 75vh;
    max-height: 650px;
  }

  /* The mobile flex rules now work perfectly on desktop too, so we no longer need
     to override .CodeMirror height here. These rules below are still good. */
  .note-editor-form {
    flex: 1;
    min-height: 0;
  }
}
</style>
