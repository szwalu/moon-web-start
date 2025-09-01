<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EasyMDE from 'easymde'
import 'easymde/dist/easymde.min.css'
import { cityMap, weatherMap } from '@/utils/weatherMap'
import { useSettingStore } from '@/stores/setting'

// --- Props & Emits Definition ---
const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as () => any | null, default: null },
  isLoading: { type: Boolean, default: false },
  allTags: { type: Array as () => string[], default: () => [] },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
  // 关键改动：接收父组件计算好的动态高度
  dynamicHeight: { type: String, default: '100%' },
})

const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave', 'close'])

// --- Core State Definition (Refs, Computed, etc.) ---
const { t } = useI18n()
const settingsStore = useSettingStore()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const easymde = ref<EasyMDE | null>(null)
const isReadyForAutoSave = ref(false)
const showEditorTagSuggestions = ref(false)
const editorTagSuggestions = ref<string[]>([])
const editorSuggestionsStyle = ref({ top: '0px', left: '0px' })
const highlightedEditorIndex = ref(-1)

const contentModel = computed({
  get: () => props.modelValue,
  set: (value) => { emit('update:modelValue', value) },
})
const charCount = computed(() => contentModel.value.length)

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
  const cache = { data, timestamp: Date.now() }
  localStorage.setItem('weatherData_notes_app', JSON.stringify(cache))
}

function getMappedCityName(enCity: string): string {
  if (!enCity)
    return '未知地点'
  const cityLower = enCity.trim().toLowerCase()
  for (const [key, value] of Object.entries(cityMap)) {
    const keyLower = key.toLowerCase()
    if (cityLower === keyLower || cityLower.startsWith(keyLower))
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
        throw new Error(`ipapi.co error: ${locRes.status}`)
      locData = await locRes.json()
      if (locData.error)
        throw new Error(`ipapi.co error: ${locData.reason}`)
    }
    catch (ipapiError: any) {
      console.warn('ipapi.co failed, trying backup...', ipapiError.message)
      const backupRes = await fetch('https://ip-api.com/json/')
      if (!backupRes.ok)
        throw new Error(`ip-api.com error: ${backupRes.status}`)
      locData = await backupRes.json()
      if (locData.status === 'fail')
        throw new Error(`ip-api.com error: ${locData.message}`)
      locData.city = locData.city || locData.regionName
      locData.latitude = locData.lat
      locData.longitude = locData.lon
    }
    if (!locData?.latitude || !locData?.longitude)
      throw new Error('Failed to get location')
    const { latitude: lat, longitude: lon } = locData
    const city = getMappedCityName(locData.city)
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&timezone=auto`)
    if (!res.ok)
      throw new Error(`open-meteo error: ${res.status}`)
    const data = await res.json()
    if (data.error)
      throw new Error(`open-meteo error: ${data.reason}`)
    const { temperature_2m: temp, weathercode: code } = data.current
    const { text, icon } = getWeatherText(code)
    const formattedString = `${city}/${temp}°C ${text} ${icon}`
    setCachedWeather({ formattedString })
    return formattedString
  }
  catch (e: any) {
    console.error('Weather fetch error:', e)
    return null
  }
}

// Editor related logic functions
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
  cmWrapper.classList.add(`font-size-${settingsStore.noteFontSize}`)
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
    doc.replaceRange(`${tag} `, start, cursor)
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
      action: (_editor: any) => { // [已修复] 'editor' -> '_editor'
        const cm = easymde.value!.codemirror
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
      action: (_editor: any) => { // [已修复] 'editor' -> '_editor'
        easymde.value!.codemirror.getDoc().replaceRange('- [ ] ', easymde.value!.codemirror.getDoc().getCursor())
        easymde.value!.codemirror.focus()
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

  nextTick(applyEditorFontSize)

  const cm = easymde.value.codemirror
  cm.on('change', (_instance: any) => { // [已修复] 'instance' -> '_instance'
    const editorContent = easymde.value?.value() ?? ''
    if (contentModel.value !== editorContent)
      contentModel.value = editorContent

    if (!isReadyForAutoSave.value)
      isReadyForAutoSave.value = true
    else
      emit('triggerAutoSave')

    const cursor = cm.getDoc().getCursor()
    const line = cm.getDoc().getLine(cursor.line)
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
      const coords = cm.cursorCoords()
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
        doc.setCursor(lastLine, doc.getLine(lastLine()).length)
        cm.focus()
      }
    })
  }
}, { deep: true })

watch(() => settingsStore.noteFontSize, () => {
  applyEditorFontSize()
})

watch(easymde, (newEditorInstance) => {
  if (newEditorInstance && props.editingNote) {
    const cm = newEditorInstance.codemirror
    setTimeout(() => {
      const doc = cm.getDoc()
      const lastLine = doc.lastLine()
      doc.setCursor(lastLine, doc.getLine(lastLine()).length)
      cm.focus()
      cm.scrollIntoView(cm.getCursor(), 60)
    }, 150)
  }
})
</script>

<template>
  <div
    class="note-editor-wrapper"
    :style="{ height: dynamicHeight }"
  >
    <form class="note-editor-form" autocomplete="off" @submit.prevent="handleSubmit">
      <textarea
        ref="textareaRef"
        v-model="contentModel"
        style="display: none;"
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
            type="button"
            class="form-button close-btn"
            @click="$emit('close')"
          >
            {{ t('notes.cancel') }}
          </button>
          <button
            type="submit"
            class="form-button submit-btn"
            :disabled="isLoading || !contentModel"
          >
            💾 {{ isLoading ? t('notes.saving') : editingNote ? t('notes.update_note') : t('notes.save_note') }}
          </button>
        </div>
      </div>
    </form>
    <div
      v-if="showEditorTagSuggestions"
      class="tag-suggestions"
      :style="editorSuggestionsStyle"
    />
  </div>
</template>

<style scoped>
/* =================================================================== */
/* --- 关键改动：全新、更稳定的样式 --- */
/* =================================================================== */
.note-editor-wrapper {
  /* 1. 使用 absolute 定位，使其相对于父级 .editor-overlay 定位 */
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;

  /* 2. 宽度和最大宽度设置 */
  width: 100%;
  max-width: 480px;
  margin: 0 auto;

  /* 3. 外观 */
  background-color: #fff;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;

  /* 4. 内部使用 Flex 布局 */
  display: flex;
  flex-direction: column;

  /* 5. 过渡效果，让弹出更平滑 */
  transition: transform 0.3s ease-out;
  transform: translateY(0);
}

.dark .note-editor-wrapper {
  background-color: #2c2c2e;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.3);
}

.note-editor-form {
  display: flex;
  flex-direction: column;
  /* 关键：让表单填满剩余空间 */
  flex-grow: 1;
  /* 关键：确保内部滚动正常工作 */
  min-height: 0;
  overflow: hidden;
}

.editor-footer {
  /* 关键：底部栏高度固定，不收缩 */
  flex-shrink: 0;
  padding: 0.75rem 1rem;
  border-top: 1px solid #e0e0e0;
}
.dark .editor-footer {
  border-top-color: #48484a;
}

.status-bar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  margin-bottom: 0.5rem;
}
.char-counter {
  font-size: 12px;
  color: #999;
}
.dark .char-counter {
  color: #aaa;
}
.ml-4 {
  margin-left: 1rem;
}
.emoji-bar {
  display: flex;
  gap: 0.75rem;
}
.form-button {
  flex-grow: 1;
  padding: 0.6rem;
  font-size: 16px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color 0.2s;
}
.form-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.close-btn {
  background-color: #f0f0f0;
  color: #333;
}
.dark .close-btn {
  background-color: #555;
  color: #f0f0f0;
}
.submit-btn {
  background-color: #00b386;
  color: white;
}
</style>

<style>
/* 全局样式保持不变，确保 EasyMDE 内部 flex 布局正确 */
.note-editor-form > .EasyMDEContainer {
    /* 关键：编辑器本身填满表单的剩余空间 */
    flex-grow: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border: none !important;
}

.editor-toolbar {
  flex-shrink: 0;
  border-bottom: 1px solid #e0e0e0 !important;
}
.dark .editor-toolbar {
  border-bottom-color: #48484a !important;
}

.CodeMirror {
  height: 100% !important;
  flex-grow: 1;
  min-height: 0;
  overflow-y: auto !important;
  font-size: 16px !important;
  line-height: 1.6 !important;
}

/* 其他 EasyMDE 全局样式... */
</style>
